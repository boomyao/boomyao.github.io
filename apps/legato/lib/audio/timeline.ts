import {
  type Analysis,
  type Settings,
  type Repair,
  type Plan,
  type Span,
  type Knot,
  clamp,
} from './types';
export function interpolate(value: number, knots: Knot[], inverse = false) {
  if (!knots.length) return value;
  const x = (k: Knot) => (inverse ? k.target : k.source),
    y = (k: Knot) => (inverse ? k.source : k.target);
  let lo = 0,
    hi = knots.length - 1;
  if (value <= x(knots[0])) return y(knots[0]);
  if (value >= x(knots[hi])) return y(knots[hi]);
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (x(knots[m]) <= value) lo = m;
    else hi = m;
  }
  const r =
    (value - x(knots[lo])) / Math.max(1e-9, x(knots[hi]) - x(knots[lo]));
  return y(knots[lo]) * (1 - r) + y(knots[hi]) * r;
}
export function sourceToComposite(source: number, spans: Span[]) {
  for (const s of spans) {
    if (source < s.sourceIn) return s.compositeIn;
    if (source <= s.sourceOut) return s.compositeIn + source - s.sourceIn;
  }
  return spans.at(-1)?.compositeOut || 0;
}
export function outputToSource(time: number, plan: Plan) {
  const comp = interpolate(time, plan.knots, true);
  let s = plan.spans[0];
  for (const candidate of plan.spans)
    if (candidate.compositeIn <= comp) s = candidate;
  return s
    ? clamp(s.sourceIn + comp - s.compositeIn, s.sourceIn, s.sourceOut)
    : 0;
}
export function sourceToOutput(time: number, plan: Plan) {
  return interpolate(sourceToComposite(time, plan.spans), plan.knots);
}
export function buildPlan(
  analysis: Analysis,
  settings: Settings,
  repairs: Repair[],
): Plan {
  const start = clamp(settings.start, 0, Math.max(0, analysis.duration - 0.15));
  const end = clamp(settings.end, start + 0.15, analysis.duration);
  const precision = settings.precision;
  const crossfade = precision?.crossfade ?? 0.012;
  const removed = repairs
    .filter((r) => r.enabled)
    .map((r) => ({
      a: clamp(r.start, start, end),
      b: clamp(r.end, start, end),
    }))
    .filter((r) => r.b - r.a > 0.02)
    .sort((a, b) => a.a - b.a);
  const merged: { a: number; b: number }[] = [];
  for (const r of removed) {
    const prev = merged.at(-1);
    if (prev && r.a <= prev.b + 0.035) prev.b = Math.max(prev.b, r.b);
    else merged.push({ ...r });
  }
  let position = start,
    comp = 0;
  const spans: Span[] = [];
  for (const r of [...merged, { a: end, b: end }]) {
    if (r.a - position > 0.03) {
      const ci = spans.length
        ? Math.max(
            0,
            comp -
              Math.min(
                crossfade,
                (r.a - position) / 4,
                (spans.at(-1)!.sourceOut - spans.at(-1)!.sourceIn) / 4,
              ),
          )
        : 0;
      spans.push({
        sourceIn: position,
        sourceOut: r.a,
        compositeIn: ci,
        compositeOut: ci + r.a - position,
      });
      comp = ci + r.a - position;
    }
    position = Math.max(position, r.b);
  }
  if (!spans.length)
    return {
      spans: [],
      knots: [],
      duration: 0,
      sourceDuration: end - start,
      crossfade,
      anchors: [],
    };
  const notes = analysis.onsets.filter(
    (o) =>
      o.enabled &&
      spans.some(
        (s) => o.time >= s.sourceIn + 0.01 && o.time <= s.sourceOut - 0.01,
      ),
  );
  const base = analysis.pulse,
    target = 30 / clamp(settings.bpm, 30, 180),
    strength = clamp(settings.strength / 100, 0, 1);
  const anchors: Plan['anchors'] = [];
  let prevComp = 0,
    prevTarget = 0;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i],
      c = sourceToComposite(n.time, spans),
      gap = c - prevComp;
    let d = gap;
    if (i > 0 && gap > 0.085) {
      const inferred =
        settings.timing === 'automatic' ? n.autoBeats : undefined;
      const units =
        n.beats ?? inferred ?? Math.max(0.5, Math.round((gap / base) * 2) / 2);
      const long = gap > base * 2.4;
      if (
        n.beats !== undefined ||
        inferred !== undefined ||
        !(long && settings.keepLongNotes)
      ) {
        const wanted = units * target;
        d =
          n.beats !== undefined
            ? wanted
            : clamp(
                gap + (wanted - gap) * strength,
                gap / (inferred !== undefined ? 3 : 1.75),
                gap / (inferred !== undefined ? 0.65 : 0.75),
              );
      }
    }
    let t =
      (i === 0 && precision
        ? settings.timing === 'automatic'
          ? Math.min(c, precision.leadIn)
          : precision.leadIn
        : prevTarget + d) +
      n.offset -
      (i ? notes[i - 1].offset : 0);
    t = Math.max(prevTarget + 0.055, t);
    anchors.push({ id: n.id, source: n.time, target: t });
    prevComp = c;
    prevTarget = t;
  }
  const total = spans.at(-1)!.compositeOut;
  const duration =
    prevTarget +
    (precision && anchors.length && settings.timing !== 'automatic'
      ? precision.tail
      : total - prevComp);
  const knots: Knot[] = [{ source: 0, target: 0 }];
  anchors.forEach((a, i) => {
    const c = sourceToComposite(a.source, spans);
    const before = Math.min(
      precision?.attackBefore ?? 0.022,
      (c - (i ? sourceToComposite(anchors[i - 1].source, spans) : 0)) *
        (precision ? 0.45 : 0.22),
      (a.target - (i ? anchors[i - 1].target : 0)) * (precision ? 0.45 : 0.22),
    );
    const after = Math.min(
      precision?.attackAfter ?? 0.042,
      ((i + 1 < anchors.length
        ? sourceToComposite(anchors[i + 1].source, spans)
        : total) -
        c) *
        (precision ? 0.45 : 0.22),
      ((i + 1 < anchors.length ? anchors[i + 1].target : duration) - a.target) *
        (precision ? 0.45 : 0.22),
    );
    for (const k of [
      { source: c - before, target: a.target - before },
      { source: c, target: a.target },
      { source: c + after, target: a.target + after },
    ])
      if (
        k.source > knots.at(-1)!.source + 1e-5 &&
        k.target > knots.at(-1)!.target + 1e-5
      )
        knots.push(k);
  });
  if (total > knots.at(-1)!.source + 1e-5)
    knots.push({ source: total, target: duration });
  return {
    spans,
    knots,
    duration,
    sourceDuration: analysis.duration,
    crossfade,
    anchors,
    fadeIn: precision?.fadeIn,
    fadeInStart: precision?.fadeInStart,
    fadeOut: precision?.fadeOut,
  };
}
