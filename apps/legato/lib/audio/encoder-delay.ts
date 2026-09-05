import {
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  Input,
  MP4,
  Mp4OutputFormat,
  Output,
  Quality,
} from 'mediabunny';

const measurements = new Map<string, number>();
export async function measureAacDelay(
  sampleRate: number,
  numberOfChannels: number,
  signal: AbortSignal,
) {
  const key = `${sampleRate}:${numberOfChannels}`;
  if (measurements.has(key)) return measurements.get(key)!;
  signal.throwIfAborted();
  const buffer = new AudioBuffer({
    sampleRate,
    numberOfChannels,
    length: Math.round(sampleRate * 0.4),
  });
  const start = Math.round(sampleRate * 0.07),
    count = Math.round(sampleRate * 0.12);
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < count; i++) {
      const t = i / sampleRate;
      data[start + i] =
        0.25 *
        Math.sin(2 * Math.PI * (500 * t + 12000 * t * t)) *
        Math.sin((Math.PI * i) / count) ** 2;
    }
  }
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });
  const source = new AudioBufferSource({
    codec: 'aac',
    quality: new Quality({ bitrate: 192000 }),
  });
  output.addAudioTrack(source);
  let input: Input | undefined;
  let finished = false;
  try {
    await output.start();
    await source.add(buffer);
    source.close();
    await output.finalize();
    finished = true;
    signal.throwIfAborted();
    input = new Input({
      formats: [MP4],
      source: new BlobSource(new Blob([output.target.buffer!])),
    });
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('未能校准音频编码时序。');
    const decoded = new Float32Array(Math.ceil(sampleRate * 0.7));
    for await (const { buffer: part, timestamp } of new AudioBufferSink(
      track,
    ).buffers()) {
      if (part.sampleRate !== sampleRate)
        throw new Error('音频编码改变了采样率，请尝试 WebM。');
      const offset = Math.round(timestamp * sampleRate),
        skip = Math.max(0, -offset),
        at = Math.max(0, offset);
      const n = Math.min(part.length - skip, decoded.length - at);
      if (n > 0)
        decoded.set(part.getChannelData(0).subarray(skip, skip + n), at);
    }
    const original = buffer.getChannelData(0);
    function correlation(shift: number) {
      let cross = 0,
        a = 0,
        b = 0;
      for (let i = start; i < start + count; i += 4) {
        const x = original[i],
          y = decoded[i + shift] || 0;
        cross += x * y;
        a += x * x;
        b += y * y;
      }
      return cross / Math.sqrt(Math.max(1e-20, a * b));
    }
    let best = 0,
      score = -1;
    for (
      let shift = -Math.round(sampleRate * 0.02);
      shift < sampleRate * 0.15;
      shift += 4
    ) {
      const value = correlation(shift);
      if (value > score) {
        score = value;
        best = shift;
      }
    }
    const center = best;
    for (let shift = center - 4; shift <= center + 4; shift++) {
      const value = correlation(shift);
      if (value > score) {
        score = value;
        best = shift;
      }
    }
    if (score < 0.7)
      throw new Error('无法可靠校准当前 AAC 编码器，请选择 WebM 导出。');
    signal.throwIfAborted();
    const delay = best / sampleRate;
    measurements.set(key, delay);
    return delay;
  } finally {
    input?.dispose();
    if (!finished) await output.cancel().catch(() => {});
  }
}
