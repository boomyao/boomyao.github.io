import { analyzeAudio } from './dsp';
import { stretchAudio } from './stretch';
import wasmUrl from 'rubberband-wasm/dist/rubberband.wasm?url';
import type { AudioData, Plan } from './types';
self.onmessage = async (
  event: MessageEvent<{
    kind: 'analyze' | 'render';
    data: AudioData;
    plan?: Plan;
    smooth?: boolean;
    sensitivity?: number;
  }>,
) => {
  try {
    const { kind, data } = event.data;
    const progress = (value: number) =>
      self.postMessage({ type: 'progress', value });
    if (kind === 'analyze') {
      const result = analyzeAudio(
        data.channels,
        data.sampleRate,
        event.data.sensitivity,
        progress,
      );
      self.postMessage({ type: 'result', result });
    } else {
      const response = await fetch(wasmUrl);
      if (!response.ok) throw new Error('音频引擎加载失败，请刷新后重试。');
      const wasmModule = await WebAssembly.compile(
        await response.arrayBuffer(),
      );
      const result = await stretchAudio(
        data,
        event.data.plan!,
        wasmModule,
        !!event.data.smooth,
        progress,
      );
      self.postMessage(
        { type: 'result', result },
        { transfer: result.channels.map((c) => c.buffer as ArrayBuffer) },
      );
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : '处理失败，请重试。',
    });
  }
};
