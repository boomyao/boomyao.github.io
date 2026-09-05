import FFT from 'fft.js';
import { type Analysis, type Onset, type Repair, clamp } from './types';
import { suggestArrangement, type AttackFeature } from './arrange';

function quantile(values: number[], q: number) {
  const a = [...values].sort((x, y) => x - y);
  return a[Math.floor((a.length - 1) * q)] || 0;
}
export function estimatePulse(times: number[]) {
  const gaps = times
    .slice(1)
    .map((t, i) => t - times[i])
    .filter((x) => x > 0.14 && x < 1.8);
  if (gaps.length < 5) return { pulse: 0.45, confidence: 0 };
  let best = 0.45,
    bestCost = Infinity;
  for (let p = 0.3; p <= 0.751; p += 0.002) {
    const errors = gaps
      .map((d) => {
        const u = Math.max(0.5, Math.round((d / p) * 2) / 2);
        const residual = Math.abs(d - u * p) / p;
        return (
          Math.min(0.4, residual) +
          Math.max(0, u - 1) * 0.018 +
          (u === 0.5 ? 0.024 : 0)
        );
      })
      .sort((a, b) => a - b);
    const take = Math.ceil(errors.length * 0.8);
    const cost =
      errors.slice(0, take).reduce((a, b) => a + b, 0) / take +
      Math.abs(Math.log(p / 0.445)) * 0.013;
    if (cost < bestCost) {
      bestCost = cost;
      best = p;
    }
  }
  return { pulse: best, confidence: clamp(1 - bestCost * 4.2, 0, 1) };
}
export function analyzeAudio(
  channels: Float32Array[],
  sampleRate: number,
  sensitivity = 1,
  progress: (n: number) => void = () => {},
): Analysis {
  const src = channels[0],
    duration = src.length / sampleRate;
  const rate = 22050,
    size = 2048,
    hop = 128,
    bins = 72;
  const length = Math.floor(duration * rate),
    mono = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const position = (i * sampleRate) / rate;
    const j = Math.floor(position),
      r = position - j;
    for (const c of channels)
      mono[i] +=
        ((c[j] || 0) * (1 - r) + (c[j + 1] || 0) * r) / channels.length;
  }
  const fft = new FFT(size),
    window = Float64Array.from(
      { length: size },
      (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)),
    );
  const frame = new Float64Array(size),
    spectrum = fft.createComplexArray();
  const binMap = new Int16Array(size / 2 + 1).fill(-1);
  const mel = (hz: number) => 2595 * Math.log10(1 + hz / 700),
    low = mel(100),
    high = mel(6000);
  for (let k = 0; k < binMap.length; k++) {
    const hz = (k * rate) / size;
    if (hz >= 100 && hz <= 6000)
      binMap[k] = Math.min(
        bins - 1,
        Math.floor(((mel(hz) - low) / (high - low)) * bins),
      );
  }
  const count = Math.max(1, Math.floor((length - 1) / hop) + 1),
    bands = new Float32Array(count * bins);
  const pitchBins = Array.from({ length: 60 }, (_, i) => {
    const frequency = 440 * 2 ** ((i + 36 - 69) / 12);
    const low = Math.ceil((frequency * 2 ** (-0.55 / 12) * size) / rate);
    const high = Math.floor((frequency * 2 ** (0.55 / 12) * size) / rate);
    return Array.from(
      { length: Math.max(0, high - low + 1) },
      (_, k) => k + low,
    );
  });
  const pitches = new Float32Array(count * 60);
  let maxPower = 1e-12;
  for (let f = 0; f < count; f++) {
    const begin = f * hop - size / 2;
    for (let i = 0; i < size; i++)
      frame[i] = (mono[begin + i] || 0) * window[i];
    fft.realTransform(spectrum, frame);
    for (let p = 0; p < pitchBins.length; p++) {
      let peak = 0;
      for (const k of pitchBins[p])
        peak = Math.max(peak, spectrum[k * 2] ** 2 + spectrum[k * 2 + 1] ** 2);
      pitches[f * 60 + p] = peak;
    }
    for (let k = 1; k <= size / 2; k++) {
      const b = binMap[k];
      if (b >= 0) {
        const power = spectrum[k * 2] ** 2 + spectrum[k * 2 + 1] ** 2;
        bands[f * bins + b] += power;
      }
    }
    for (let b = 0; b < bins; b++)
      maxPower = Math.max(maxPower, bands[f * bins + b]);
    if (f % 300 === 0) progress((f / count) * 0.65);
  }
  const floor = 10 * Math.log10(maxPower) - 44,
    flux = new Float32Array(count);
  for (let f = 1; f < count; f++) {
    let sum = 0;
    for (let b = 0; b < bins; b++) {
      const cur = Math.max(floor, 10 * Math.log10(bands[f * bins + b] + 1e-12));
      const prev = Math.max(
        floor,
        10 * Math.log10(bands[(f - 1) * bins + b] + 1e-12),
      );
      sum += Math.max(0, cur - prev);
    }
    flux[f] = sum / bins;
  }
  const positive = Array.from(flux).filter((x) => x > 0.01);
  const baseline = quantile(positive, 0.5);
  const top = quantile(positive, 0.98);
  const threshold = Math.max(
    0.12,
    baseline + (top - baseline) * (0.28 / clamp(sensitivity, 0.5, 2)),
  );
  const candidates: { frame: number; value: number }[] = [];
  for (let i = 2; i < count - 2; i++)
    if (
      flux[i] > threshold &&
      flux[i] >= flux[i - 1] &&
      flux[i] > flux[i + 1]
    ) {
      const nearby = Math.round((0.07 * rate) / hop);
      let l = flux[i],
        r = flux[i];
      for (let j = 1; j <= nearby; j++) {
        l = Math.min(l, flux[Math.max(0, i - j)]);
        r = Math.min(r, flux[Math.min(count - 1, i + j)]);
      }
      if (flux[i] - Math.max(l, r) > Math.max(0.07, threshold * 0.3))
        candidates.push({ frame: i, value: flux[i] });
    }
  candidates.sort((a, b) => b.value - a.value);
  const chosen: typeof candidates = [];
  for (const c of candidates)
    if (!chosen.some((p) => (Math.abs(p.frame - c.frame) * hop) / rate < 0.125))
      chosen.push(c);
  chosen.sort((a, b) => a.frame - b.frame);
  const maxFlux = Math.max(0.001, ...chosen.map((c) => c.value));
  const onsets: Onset[] = chosen
    .map((c, i) => ({
      id: `note-${i}`,
      time: clamp((c.frame * hop) / rate - 0.012, 0, duration),
      strength: c.value / maxFlux,
      enabled: true,
      offset: 0,
    }))
    .filter((o) => o.time > 0.03 && o.time < duration - 0.08);
  const { pulse, confidence } = estimatePulse(onsets.map((o) => o.time));
  const repairs: Repair[] = [];
  for (let i = 0; i < onsets.length - 1; i++) {
    const a = onsets[i].time,
      b = onsets[i + 1].time,
      gap = b - a;
    if (gap > Math.max(3.2 * pulse, 1.5)) {
      const start = a + Math.max(0.3, pulse * 0.7),
        end = b - Math.max(0.2, pulse * 0.45);
      if (end - start > 0.25)
        repairs.push({
          id: `pause-${i}`,
          start,
          end,
          enabled: false,
          kind: 'pause',
          label: '较长的发音间隔',
        });
    }
  }
  const waveform: number[] = [];
  const block = Math.max(1, Math.floor(src.length / 1800));
  for (let i = 0; i < src.length; i += block) {
    let p = 0;
    for (let j = i; j < Math.min(i + block, src.length); j++)
      p = Math.max(p, Math.abs(src[j]));
    waveform.push(p);
  }
  const peak = Math.max(0.001, ...waveform);
  for (let i = 0; i < waveform.length; i++) waveform[i] /= peak;
  const features: AttackFeature[] = onsets.map((n) => {
    const f = Math.round(((n.time + 0.012) * rate) / hop);
    const before = new Float64Array(60),
      after = new Float64Array(60);
    for (let p = 0; p < 60; p++) {
      let bc = 0,
        ac = 0;
      for (let j = Math.max(0, f - 12); j < Math.max(1, f - 3); j++) {
        before[p] += pitches[j * 60 + p];
        bc++;
      }
      for (let j = f + 5; j < Math.min(count, f + 24); j++) {
        after[p] += pitches[j * 60 + p];
        ac++;
      }
      before[p] /= Math.max(1, bc);
      after[p] /= Math.max(1, ac);
    }
    const fresh = Array.from(after, (v, p) => Math.max(0, v - before[p] * 0.7));
    const energy = fresh.reduce((s, v) => s + v, 0);
    const afterEnergy = after.reduce((s, v) => s + v, 0);
    return {
      spectrum: fresh.map((v) => Math.sqrt(v / Math.max(1e-12, energy))),
      rise:
        afterEnergy /
        Math.max(
          1e-12,
          before.reduce((s, v) => s + v, 0),
        ),
      novelty: energy / Math.max(1e-12, afterEnergy),
    };
  });
  progress(0.9);
  const automatic = suggestArrangement(
    onsets,
    features,
    pulse,
    confidence,
    waveform,
    duration,
  );
  progress(1);
  return {
    onsets,
    pulse,
    confidence,
    repairs,
    waveform,
    duration,
    suggestedStart: onsets.length ? Math.max(0, onsets[0].time - 0.28) : 0,
    suggestedEnd: onsets.length
      ? Math.min(duration, onsets[onsets.length - 1].time + 1.25)
      : duration,
    automatic,
  };
}
