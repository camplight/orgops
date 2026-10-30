import { concatPcm16, resamplePcm16, takePcmFrames } from "./voice-runtime/pcm";

export type LiveKitRemoteAudio = {
  pcm: Int16Array;
  sampleRate: number;
  identity: string;
};

export type LiveKitParticipantHandle = {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  publish: (pcm: Int16Array, sampleRate: number) => Promise<void>;
  interrupt: () => void;
  flush: () => Promise<void>;
};

export type LiveKitRoomFactory = (input: {
  url: string;
  token: string;
  selfIdentity?: string;
  emptyHumanGraceMs?: number;
  onAudio: (frame: LiveKitRemoteAudio) => void;
  onDisconnected?: () => void;
  onHumansLeft?: () => void;
}) => LiveKitParticipantHandle;

export function createLiveKitParticipant(factory: LiveKitRoomFactory, input: Parameters<LiveKitRoomFactory>[0]) {
  return factory(input);
}

const PUBLISH_RATE = 48_000;
const PUBLISH_FRAME_SAMPLES = 960;
const AUDIO_SOURCE_QUEUE_MS = 10_000;
const MAX_QUEUED_MS = 800;
const DEFAULT_EMPTY_HUMAN_GRACE_MS = 2_500;

function isHumanIdentity(identity: unknown) {
  return String(identity ?? "").startsWith("human:");
}

function copyPcm16(frame: { data?: unknown; samplesPerChannel?: number; channels?: number } | unknown): Int16Array | null {
  const record = frame && typeof frame === "object" ? (frame as { data?: unknown; samplesPerChannel?: number; channels?: number }) : { data: frame };
  const data = record.data;
  if (!data) return null;
  const expected = Number(record.samplesPerChannel ?? 0) * Number(record.channels ?? 1);
  if (data instanceof Int16Array) {
    const view = expected > 0 ? data.subarray(0, Math.min(expected, data.length)) : data;
    if (!view.length) return null;
    const pcm = new Int16Array(view.length);
    pcm.set(view);
    return pcm;
  }
  if (data instanceof Uint8Array) {
    if (data.byteLength < 2) return null;
    const sampleCount = expected > 0 ? Math.min(expected, Math.floor(data.byteLength / 2)) : Math.floor(data.byteLength / 2);
    const pcm = new Int16Array(sampleCount);
    new Uint8Array(pcm.buffer).set(data.subarray(0, sampleCount * 2));
    return pcm;
  }
  return null;
}

function withTimeout(promise: Promise<unknown>, ms: number) {
  return Promise.race([
    promise,
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ]);
}

