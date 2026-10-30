export function resamplePcm16(input: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (!input.length) return input;
  if (!fromRate || !toRate || fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const src = i * ratio;
    const i0 = Math.min(input.length - 1, Math.floor(src));
    const i1 = Math.min(input.length - 1, i0 + 1);
    const frac = src - i0;
    out[i] = Math.max(-32768, Math.min(32767, input[i0]! * (1 - frac) + input[i1]! * frac));
  }
  return out;
}

export function concatPcm16(left: Int16Array, right: Int16Array): Int16Array {
  if (!left.length) return right;
  if (!right.length) return left;
  const out = new Int16Array(left.length + right.length);
  out.set(left);
  out.set(right, left.length);
  return out;
}

export function takePcmFrames(buffer: Int16Array, frameSamples: number): { frames: Int16Array[]; rest: Int16Array } {
  if (frameSamples <= 0 || buffer.length < frameSamples) return { frames: [], rest: buffer };
  const frames: Int16Array[] = [];
  let offset = 0;
  while (offset + frameSamples <= buffer.length) {
    frames.push(buffer.slice(offset, offset + frameSamples));
    offset += frameSamples;
  }
  return { frames, rest: offset === 0 ? buffer : buffer.slice(offset) };
}
