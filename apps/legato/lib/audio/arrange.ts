import {
  type Analysis,
  type Onset,
  type Repair,
  type Settings,
  clamp,
} from './types';

export type AttackFeature = {
  spectrum: number[];
  rise: number;
  novelty: number;
};

function percentile(values: number[], q: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * q)] ?? 0;
}

function similarity(a: number[], b: number[]) {
  let fine = 0,
    coarse = 0;
  const ac = new Float64Array(12),
    bc = new Float64Array(12);
  for (let i = 0; i < a.length; i++) {
    fine += a[i] * b[i];
    ac[i % 12] += a[i] ** 2;
    bc[i % 12] += b[i] ** 2;
  }
  for (let i = 0; i < 12; i++) coarse += Math.sqrt(ac[i] * bc[i]);
  return fine * 0.35 + coarse * 0.65;
}

const quantize = (gap: number, pulse: number) => {
  const ratio = gap / pulse;
  const options = [0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8];
  return options.reduce((best, n) =>
    Math.abs(n - ratio) < Math.abs(best - ratio) ? n : best,
  );
};

export function suggestArrangement(
  original: Onset[],
  features: AttackFeature[],
  pulse: number,
  confidence: number,
  waveform: number[],
  duration: number,
): NonNullable<Analysis['automatic']> {
  const notes = original.filter(
    (_, i) => !(features[i].rise < 0.13 && features[i].novelty < 0.24),
  );
  const spectra = notes.map((n) => features[original.indexOf(n)].spectrum);
  const gaps = notes.map((n, i) => (i ? n.time - notes[i - 1].time : 0));
  const ordinary = gaps.filter((g) => g > pulse * 0.72 && g < pulse * 1.3);
  const regularPulse = ordinary.length >= 6 ? percentile(ordinary, 0.5) : pulse;
  const regularity = ordinary.length / Math.max(1, notes.length - 1);
  let stableStart = notes[0]?.time ?? 0,
    stableEnd = stableStart,
    best = -Infinity;
  for (let i = 0; i + 7 < notes.length; i++) {
    const window = gaps.slice(i + 1, i + 8);
    const residual =
      window.reduce(
        (sum, g) =>
          sum +
          Math.min(1, Math.abs(g / regularPulse - quantize(g, regularPulse))),
        0,
      ) / window.length;
    const consistency =
      window.filter((g) => g > regularPulse * 0.72 && g < regularPulse * 1.3)
        .length / window.length;
    const score = consistency - residual * 2;
    if (score > best) {
      best = score;
      stableStart = notes[i].time;
      stableEnd = notes[i + 7].time;
    }
  }
  const reliable =
    notes.length >= 12 && confidence >= 0.5 && regularity >= 0.45;
  const cache = new Map<number, number>();
  const sim = (a: number, b: number) => {
    const key = Math.min(a, b) * notes.length + Math.max(a, b);
    let value = cache.get(key);
    if (value === undefined) {
      value = similarity(spectra[a], spectra[b]);
      cache.set(key, value);
    }
    return value;
  };
  const onsets = notes.map((n, i): Onset => {
    if (!i) return { ...n };
    const gap = gaps[i],
      own = quantize(gap, regularPulse);
    const matches: { gap: number; score: number }[] = [];
    if (reliable && notes.length <= 1800) {
      for (let j = 1; j < notes.length; j++) {
        if (Math.abs(i - j) < 5) continue;
        const core = Math.min(sim(i, j), sim(i - 1, j - 1));
        if (core < 0.76) continue;
        const sides = [-2, 1].filter(
          (d) =>
            i + d >= 0 &&
            j + d >= 0 &&
            i + d < notes.length &&
            j + d < notes.length,
        );
        const context =
          sides.reduce((sum, d) => sum + sim(i + d, j + d), 0) /
          Math.max(1, sides.length);
        if (context > 0.65)
          matches.push({ gap: gaps[j], score: core * 0.7 + context * 0.3 });
      }
    }
    matches.sort((a, b) => b.score - a.score);
    const peers = matches.slice(0, 8);
    const peerGap = peers.length
      ? Math.min(
          gap,
          percentile(
            peers.map((p) => p.gap),
            0.25,
          ),
        )
      : gap;
    let units = quantize(peerGap, regularPulse);
    let certainty =
      Math.abs(gap / regularPulse - own) < 0.2 && gap < regularPulse * 1.35
        ? 0.9
        : 0.58;
    let reason = '根据连续落音估计节奏';
    const supportedLong =
      units >= 1.5 &&
      peers.filter((p) => Math.abs(p.gap / regularPulse - units) < 0.22)
        .length >= 2;
    const dotted =
      i > 1 &&
      Math.abs(gaps[i - 1] / regularPulse - 0.5) < 0.1 &&
      Math.abs(gap / regularPulse - 1.5) < 0.12 &&
      supportedLong;
    if (peers.length >= 2) {
      const votes = peers.filter(
        (p) => quantize(p.gap, regularPulse) === units,
      ).length;
      if (votes >= 2 && votes / peers.length >= 0.55) {
        certainty = 0.86;
        reason = '同段录音中相似乐句的节奏一致';
      }
    }
    if (
      reliable &&
      !dotted &&
      i > 1 &&
      gaps[i - 1] < regularPulse * 0.7 &&
      gaps[i - 1] > regularPulse * 0.4 &&
      gap > regularPulse * 0.8 &&
      gap < regularPulse * 1.6
    ) {
      units = 0.5;
      certainty = peers.length >= 2 ? 0.8 : 0.64;
      reason = '短音后的停留可能是连奏犹豫';
    }
    const hasLongPeers =
      peers.filter(
        (p) => p.gap > regularPulse * 1.65 && p.gap < regularPulse * 2.6,
      ).length >= 2;
    if (supportedLong || (units >= 2 && hasLongPeers)) {
      certainty = 0.85;
      reason = '重复乐句支持保留长音';
    }
    if (
      reliable &&
      gap > regularPulse * 1.25 &&
      gap < regularPulse * 1.65 &&
      units === 1.5 &&
      !dotted &&
      !hasLongPeers
    ) {
      units = 1;
      certainty = Math.max(certainty, 0.7);
      reason = '连续节奏中局部拖慢';
    }
    const flowBeats =
      gap < regularPulse * 0.7
        ? quantize(gap, regularPulse)
        : hasLongPeers
          ? 2
          : 1;
    if (gap > Math.max(3.2 * regularPulse, 1.5) && !supportedLong) {
      units =
        hasLongPeers ||
        peers.some(
          (p) => p.gap > regularPulse * 1.7 && p.gap < regularPulse * 2.5,
        )
          ? 2
          : 1;
      certainty = 0.68;
      reason = '较长停留，已压缩多余等待；请试听乐句呼吸';
    }
    if (!reliable) {
      units = own;
      certainty = 0.3;
      reason = '节奏依据不足，保守整理';
    }
    return {
      ...n,
      autoBeats: units,
      autoConfidence: certainty,
      autoReason: reason,
      flowBeats: Math.min(units, flowBeats),
    };
  });
  const repairs: Repair[] = [];
  if (reliable) {
    for (let i = 1; i < onsets.length; i++) {
      const gap = gaps[i];
      if (gap <= Math.max(3.2 * regularPulse, 1.5)) continue;
      if (
        (onsets[i].autoConfidence ?? 0) >= 0.84 &&
        (onsets[i].autoBeats ?? 1) >= 2
      )
        continue;
      const before = onsets[i - 1].time,
        after = onsets[i].time;
      const desired = (onsets[i].autoBeats ?? 1) * regularPulse;
      const retain = Math.max(desired * 1.45, regularPulse * 1.4);
      const start = before + Math.max(0.28, retain * 0.67),
        end = after - Math.max(0.14, retain * 0.33);
      if (end - start < 0.25) continue;
      const a = Math.max(0, Math.floor((start / duration) * waveform.length)),
        b = Math.min(
          waveform.length,
          Math.ceil((end / duration) * waveform.length),
        );
      const low = percentile(waveform.slice(a, b), 0.35);
      repairs.push({
        id: `auto-pause-${i}`,
        start,
        end,
        enabled: low < 0.22,
        kind: 'pause',
        label: low < 0.22 ? '自动压缩的较长等待' : '仍有较强余音，等待试听确认',
      });
    }
  }
  return {
    pulse: regularPulse,
    confidence: reliable
      ? clamp(confidence * 0.55 + regularity * 0.45, 0, 1)
      : 0,
    stableStart,
    stableEnd,
    onsets,
    repairs,
  };
}

