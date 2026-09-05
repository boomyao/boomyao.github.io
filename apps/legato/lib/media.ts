import {
  Quality,
  Input,
  ALL_FORMATS,
  BlobSource,
  AudioBufferSink,
  CanvasSink,
  CanvasSource,
  AudioBufferSource,
  Output,
  BufferTarget,
  Mp4OutputFormat,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
} from 'mediabunny';
import type { AudioData, Plan } from './audio/types';
import { outputToSource } from './audio/timeline';
import { measureAacDelay } from './audio/encoder-delay';
import { trimAacPriming } from './audio/mp4-timing';
export type MediaAsset = {
  file: File | null;
  url: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  audio: AudioData;
  demoNotes?: { time: number; frequency: number }[];
};
export function aborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
}
export async function loadMedia(
  file: File,
  signal: AbortSignal,
  onProgress: (n: number) => void,
): Promise<MediaAsset> {
  if (file.size > 500 * 1024 * 1024)
    throw new Error('请选择 500 MB 以内的视频，避免浏览器内存不足。');
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(file),
  });
  try {
    const [video, audioTrack, duration] = await Promise.all([
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
      input.computeDuration(),
    ]);
    aborted(signal);
    if (!video) throw new Error('没有找到视频画面，请选择演奏视频。');
    if (!audioTrack) throw new Error('视频没有声音，无法分析演奏节奏。');
    if (duration > 300)
      throw new Error(
        '当前版本支持 5 分钟以内的演奏，请先截取需要整理的乐段。',
      );
    if (duration < 0.5) throw new Error('视频过短，请选择至少半秒的演奏。');
    const [width, height] = await Promise.all([
      video.getDisplayWidth(),
      video.getDisplayHeight(),
    ]);
    let audio: AudioData;
    if (await audioTrack.canDecode()) {
      const sink = new AudioBufferSink(audioTrack);
      let channels: Float32Array[] = [];
      let sr = 48000;
      for await (const { buffer, timestamp } of sink.buffers()) {
        aborted(signal);
        if (!channels.length) {
          sr = buffer.sampleRate;
          channels = Array.from(
            { length: Math.min(2, buffer.numberOfChannels) },
            () => new Float32Array(Math.ceil(duration * sr)),
          );
        }
        const offset = Math.round(timestamp * sr),
          skip = Math.max(0, -offset),
          at = Math.max(0, offset),
          count = Math.min(buffer.length - skip, channels[0].length - at);
        if (count > 0)
          channels.forEach((c, i) =>
            c.set(buffer.getChannelData(i).subarray(skip, skip + count), at),
          );
        onProgress(Math.min(0.98, timestamp / duration));
      }
      if (!channels.length) throw new Error('没有解码出可用声音。');
      audio = { channels, sampleRate: sr };
    } else {
      const context = new AudioContext();
      try {
        const buffer = await context.decodeAudioData(await file.arrayBuffer());
        aborted(signal);
        audio = {
          channels: Array.from(
            { length: Math.min(2, buffer.numberOfChannels) },
            (_, i) => buffer.getChannelData(i).slice(),
          ),
          sampleRate: buffer.sampleRate,
        };
      } catch {
        throw new Error(
          '浏览器无法解码这段声音，请换用 Chrome / Edge，或先转为 H.264 + AAC 的 MP4。',
        );
      } finally {
        await context.close();
      }
    }
    if (audio.sampleRate > 48000) {
      const offline = new OfflineAudioContext(
        audio.channels.length,
        Math.ceil(duration * 48000),
        48000,
      );
      const b = offline.createBuffer(
        audio.channels.length,
        audio.channels[0].length,
        audio.sampleRate,
      );
      audio.channels.forEach((c, i) => b.copyToChannel(new Float32Array(c), i));
      const s = offline.createBufferSource();
      s.buffer = b;
      s.connect(offline.destination);
      s.start();
      const rendered = await offline.startRendering();
      audio = {
        channels: Array.from({ length: rendered.numberOfChannels }, (_, i) =>
          rendered.getChannelData(i).slice(),
        ),
        sampleRate: 48000,
      };
    }
    let peak = 0;
    for (const c of audio.channels)
      for (let i = 0; i < c.length; i += 4)
        peak = Math.max(peak, Math.abs(c[i]));
    if (peak < 0.00003) throw new Error('没有检测到可用声音，请检查视频音轨。');
    aborted(signal);
    onProgress(1);
    return {
      file,
      url: URL.createObjectURL(file),
      name: file.name,
      duration,
      width,
      height,
      audio,
    };
  } finally {
    input.dispose();
  }
}
export function createDemo(): MediaAsset {
  const sr = 44100,
    notes: { time: number; frequency: number }[] = [];
  const midi = [
    69, 76, 65, 72, 77, 76, 71, 67, 74, 79, 69, 72, 69, 76, 69, 71, 72, 72, 76,
    74, 65, 72, 77, 79, 67, 74, 79, 72, 69, 76, 71, 72,
  ];
  let time = 0.4;
  midi.forEach((n, i) => {
    notes.push({ time, frequency: 440 * Math.pow(2, (n - 69) / 12) });
    time +=
      0.43 + Math.sin(i * 4.8) * 0.035 + ([7, 18, 25].includes(i) ? 1.1 : 0);
  });
  const duration = time + 1.3,
    channel = new Float32Array(Math.ceil(duration * sr));
  for (const n of notes) {
    const start = Math.round(n.time * sr);
    for (let i = 0; i < sr * 1.5 && start + i < channel.length; i++) {
      const t = i / sr,
        envelope = (1 - Math.exp(-t * 220)) * Math.exp(-t * 4.5);
      let v = 0;
      for (let h = 1; h <= 6; h++)
        v +=
          (Math.sin(2 * Math.PI * n.frequency * h * t) *
            Math.exp(-t * h * 0.6)) /
          (h * h);
      channel[start + i] += v * envelope * 0.26;
    }
  }
  return {
    file: null,
    url: '',
    name: '节奏练习示例',
    duration,
    width: 1280,
    height: 720,
    audio: { channels: [channel], sampleRate: sr },
    demoNotes: notes,
  };
}
export function drawDemo(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  time: number,
  asset: MediaAsset,
) {
  const w = ctx.canvas.width,
    h = ctx.canvas.height;
  ctx.fillStyle = '#10151d';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#d6f77a';
  ctx.font = `500 ${Math.round(w * 0.031)}px sans-serif`;
  ctx.fillText('节奏练习示例', w * 0.075, h * 0.18);
  ctx.fillStyle = '#8490a2';
  ctx.font = `${Math.round(w * 0.017)}px sans-serif`;
  ctx.fillText('合成琴音 · 体验停顿修剪与节奏整理', w * 0.075, h * 0.245);
  const left = w * 0.08,
    right = w * 0.92,
    y = h * 0.7;
  ctx.strokeStyle = '#2a3442';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(right, y);
  ctx.stroke();
  for (const n of asset.demoNotes || []) {
    const x = left + ((n.time - time + 1.5) / 6) * (right - left);
    if (x < left || x > right) continue;
    const height = (Math.log2(n.frequency / 200) * 0.09 + 0.1) * h;
    const active = time >= n.time && time < n.time + 0.24;
    ctx.fillStyle = active ? '#d6f77a' : '#506e93';
    ctx.beginPath();
    ctx.roundRect(x - 4, y - height, 8, height, 4);
    ctx.fill();
  }
  const playX = left + (1.5 / 6) * (right - left);
  ctx.strokeStyle = '#d6f77a';
  ctx.beginPath();
  ctx.moveTo(playX, h * 0.36);
  ctx.lineTo(playX, h * 0.79);
  ctx.stroke();
  ctx.fillStyle = '#aeb9c7';
  ctx.font = `${Math.round(w * 0.016)}px monospace`;
  ctx.fillText(`${time.toFixed(1)} s`, left, h * 0.88);
}
export type ExportChoice = {
  format: 'mp4' | 'webm';
  maxHeight: number;
  fps: number;
  punch: boolean;
};
export async function supportedFormats() {
  if (typeof VideoEncoder === 'undefined') return { mp4: false, webm: false };
  const [avc, aac, vp9, opus] = await Promise.all([
    canEncodeVideo('avc', { width: 1280, height: 720 }),
    canEncodeAudio('aac', { sampleRate: 48000, numberOfChannels: 2 }),
    canEncodeVideo('vp9', { width: 1280, height: 720 }),
    canEncodeAudio('opus', { sampleRate: 48000, numberOfChannels: 2 }),
  ]);
  return { mp4: avc && aac, webm: vp9 && opus };
}
export async function exportVideo(
  asset: MediaAsset,
  audio: AudioData,
  plan: Plan,
  choice: ExportChoice,
  signal: AbortSignal,
  progress: (n: number) => void,
) {
  if (!plan.spans.length || plan.duration < 0.15)
    throw new Error('请保留至少一小段内容后再导出。');
  const factor = Math.min(
    1,
    choice.maxHeight / Math.min(asset.width, asset.height),
  );
  const width = Math.max(2, Math.round((asset.width * factor) / 2) * 2),
    height = Math.max(2, Math.round((asset.height * factor) / 2) * 2);
  const videoCodec = choice.format === 'mp4' ? 'avc' : 'vp9',
    audioCodec = choice.format === 'mp4' ? 'aac' : 'opus';
  if (
    !(await canEncodeVideo(videoCodec, { width, height })) ||
    !(await canEncodeAudio(audioCodec, {
      sampleRate: audio.sampleRate,
      numberOfChannels: audio.channels.length,
    }))
  )
    throw new Error(
      '当前浏览器不支持所选格式，请尝试 WebM 或换用 Chrome / Edge。',
    );
  const encoderDelay =
    audioCodec === 'aac'
      ? await measureAacDelay(audio.sampleRate, audio.channels.length, signal)
      : 0;
  const canvas = new OffscreenCanvas(width, height),
    ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器无法创建视频画布。');
  const output = new Output({
    format:
      choice.format === 'mp4'
        ? new Mp4OutputFormat({ fastStart: 'in-memory' })
        : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const vs = new CanvasSource(canvas, {
    codec: videoCodec,
    quality: new Quality({
      bitrate: Math.round(width * height * 0.11 * choice.fps),
    }),
    keyFrameInterval: 2,
  });
  const as = new AudioBufferSource({
    codec: audioCodec,
    quality: new Quality({ bitrate: 192000 }),
    transform: {
      process: (sample) => {
        if (choice.format === 'mp4')
          sample.setTimestamp(sample.timestamp + 0.001);
        return sample;
      },
    },
  });
  output.addVideoTrack(vs, { frameRate: choice.fps });
  output.addAudioTrack(as);
  let input: Input | null = null;
  let finished = false;
  try {
    await output.start();
    aborted(signal);
    const frames = Math.ceil(plan.duration * choice.fps),
      timestamps = Array.from({ length: frames }, (_, i) =>
        Math.min(asset.duration - 0.001, outputToSource(i / choice.fps, plan)),
      );
    let iterator: AsyncIterator<
      import('mediabunny').WrappedCanvas | null
    > | null = null;
    if (asset.file) {
      input = new Input({
        formats: ALL_FORMATS,
        source: new BlobSource(asset.file),
      });
      const track = await input.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode()))
        throw new Error('浏览器无法解码该视频画面。建议使用 H.264 MP4。');
      const firstTimestamp = await track.getFirstTimestamp();
      for (let i = 0; i < timestamps.length; i++)
        timestamps[i] = Math.max(firstTimestamp, timestamps[i]);
      const sink = new CanvasSink(track, {
        width,
        height,
        fit: 'contain',
        poolSize: 3,
      });
      iterator = sink.canvasesAtTimestamps(timestamps)[Symbol.asyncIterator]();
    }
    let audioOffset = 0;
    for (let i = 0; i < frames; i++) {
      aborted(signal);
      const t = i / choice.fps,
        sourceTime = timestamps[i];
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      if (iterator) {
        const next = await iterator.next();
        if (!next.value)
          throw new Error('视频解码缺少画面，请换用兼容格式后重试。');
        const frame = next.value.canvas;
        const spanIndex = plan.spans.findIndex(
          (s) => sourceTime >= s.sourceIn && sourceTime <= s.sourceOut,
        );
        const zoom = choice.punch && spanIndex % 2 === 1 ? 1.06 : 1;
        const dw = width * zoom,
          dh = height * zoom;
        ctx.drawImage(frame, (width - dw) / 2, (height - dh) / 2, dw, dh);
      } else drawDemo(ctx, sourceTime, asset);
      const fade = Math.min(1, t / 0.09, (plan.duration - t) / 0.25);
      if (fade < 1) {
        ctx.fillStyle = `rgba(0,0,0,${1 - fade})`;
        ctx.fillRect(0, 0, width, height);
      }
      await vs.add(t, Math.min(1 / choice.fps, plan.duration - t));
      if (audioOffset / audio.sampleRate <= t + 1) {
        const count = Math.min(
          audio.sampleRate,
          audio.channels[0].length - audioOffset,
        );
        if (count > 0) {
          const buffer = new AudioBuffer({
            numberOfChannels: audio.channels.length,
            length: count,
            sampleRate: audio.sampleRate,
          });
          audio.channels.forEach((c, ch) =>
            buffer.copyToChannel(
              new Float32Array(c.subarray(audioOffset, audioOffset + count)),
              ch,
            ),
          );
          await as.add(buffer);
          audioOffset += count;
        }
      }
      if (i % 8 === 0) {
        progress((i / frames) * 0.96);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    while (audioOffset < audio.channels[0].length) {
      aborted(signal);
      const count = Math.min(
          audio.sampleRate,
          audio.channels[0].length - audioOffset,
        ),
        buffer = new AudioBuffer({
          numberOfChannels: audio.channels.length,
          length: count,
          sampleRate: audio.sampleRate,
        });
      audio.channels.forEach((c, ch) =>
        buffer.copyToChannel(
          new Float32Array(c.subarray(audioOffset, audioOffset + count)),
          ch,
        ),
      );
      await as.add(buffer);
      audioOffset += count;
    }
    vs.close();
    as.close();
    await output.finalize();
    finished = true;
    aborted(signal);
    progress(1);
    const encoded =
      choice.format === 'mp4'
        ? trimAacPriming(
            output.target.buffer!,
            encoderDelay,
            plan.duration,
            frames / choice.fps,
          )
        : output.target.buffer!;
    return new Blob([encoded], {
      type: choice.format === 'mp4' ? 'video/mp4' : 'video/webm',
    });
  } finally {
    if (!finished) await output.cancel().catch(() => {});
    input?.dispose();
  }
}
