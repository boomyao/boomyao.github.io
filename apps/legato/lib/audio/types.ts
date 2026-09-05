export type Onset = {
  id: string;
  time: number;
  strength: number;
  enabled: boolean;
  offset: number;
  beats?: number;
  autoBeats?: number;
  autoConfidence?: number;
  autoReason?: string;
  flowBeats?: number;
  reviewed?: boolean;
};
export type Repair = {
  id: string;
  start: number;
  end: number;
  enabled: boolean;
  kind: 'pause' | 'manual';
  label: string;
};
export type Analysis = {
  onsets: Onset[];
  pulse: number;
  confidence: number;
  repairs: Repair[];
  waveform: number[];
  duration: number;
  suggestedStart: number;
  suggestedEnd: number;
  automatic?: {
    pulse: number;
    confidence: number;
    stableStart: number;
    stableEnd: number;
    onsets: Onset[];
    repairs: Repair[];
  };
};
export type Span = {
  sourceIn: number;
  sourceOut: number;
  compositeIn: number;
  compositeOut: number;
};
export type Knot = { source: number; target: number };
export type Plan = {
  spans: Span[];
  knots: Knot[];
  duration: number;
  sourceDuration: number;
  crossfade: number;
  anchors: { id: string; source: number; target: number }[];
  fadeIn?: number;
  fadeInStart?: number;
  fadeOut?: number;
};
export type Settings = {
  bpm: number;
  strength: number;
  keepLongNotes: boolean;
  start: number;
  end: number;
  smooth: boolean;
  timing?: 'automatic' | 'gentle';
  precision?: {
    leadIn: number;
    tail: number;
    crossfade: number;
    attackBefore: number;
    attackAfter: number;
    fadeIn: number;
    fadeInStart: number;
    fadeOut: number;
  };
};
export type AudioData = { channels: Float32Array[]; sampleRate: number };
export const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));
export function formatTime(n: number, precise = false) {
  n = Math.max(0, n || 0);
  return `${Math.floor(n / 60)
    .toString()
    .padStart(
      2,
      '0',
    )}:${(n % 60).toFixed(precise ? 2 : 1).padStart(precise ? 5 : 4, '0')}`;
}
