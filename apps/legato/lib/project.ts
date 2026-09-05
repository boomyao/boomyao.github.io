import type { Analysis, Repair, Settings } from './audio/types';
import { clamp } from './audio/types';
import { buildPlan } from './audio/timeline';

type Source = { name: string; duration: number; file: File | null };
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('剪辑记录结构不完整。');
  return value as Record<string, unknown>;
}
function number(value: unknown, min: number, max: number) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error('剪辑记录包含无效的时间或参数。');
  return value;
}
export async function restoreProject(
  text: string,
  source: Source,
  analysis: Analysis,
) {
  if (text.length > 2000000) throw new Error('剪辑记录过大。');
  const p = record(JSON.parse(text));
  if (p.format !== 'legato-project' || ![1, 2, 3].includes(Number(p.version)))
    throw new Error('不是有效的顺奏剪辑记录。');
  const original = record(p.source);
  const time = (value: unknown) =>
    Math.min(number(value, 0, source.duration + 0.05), source.duration);
  const duration = number(original.duration, 0.5, 300);
  if (
    Math.abs(duration - source.duration) > 0.1 ||
    original.size !== (source.file?.size || 0)
  )
    throw new Error('这份剪辑记录属于另一个视频，请先导入对应原片。');
  let sha256: string | undefined;
  if (original.sha256 !== undefined) {
    if (
      typeof original.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(original.sha256) ||
      !source.file
    )
      throw new Error('剪辑记录的原片校验信息无效。');
    const hash = await crypto.subtle.digest(
      'SHA-256',
      await source.file.arrayBuffer(),
    );
    sha256 = Array.from(new Uint8Array(hash), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    if (sha256 !== original.sha256.toLowerCase())
      throw new Error('原片内容与精修工程不一致，无法套用这些剪辑点。');
  } else if (original.name !== source.name) {
    throw new Error('请先导入这份剪辑记录对应的原片。');
  }
  if (
    !Array.isArray(p.onsets) ||
    p.onsets.length > 3000 ||
    !Array.isArray(p.repairs) ||
    p.repairs.length > 500
  )
    throw new Error('剪辑记录结构不完整。');
  const s = record(p.settings);
  const settings: Settings = {
    bpm: number(s.bpm, 30, 180),
    strength: number(s.strength, 0, 100),
    start: time(s.start),
    end: time(s.end),
    keepLongNotes: !!s.keepLongNotes,
    smooth: !!s.smooth,
    timing: s.timing === 'automatic' ? 'automatic' : 'gentle',
  };
  if (settings.end - settings.start < 0.15)
    throw new Error('请保留至少一小段演奏。');
  if (s.precision !== undefined) {
    const v = record(s.precision);
    settings.precision = {
      leadIn: number(v.leadIn, 0.055, 5),
      tail: number(v.tail, 0.08, 10),
      crossfade: number(v.crossfade, 0, 0.08),
      attackBefore: number(v.attackBefore, 0, 0.06),
      attackAfter: number(v.attackAfter, 0, 0.06),
      fadeIn: number(v.fadeIn, 0, 2),
      fadeInStart: number(v.fadeInStart, 0, 1),
      fadeOut: number(v.fadeOut, 0, 3),
    };
  }
  const onsets: Analysis['onsets'] = p.onsets
    .map((value, i) => {
      const o = record(value);
      return {
        id: `note-${i}`,
        time: time(o.time),
        offset: number(o.offset, -0.15, 0.15),
        enabled: !!o.enabled,
        beats: o.beats === undefined ? undefined : number(o.beats, 0.1, 16),
        autoBeats:
          o.autoBeats === undefined ? undefined : number(o.autoBeats, 0.1, 16),
        autoConfidence:
          o.autoConfidence === undefined
            ? undefined
            : number(o.autoConfidence, 0, 1),
        autoReason:
          typeof o.autoReason === 'string'
            ? o.autoReason.slice(0, 120)
            : undefined,
        flowBeats:
          o.flowBeats === undefined ? undefined : number(o.flowBeats, 0.1, 16),
        reviewed: o.reviewed === true,
        strength: clamp(
          typeof o.strength === 'number' ? o.strength : 0.5,
          0,
          1,
        ),
      };
    })
    .sort((a, b) => a.time - b.time);
  const enabled = onsets.filter((o) => o.enabled);
  if (enabled.some((o, i) => i > 0 && o.time - enabled[i - 1].time < 0.05))
    throw new Error('发音点过于接近，请检查重复记录。');
  const repairs: Repair[] = p.repairs.map((value, i) => {
    const r = record(value);
    const start = time(r.start),
      end = time(r.end);
    if (end <= start) throw new Error('剪辑区间的结束时间需要晚于开始时间。');
    return {
      id: `import-${i}`,
      start,
      end,
      enabled: !!r.enabled,
      kind: r.kind === 'manual' ? 'manual' : 'pause',
      label:
        typeof r.label === 'string' ? r.label.slice(0, 80) : '导入的剪辑点',
    };
  });
  const next = { ...analysis, pulse: number(p.pulse, 0.2, 1), onsets };
  const plan = buildPlan(next, settings, repairs);
  if (
    !plan.spans.length ||
    !Number.isFinite(plan.duration) ||
    plan.duration > 600
  )
    throw new Error('这份剪辑记录没有可导出的有效时间线。');
  return {
    settings,
    repairs,
    analysis: next,
    punch: !!p.punch,
    fps: [24, 30, 48, 60].includes(Number(p.fps)) ? Number(p.fps) : 30,
    title: typeof p.title === 'string' ? p.title.slice(0, 120) : '',
    sha256,
  };
}
