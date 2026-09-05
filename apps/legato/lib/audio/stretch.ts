import { RubberBandInterface, RubberBandOption as O } from 'rubberband-wasm';
import { type AudioData, type Plan } from './types';
export function assembleAudio(data: AudioData, plan: Plan) {
  const { channels, sampleRate: sr } = data;
  const length = Math.round((plan.spans.at(-1)?.compositeOut || 0) * sr);
  const result = channels.map(() => new Float32Array(length));
  plan.spans.forEach((s, i) => {
    const a = Math.round(s.sourceIn * sr),
      b = Math.round(s.sourceOut * sr),
      dest = Math.round(s.compositeIn * sr);
    const overlap = i
      ? Math.max(
          0,
          Math.round((plan.spans[i - 1].compositeOut - s.compositeIn) * sr),
        )
      : 0;
    channels.forEach((c, ch) => {
      for (let j = 0; j < b - a && dest + j < length; j++) {
        const v = c[a + j] || 0;
        const w = j < overlap ? j / overlap : 1;
        result[ch][dest + j] = result[ch][dest + j] * (1 - w) + v * w;
      }
    });
  });
  return result;
}
export async function stretchAudio(
  data: AudioData,
  plan: Plan,
  module: WebAssembly.Module,
  smooth: boolean,
  progress: (n: number) => void = () => {},
): Promise<AudioData> {
  const channels = assembleAudio(data, plan),
    sr = data.sampleRate;
  if (!channels[0]?.length)
    throw new Error('剪辑后没有剩余内容，请保留至少一小段演奏。');
  const rb = await RubberBandInterface.initialize(module);
  const inputLength = channels[0].length,
    outputLength = Math.round(plan.duration * sr);
  const out = channels.map(() => new Float32Array(outputLength));
  const options =
    O.RubberBandOptionProcessOffline |
    O.RubberBandOptionEngineFiner |
    O.RubberBandOptionChannelsTogether |
    O.RubberBandOptionThreadingNever;
  const state = rb.rubberband_new(
    sr,
    channels.length,
    options,
    outputLength / inputLength,
    1,
  );
  const block = 1024,
    pointer = rb.malloc(channels.length * 4),
    buffers = channels.map(() => rb.malloc(block * 4));
  let fromPtr = 0,
    toPtr = 0;
  try {
    buffers.forEach((p, i) => rb.memWritePtr(pointer + i * 4, p));
    rb.rubberband_set_max_process_size(state, block);
    rb.rubberband_set_expected_input_duration(state, inputLength);
    const map = plan.knots.filter(
      (k) => k.source > 0 && k.source < inputLength / sr && k.target > 0,
    );
    fromPtr = rb.malloc(map.length * 4);
    toPtr = rb.malloc(map.length * 4);
    const from = Uint32Array.from(map, (k) => Math.round(k.source * sr)),
      to = Uint32Array.from(map, (k) => Math.round(k.target * sr));
    rb.memWrite(fromPtr, new Uint8Array(from.buffer));
    rb.memWrite(toPtr, new Uint8Array(to.buffer));
    for (let pos = 0; pos < inputLength; pos += block) {
      const n = Math.min(block, inputLength - pos);
      channels.forEach((c, i) =>
        rb.memWrite(buffers[i], c.subarray(pos, pos + n)),
      );
      rb.rubberband_study(state, pointer, n, pos + n === inputLength ? 1 : 0);
      if (pos % (block * 16) === 0) progress((pos / inputLength) * 0.18);
    }
    rb.rubberband_set_key_frame_map(state, map.length, fromPtr, toPtr);
    let written = 0;
    const retrieve = () => {
      let available = rb.rubberband_available(state);
      while (available > 0) {
        const n = rb.rubberband_retrieve(
          state,
          pointer,
          Math.min(block, available),
        );
        if (n <= 0) break;
        const take = Math.min(n, outputLength - written);
        if (take > 0)
          buffers.forEach((p, i) =>
            out[i].set(rb.memReadF32(p, take), written),
          );
        written += n;
        available = rb.rubberband_available(state);
      }
    };
    for (let pos = 0; pos < inputLength; pos += block) {
      const n = Math.min(block, inputLength - pos);
      channels.forEach((c, i) =>
        rb.memWrite(buffers[i], c.subarray(pos, pos + n)),
      );
      rb.rubberband_process(state, pointer, n, pos + n === inputLength ? 1 : 0);
      retrieve();
      if (pos % (block * 8) === 0) progress(0.18 + (pos / inputLength) * 0.77);
    }
    retrieve();
    if (written < outputLength - sr * 0.15)
      throw new Error('音频处理未完整结束，请重试或缩短片段。');
    let peak = 0;
    for (const c of out)
      for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
    const gain = Math.min(peak > 0 ? 0.89 / peak : 1, smooth ? 1.8 : 1);
    const fadeIn = Math.round(
        Math.min(plan.fadeIn ?? 0.02, plan.duration / 8) * sr,
      ),
      fadeInStart = Math.round((plan.fadeInStart ?? 0) * sr),
      fadeOut = Math.round(
        Math.min(plan.fadeOut ?? 0.22, plan.duration / 6) * sr,
      );
    for (const c of out) {
      let envelope = 0;
      for (let i = 0; i < c.length; i++) {
        let v = c[i] * gain;
        if (smooth) {
          envelope = Math.max(Math.abs(v), envelope * 0.9996);
          if (envelope > 0.28) v *= Math.pow(0.28 / envelope, 0.12);
        }
        v *= Math.min(
          1,
          Math.max(0, i - fadeInStart) / Math.max(1, fadeIn),
          (c.length - 1 - i) / Math.max(1, fadeOut),
        );
        c[i] = Number.isFinite(v) ? v : 0;
      }
    }
    progress(1);
    return { channels: out, sampleRate: sr };
  } finally {
    buffers.forEach((p) => rb.free(p));
    rb.free(pointer);
    if (fromPtr) rb.free(fromPtr);
    if (toPtr) rb.free(toPtr);
    rb.rubberband_delete(state);
  }
}