export function applyAutomatic(analysis: Analysis) {
  const automatic = analysis.automatic;
  const enabled = automatic && automatic.confidence > 0;
  const next = enabled
    ? { ...analysis, pulse: automatic.pulse, onsets: automatic.onsets }
    : analysis;
  const settings: Settings = {
    bpm: Math.round((30 / next.pulse) * 10) / 10,
    strength: enabled ? 100 : 55,
    keepLongNotes: true,
    start: analysis.suggestedStart,
    end: analysis.suggestedEnd,
    smooth: true,
    timing: enabled ? 'automatic' : 'gentle',
  };
  if (enabled)
    settings.precision = {
      leadIn: 0.28,
      tail: Math.min(
        1.25,
        analysis.suggestedEnd - (next.onsets.at(-1)?.time ?? 0),
      ),
      crossfade: 0.016,
      attackBefore: 0.027,
      attackAfter: 0.047,
      fadeIn: 0.08,
      fadeInStart: 0.08,
      fadeOut: 0.5,
    };
  return {
    analysis: next,
    settings,
    repairs: enabled ? automatic.repairs : analysis.repairs,
  };
}

export function reviewGroups(analysis: Analysis, settings: Settings) {
  if (settings.timing !== 'automatic') return [];
  const notes = analysis.onsets.filter(
    (n) => n.enabled && n.time >= settings.start && n.time <= settings.end,
  );
  const groups: {
    start: number;
    end: number;
    ids: string[];
    reason: string;
  }[] = [];
  notes.forEach((n, i) => {
    if (
      !i ||
      n.beats !== undefined ||
      n.reviewed ||
      n.autoBeats === undefined ||
      (n.autoConfidence ?? 1) >= 0.75
    )
      return;
    const gap = n.time - notes[i - 1].time;
    if (
      Math.abs(gap - n.autoBeats * analysis.pulse) < analysis.pulse * 0.28 &&
      n.autoBeats === n.flowBeats
    )
      return;
    const start = Math.max(
        settings.start,
        notes[i - 1].time - analysis.pulse * 0.6,
      ),
      end = Math.min(settings.end, n.time + analysis.pulse);
    const last = groups.at(-1);
    if (
      last &&
      start - last.end < analysis.pulse * 3 &&
      end - last.start < 12
    ) {
      last.end = end;
      last.ids.push(n.id);
    } else
      groups.push({
        start,
        end,
        ids: [n.id],
        reason: n.autoReason ?? '长音和犹豫需要试听确认',
      });
  });
  return groups;
}
