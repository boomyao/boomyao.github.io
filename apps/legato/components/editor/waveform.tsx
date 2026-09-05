'use client';
import { useEffect, useRef, useState } from 'react';
import {
  type Analysis,
  type Repair,
  formatTime,
  clamp,
} from '@/lib/audio/types';
type Props = {
  analysis: Analysis;
  repairs: Repair[];
  position: number;
  zoom: number;
  selection: [number, number] | null;
  selectedNote: string | null;
  onSeek: (t: number) => void;
  onSelect: (range: [number, number]) => void;
  onNote: (id: string) => void;
  start: number;
  end: number;
};
export function Waveform({
  analysis,
  repairs,
  position,
  zoom,
  selection,
  selectedNote,
  onSeek,
  onSelect,
  onNote,
  start,
  end,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null),
    wrap = useRef<HTMLDivElement>(null),
    drag = useRef<{ x: number; t: number } | null>(null);
  const [width, setWidth] = useState(900);
  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver((entries) =>
      setWidth(entries[0].contentRect.width),
    );
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = 148 * dpr;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, 148);
    const duration = analysis.duration,
      px = (t: number) => (t / duration) * width;
    ctx.font = '11px ui-monospace,monospace';
    ctx.textBaseline = 'top';
    const step = duration / (width / 90);
    const nice =
      [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120].find((n) => n >= step) || 120;
    for (let t = 0; t <= duration; t += nice) {
      const x = px(t);
      ctx.strokeStyle = '#29313b';
      ctx.beginPath();
      ctx.moveTo(x, 22);
      ctx.lineTo(x, 140);
      ctx.stroke();
      ctx.fillStyle = '#768395';
      ctx.fillText(formatTime(t), x + 4, 3);
    }
    ctx.fillStyle = '#0a0d1390';
    ctx.fillRect(0, 22, px(start), 118);
    ctx.fillRect(px(end), 22, width - px(end), 118);
    for (const repair of repairs) {
      ctx.fillStyle = repair.enabled ? '#eeae5738' : '#eeae5712';
      ctx.fillRect(
        px(repair.start),
        23,
        Math.max(1, px(repair.end - repair.start)),
        115,
      );
      ctx.strokeStyle = repair.enabled ? '#d7a15a' : '#6b573c';
      ctx.strokeRect(
        px(repair.start),
        23,
        Math.max(1, px(repair.end - repair.start)),
        115,
      );
    }
    const wave = analysis.waveform;
    ctx.fillStyle = '#749ccc';
    const bars = Math.floor(width / 2.5);
    for (let i = 0; i < bars; i++) {
      const from = Math.floor((i / bars) * wave.length),
        to = Math.max(from + 1, Math.floor(((i + 1) / bars) * wave.length));
      let amplitude = 0;
      for (let j = from; j < to; j++)
        amplitude = Math.max(amplitude, wave[j] || 0);
      const h = Math.max(1, Math.pow(amplitude, 0.65) * 37);
      ctx.fillRect(
        (i * width) / bars,
        79 - h,
        Math.max(1, width / bars - 1),
        h * 2,
      );
    }
    for (const o of analysis.onsets) {
      const x = px(o.time);
      ctx.strokeStyle =
        o.id === selectedNote ? '#d6f77a' : o.enabled ? '#849fcc85' : '#495366';
      ctx.lineWidth = o.id === selectedNote ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 43);
      ctx.lineTo(x, 124);
      ctx.stroke();
      ctx.fillStyle =
        o.id === selectedNote ? '#d6f77a' : o.enabled ? '#8cafef' : '#4c5563';
      ctx.beginPath();
      ctx.arc(x, 129, o.id === selectedNote ? 4 : 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    if (selection) {
      ctx.fillStyle = '#b4d5ff20';
      ctx.fillRect(px(selection[0]), 22, px(selection[1] - selection[0]), 118);
      ctx.strokeStyle = '#b4d5ff';
      ctx.strokeRect(
        px(selection[0]),
        22,
        px(selection[1] - selection[0]),
        118,
      );
    }
  }, [analysis, repairs, width, zoom, selection, selectedNote, start, end]);
  const point = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    return clamp(
      ((e.clientX - r.left) / r.width) * analysis.duration,
      0,
      analysis.duration,
    );
  };
  return (
    <div className="wave-scroll">
      <div
        ref={wrap}
        className="wave-wrap"
        style={{ width: `${zoom * 100}%` }}
        role="slider"
        tabIndex={0}
        aria-label="原片时间线，拖动选择范围，点击下方发音点微调"
        aria-valuemin={0}
        aria-valuemax={analysis.duration}
        aria-valuenow={position}
        aria-valuetext={formatTime(position)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            onSeek(
              clamp(
                position + (e.key === 'ArrowRight' ? 0.1 : -0.1),
                0,
                analysis.duration,
              ),
            );
          }
        }}
        onPointerDown={(e) => {
          const t = point(e);
          drag.current = { x: e.clientX, t };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current && Math.abs(e.clientX - drag.current.x) > 5) {
            const t = point(e);
            onSelect([
              Math.min(t, drag.current.t),
              Math.max(t, drag.current.t),
            ]);
          }
        }}
        onPointerUp={(e) => {
          if (!drag.current) return;
          const t = point(e),
            d = drag.current;
          drag.current = null;
          if (Math.abs(e.clientX - d.x) <= 5) {
            const r = wrap.current!.getBoundingClientRect();
            if (e.clientY - r.top > 112) {
              const note = analysis.onsets.reduce(
                (a, b) => (Math.abs(b.time - t) < Math.abs(a.time - t) ? b : a),
                analysis.onsets[0],
              );
              if (
                note &&
                (Math.abs(note.time - t) / analysis.duration) * width < 10
              ) {
                onNote(note.id);
                return;
              }
            }
            onSeek(t);
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <canvas ref={canvas} />
        <div
          className="playhead"
          style={{
            left: `${clamp((position / analysis.duration) * 100, 0, 100)}%`,
          }}
        />
      </div>
    </div>
  );
}