export const defaultLiveKitRoomFactory: LiveKitRoomFactory = (input) => {
  let room: any;
  let source: any;
  let connected = false;
  let leftover = new Int16Array(0);
  let publishGeneration = 0;
  let publishing = Promise.resolve();
  let emptyHumanTimer: ReturnType<typeof setTimeout> | undefined;
  const pending: Array<{ pcm: Int16Array; sampleRate: number }> = [];
  const readers: Array<{ cancel: () => Promise<unknown> }> = [];

  function hasRemoteHuman() {
    for (const participant of room?.remoteParticipants?.values?.() ?? []) {
      if (isHumanIdentity(participant.identity)) return true;
    }
    return false;
  }

  function cancelEmptyHumanTimer() {
    if (emptyHumanTimer) {
      clearTimeout(emptyHumanTimer);
      emptyHumanTimer = undefined;
    }
  }

  function scheduleEmptyHumanCheck() {
    if (!connected || !input.onHumansLeft) return;
    cancelEmptyHumanTimer();
    if (hasRemoteHuman()) return;
    emptyHumanTimer = setTimeout(() => {
      emptyHumanTimer = undefined;
      if (!connected || hasRemoteHuman()) return;
      input.onHumansLeft?.();
    }, input.emptyHumanGraceMs ?? DEFAULT_EMPTY_HUMAN_GRACE_MS);
  }

  async function ensureSource() {
    if (source) return source;
    const rtc = await import("@livekit/rtc-node");
    source = new rtc.AudioSource(PUBLISH_RATE, 1, AUDIO_SOURCE_QUEUE_MS);
    const track = rtc.LocalAudioTrack.createAudioTrack("agent-audio", source);
    const options = new rtc.TrackPublishOptions();
    options.source = rtc.TrackSource.SOURCE_MICROPHONE;
    await room.localParticipant.publishTrack(track, options);
    return source;
  }

  function interruptPlayback() {
    publishGeneration += 1;
    leftover = new Int16Array(0);
    pending.length = 0;
    try {
      source?.clearQueue?.();
    } catch {}
  }

  async function captureFrames(pcm: Int16Array, generation: number) {
    if (!pcm.length || generation !== publishGeneration) return;
    const rtc = await import("@livekit/rtc-node");
    const audioSource = await ensureSource();
    leftover = concatPcm16(leftover, pcm);
    const { frames, rest } = takePcmFrames(leftover, PUBLISH_FRAME_SAMPLES);
    leftover = rest;
    for (const frame of frames) {
      if (generation !== publishGeneration) return;
      while (Number(audioSource.queuedDuration ?? 0) > MAX_QUEUED_MS) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (generation !== publishGeneration) return;
      }
      const packed = new Int16Array(frame.length);
      packed.set(frame);
      await audioSource.captureFrame(new rtc.AudioFrame(packed, PUBLISH_RATE, 1, packed.length));
    }
  }

  const attached = new Set<string>();

  function listenToRemoteAudio(track: any, identity: string, rtc: any) {
    if (track?.kind !== rtc.TrackKind.KIND_AUDIO) return;
    if (input.selfIdentity && identity === input.selfIdentity) return;
    const sid = String(track.sid ?? `${identity}:${attached.size}`);
    if (attached.has(sid)) return;
    attached.add(sid);
    void (async () => {
      const stream = new rtc.AudioStream(track, { sampleRate: 48_000, numChannels: 1, frameSizeMs: 20 });
      const reader = stream.getReader();
      readers.push(reader);
      while (true) {
        const { done, value: frame } = await reader.read();
        if (done) break;
        const pcm = copyPcm16(frame);
        if (!pcm?.length) continue;
        input.onAudio({
          pcm,
          sampleRate: Number(frame.sampleRate ?? 48_000),
          identity,
        });
      }
    })().catch(() => undefined);
  }

  const handle: LiveKitParticipantHandle = {
    async connect() {
      const rtc = await import("@livekit/rtc-node");
      room = new rtc.Room();
      room.on(rtc.RoomEvent.TrackSubscribed, (track: any, _pub: unknown, participant: { identity?: string }) => {
        listenToRemoteAudio(track, String(participant?.identity ?? ""), rtc);
      });
      room.on(rtc.RoomEvent.ParticipantConnected, (participant: { identity?: string }) => {
        if (isHumanIdentity(participant?.identity)) cancelEmptyHumanTimer();
      });
      room.on(rtc.RoomEvent.ParticipantDisconnected, () => scheduleEmptyHumanCheck());
      room.on(rtc.RoomEvent.Disconnected, () => input.onDisconnected?.());
      await room.connect(input.url, input.token, { autoSubscribe: true, dynacast: true });
      connected = true;
      for (const participant of room.remoteParticipants.values()) {
        for (const publication of participant.trackPublications.values()) {
          if (publication.track) listenToRemoteAudio(publication.track, String(participant.identity ?? ""), rtc);
        }
      }
      for (const frame of pending.splice(0)) {
        await handle.publish(frame.pcm, frame.sampleRate);
      }
      scheduleEmptyHumanCheck();
    },
    async disconnect() {
      connected = false;
      cancelEmptyHumanTimer();
      interruptPlayback();
      for (const reader of readers.splice(0)) {
        try {
          await reader.cancel();
        } catch {}
      }
      try {
        await source?.close?.();
      } catch {}
      source = undefined;
      try {
        await withTimeout(Promise.resolve(room?.disconnect?.()), 1_500);
      } catch {}
    },
    interrupt() {
      interruptPlayback();
    },
    async flush() {
      if (!leftover.length) return;
      const generation = publishGeneration;
      const padded = new Int16Array(PUBLISH_FRAME_SAMPLES);
      padded.set(leftover.subarray(0, Math.min(leftover.length, PUBLISH_FRAME_SAMPLES)));
      leftover = new Int16Array(0);
      publishing = publishing
        .then(() => captureFrames(padded, generation))
        .catch(() => undefined);
      await publishing;
    },
    async publish(pcm, sampleRate) {
      if (!pcm.length) return;
      const resampled = resamplePcm16(pcm, sampleRate, PUBLISH_RATE);
      if (!resampled.length) return;
      if (!connected) {
        pending.push({ pcm: resampled, sampleRate: PUBLISH_RATE });
        return;
      }
      const generation = publishGeneration;
      const copied = new Int16Array(resampled.length);
      copied.set(resampled);
      publishing = publishing
        .then(() => captureFrames(copied, generation))
        .catch(() => undefined);
      await publishing;
    },
  };
  return handle;
};
