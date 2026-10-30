const FRAME_MS = 50;

// Runs on the audio rendering thread, so metering keeps its cadence in background tabs
// where main-thread timers are throttled to ~1 Hz.
const LEVEL_WORKLET_SOURCE = `
class OrgopsLevelProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sum = 0;
    this.count = 0;
    this.frameSize = Math.round(sampleRate * ${FRAME_MS / 1000});
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i += 1) this.sum += channel[i] * channel[i];
      this.count += channel.length;
      if (this.count >= this.frameSize) {
        this.port.postMessage(Math.sqrt(this.sum / this.count));
        this.sum = 0;
        this.count = 0;
      }
    }
    return true;
  }
}
registerProcessor("orgops-level", OrgopsLevelProcessor);
`;

export function pickVoiceMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

export function voiceFileExtension(mime: string) {
  return mime.includes("mp4") ? "m4a" : "webm";
}

/** Calls onFrame with the RMS of every ~50 ms of audio until close() is called. */
function createLevelSource(stream: MediaStream, onFrame: (rms: number) => void) {
  const AudioContextCtor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const context = new AudioContextCtor();
  void context.resume().catch(() => undefined);
  const source = context.createMediaStreamSource(stream);
  let closed = false;
  let fallbackTimer: number | null = null;
  let workletNode: AudioWorkletNode | null = null;
  let sink: GainNode | null = null;

  function startPollingFallback() {
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    fallbackTimer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      onFrame(Math.sqrt(sum / samples.length));
    }, FRAME_MS);
  }

  if (context.audioWorklet && typeof AudioWorkletNode !== "undefined") {
    const moduleUrl = URL.createObjectURL(new Blob([LEVEL_WORKLET_SOURCE], { type: "application/javascript" }));
    context.audioWorklet
      .addModule(moduleUrl)
      .then(() => {
        if (closed) return;
        workletNode = new AudioWorkletNode(context, "orgops-level");
        workletNode.port.onmessage = (event) => {
          if (!closed) onFrame(Number(event.data) || 0);
        };
        sink = context.createGain();
        sink.gain.value = 0;
        source.connect(workletNode);
        workletNode.connect(sink);
        sink.connect(context.destination);
      })
      .catch(() => {
        if (!closed) startPollingFallback();
      })
      .finally(() => URL.revokeObjectURL(moduleUrl));
  } else {
    startPollingFallback();
  }

  return {
    close() {
      closed = true;
      if (fallbackTimer !== null) window.clearInterval(fallbackTimer);
      if (workletNode) workletNode.port.onmessage = null;
      source.disconnect();
      workletNode?.disconnect();
      sink?.disconnect();
      void context.close().catch(() => undefined);
    }
  };
}

function levelFromRms(rms: number) {
  return Math.min(1, rms * 9);
}

export function createLevelMeter(stream: MediaStream, onLevel: (level: number) => void) {
  const source = createLevelSource(stream, (rms) => onLevel(levelFromRms(rms)));
  return {
    stop() {
      source.close();
      onLevel(0);
    }
  };
}
