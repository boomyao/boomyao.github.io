import type { Analysis, AudioData, Plan } from './types';
import AudioWorker from './audio.worker.ts?worker';
export function runAudioWorker<T>(
  kind: 'analyze' | 'render',
  data: AudioData,
  options: {
    plan?: Plan;
    smooth?: boolean;
    sensitivity?: number;
    signal?: AbortSignal;
    onProgress?: (n: number) => void;
  } = {},
) {
  return new Promise<T>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DOMException('已取消', 'AbortError'));
      return;
    }
    const worker = new AudioWorker();
    const abort = () => {
      worker.terminate();
      reject(new DOMException('已取消', 'AbortError'));
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    const cleanup = () => {
      worker.terminate();
      options.signal?.removeEventListener('abort', abort);
    };
    worker.onmessage = (e) => {
      if (e.data.type === 'progress') options.onProgress?.(e.data.value);
      if (e.data.type === 'result') {
        cleanup();
        resolve(e.data.result);
      }
      if (e.data.type === 'error') {
        cleanup();
        reject(new Error(e.data.message));
      }
    };
    worker.onerror = (e) => {
      cleanup();
      reject(new Error(e.message || '浏览器无法启动音频处理。'));
    };
    const channels = data.channels.map((c) => c.slice());
    worker.postMessage(
      {
        kind,
        data: { ...data, channels },
        plan: options.plan,
        smooth: options.smooth,
        sensitivity: options.sensitivity,
      },
      channels.map((c) => c.buffer),
    );
  });
}
export const analyze = (
  data: AudioData,
  options: Parameters<typeof runAudioWorker>[2],
) => runAudioWorker<Analysis>('analyze', data, options);
export const renderAudio = (
  data: AudioData,
  plan: Plan,
  smooth: boolean,
  signal: AbortSignal,
  onProgress: (n: number) => void,
) =>
  runAudioWorker<AudioData>('render', data, {
    plan,
    smooth,
    signal,
    onProgress,
  });
export function toAudioBuffer(data: AudioData) {
  const b = new AudioBuffer({
    numberOfChannels: data.channels.length,
    length: data.channels[0].length,
    sampleRate: data.sampleRate,
  });
  data.channels.forEach((c, i) => b.copyToChannel(new Float32Array(c), i));
  return b;
}
export function toWav(data: AudioData) {
  const { channels, sampleRate } = data,
    length = channels[0].length;
  const buffer = new ArrayBuffer(44 + length * channels.length * 2),
    v = new DataView(buffer);
  const text = (p: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  v.setUint32(4, buffer.byteLength - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels.length, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels.length * 2, true);
  v.setUint16(32, channels.length * 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, buffer.byteLength - 44, true);
  let p = 44;
  for (let i = 0; i < length; i++)
    for (const c of channels) {
      const n = Math.max(-1, Math.min(1, c[i]));
      v.setInt16(p, n < 0 ? n * 32768 : n * 32767, true);
      p += 2;
    }
  return new Blob([buffer], { type: 'audio/wav' });
}
