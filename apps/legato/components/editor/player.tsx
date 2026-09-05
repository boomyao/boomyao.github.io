'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  Volume2,
  VolumeX,
  LoaderCircle,
  Film,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { type MediaAsset, drawDemo } from '@/lib/media';
import {
  type AudioData,
  type Plan,
  formatTime,
  clamp,
} from '@/lib/audio/types';
import { outputToSource, sourceToOutput } from '@/lib/audio/timeline';
import { toAudioBuffer } from '@/lib/audio/client';
type Props = {
  asset: MediaAsset;
  plan: Plan | null;
  mode: 'original' | 'edited';
  onMode: (mode: 'original' | 'edited') => void;
  prepare: () => Promise<AudioData | null>;
  onPosition: (source: number) => void;
  seek: {
    time: number;
    id: number;
    play?: boolean;
    end?: number;
    original?: boolean;
  };
  busy: boolean;
  punch: boolean;
  appliedCuts: number;
  confirmedNotes: number;
  automatic: boolean;
  reviewCount: number;
};
export function Player({
  asset,
  plan,
  mode,
  onMode,
  prepare,
  onPosition,
  seek,
  busy,
  punch,
  appliedCuts,
  confirmedNotes,
  automatic,
  reviewCount,
}: Props) {
  const video = useRef<HTMLVideoElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    context = useRef<AudioContext | null>(null),
    node = useRef<AudioBufferSourceNode | null>(null),
    gain = useRef<GainNode | null>(null),
    raf = useRef(0),
    sourcePos = useRef(0),
    playingRef = useRef(false),
    playVersion = useRef(0),
    startClock = useRef(0),
    startOffset = useRef(0),
    limitRef = useRef(0);
  const [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0),
    [muted, setMuted] = useState(false),
    [starting, setStarting] = useState(false),
    [error, setError] = useState('');
  const duration = mode === 'edited' && plan ? plan.duration : asset.duration;
  const auditionEnd = useRef<number | undefined>(undefined);
  const previewLabel = automatic
    ? reviewCount
      ? '自动初稿'
      : '整理结果'
    : confirmedNotes
      ? '精修结果'
      : appliedCuts
        ? '剪辑结果'
        : '节奏预览';
  const stop = useCallback(() => {
    playVersion.current++;
    playingRef.current = false;
    cancelAnimationFrame(raf.current);
    if (node.current) {
      node.current.onended = null;
      try {
        node.current.stop();
      } catch {}
      node.current.disconnect();
      node.current = null;
    }
    gain.current?.disconnect();
    gain.current = null;
    video.current?.pause();
    setPlaying(false);
    setStarting(false);
  }, []);
  const seekSource = useCallback(
    (source: number) => {
      stop();
      source = clamp(source, 0, Math.max(0, asset.duration - 0.01));
      sourcePos.current = source;
      setTime(
        mode === 'edited' && plan ? sourceToOutput(source, plan) : source,
      );
      onPosition(source);
      if (video.current) video.current.currentTime = source;
      const ctx = canvas.current?.getContext('2d');
      if (ctx && asset.demoNotes) drawDemo(ctx, source, asset);
    },
    [asset, mode, onPosition, plan, stop],
  );
  const seekAction = useRef(seekSource);
  seekAction.current = seekSource;
  useEffect(() => {
    stop();
    setTime(
      mode === 'edited' && plan
        ? sourceToOutput(sourcePos.current, plan)
        : sourcePos.current,
    );
  }, [mode, plan, stop]);
  useEffect(() => {
    sourcePos.current = 0;
    setTime(0);
    setError('');
    const ctx = canvas.current?.getContext('2d');
    if (ctx && asset.demoNotes) drawDemo(ctx, 0, asset);
    return () => stop();
  }, [asset, stop]);
  useEffect(
    () => () => {
      void context.current?.close();
    },
    [],
  );
  useEffect(() => {
    if (gain.current) gain.current.gain.value = muted ? 0 : 1;
  }, [muted]);
  const play = useCallback(async () => {
    if (playingRef.current) {
      stop();
      return;
    }
    if (busy || starting) return;
    if (!context.current) context.current = new AudioContext();
    await context.current.resume();
    setStarting(true);
    setError('');
    const version = ++playVersion.current;
    try {
      const data = mode === 'edited' ? await prepare() : asset.audio;
      if (!data || version !== playVersion.current) return;
      const buffer = toAudioBuffer(data);
      let offset =
        mode === 'edited' && plan
          ? sourceToOutput(sourcePos.current, plan)
          : sourcePos.current;
      if (offset >= buffer.duration - 0.06) offset = 0;
      const audioNode = context.current.createBufferSource(),
        g = context.current.createGain();
      audioNode.buffer = buffer;
      g.gain.value = muted ? 0 : 1;
      audioNode.connect(g);
      g.connect(context.current.destination);
      node.current = audioNode;
      gain.current = g;
      startClock.current = context.current.currentTime + 0.025;
      startOffset.current = offset;
      const end = auditionEnd.current;
      auditionEnd.current = undefined;
      limitRef.current = Math.min(
        buffer.duration,
        end === undefined
          ? buffer.duration
          : mode === 'edited' && plan
            ? sourceToOutput(end, plan)
            : end,
      );
      if (limitRef.current <= offset) limitRef.current = buffer.duration;
      audioNode.start(startClock.current, offset, limitRef.current - offset);
      playingRef.current = true;
      setPlaying(true);
      setStarting(false);
      if (video.current) {
        video.current.muted = true;
        video.current.currentTime =
          mode === 'edited' && plan ? outputToSource(offset, plan) : offset;
        void video.current.play().catch(() => {});
      }
      const tick = () => {
        if (!playingRef.current || !context.current) return;
        const out = clamp(
          startOffset.current +
            context.current.currentTime -
            startClock.current,
          0,
          limitRef.current,
        );
        const source =
          mode === 'edited' && plan ? outputToSource(out, plan) : out;
        sourcePos.current = source;
        setTime(out);
        onPosition(source);
        const v = video.current;
        if (v) {
          const next =
            mode === 'edited' && plan
              ? outputToSource(Math.min(out + 0.04, plan.duration), plan)
              : source + 0.04;
          const speed = clamp((next - source) / 0.04, 0.25, 3.5);
          v.playbackRate = speed;
          if (Math.abs(v.currentTime - source) > 0.075 && !v.seeking)
            v.currentTime = source;
          if (v.paused && !v.ended) void v.play().catch(() => {});
          const span =
            plan?.spans.findIndex(
              (s) => source >= s.sourceIn && source <= s.sourceOut,
            ) ?? 0;
          v.style.transform =
            mode === 'edited' && punch && span % 2 === 1
              ? 'scale(1.06)'
              : 'scale(1)';
        }
        const ctx = canvas.current?.getContext('2d');
        if (ctx && asset.demoNotes) drawDemo(ctx, source, asset);
        if (out >= limitRef.current - 0.01) {
          stop();
          return;
        }
        raf.current = requestAnimationFrame(tick);
      };
      audioNode.onended = () => {
        if (version === playVersion.current) stop();
      };
      raf.current = requestAnimationFrame(tick);
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法播放');
      stop();
    } finally {
      if (version === playVersion.current) setStarting(false);
    }
  }, [
    asset,
    busy,
    mode,
    muted,
    onPosition,
    plan,
    prepare,
    punch,
    starting,
    stop,
  ]);
  const playAction = useRef(play);
  playAction.current = play;
  useEffect(() => {
    seekAction.current(seek.time);
    auditionEnd.current = seek.play ? seek.end : undefined;
    if (seek.play) void playAction.current();
  }, [seek.id, seek.time, seek.play, seek.end]);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (
        e.code === 'Space' &&
        !['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(el.tagName) &&
        !el.closest('[role=slider],[role=tab],[role=dialog]')
      ) {
        e.preventDefault();
        void play();
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [play]);
  return (
    <section className="viewer">
      <div className="viewer-head">
        <span className="viewer-label">
          <Film size={15} />
          演奏画面
        </span>
        <Tabs
          value={mode}
          onValueChange={(v) => onMode(v as 'original' | 'edited')}
          className="editor-tabs"
        >
          <TabsList>
            <TabsTrigger value="original">原片</TabsTrigger>
            <TabsTrigger value="edited" disabled={!plan}>
              {previewLabel}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div
        className="px-5 py-2 text-sm text-[#b7c1ce] bg-[#171a20]"
        aria-live="polite"
      >
        {mode === 'original'
          ? `正在对比原片 · ${formatTime(asset.duration)}`
          : `当前${previewLabel} · ${formatTime(asset.duration)} → ${formatTime(duration)} · ${appliedCuts ? `已应用 ${appliedCuts} 处剪切` : '未应用停顿剪辑'}${automatic ? ` · ${reviewCount ? `${reviewCount} 段建议试听` : '已完成试听确认'}` : confirmedNotes ? ` · ${confirmedNotes} 个确认拍位` : ''}`}
      </div>
      <div
        className="video-stage"
        style={{
          aspectRatio: `${asset.width}/${asset.height}`,
          maxHeight: 560,
        }}
      >
        {asset.demoNotes ? (
          <canvas ref={canvas} width={1280} height={720} />
        ) : (
          <video ref={video} src={asset.url} playsInline muted preload="auto" />
        )}
        {starting && (
          <div className="busy-overlay">
            <LoaderCircle className="spin" size={26} />
            <p>正在准备修剪后的声音</p>
          </div>
        )}
      </div>
      <div className="transport">
        <div className="transport-left">
          <button
            className="icon-btn"
            onClick={() =>
              seekSource(
                mode === 'edited' && plan ? plan.spans[0]?.sourceIn || 0 : 0,
              )
            }
            aria-label="回到开头"
          >
            <SkipBack size={16} />
          </button>
          <button
            className="play-btn"
            onClick={() => void play()}
            disabled={busy && !playing}
            aria-label={playing ? '暂停' : '播放'}
          >
            {starting ? (
              <LoaderCircle size={17} className="spin" />
            ) : playing ? (
              <Pause size={17} fill="currentColor" />
            ) : (
              <Play size={17} fill="currentColor" />
            )}
          </button>
          <span className="timecode">
            {formatTime(time)} <span>/ {formatTime(duration)}</span>
          </span>
        </div>
        <div className="transport-right">
          <span className="eyebrow hidden sm:block">
            {mode === 'original' ? 'ORIGINAL' : 'EDITED'}
          </span>
          <button
            className="icon-btn"
            aria-label={muted ? '打开声音' : '静音'}
            onClick={() => setMuted(!muted)}
          >
            {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </button>
        </div>
      </div>
      <div className="px-5 pb-3 bg-[#171a20]">
        <Slider
          value={[time]}
          min={0}
          max={Math.max(duration, 0.1)}
          step={0.02}
          onValueChange={(v) => {
            const t = Array.isArray(v) ? v[0] : v;
            seekSource(mode === 'edited' && plan ? outputToSource(t, plan) : t);
          }}
          aria-label="播放位置"
        />
      </div>
      {error && (
        <p role="alert" className="px-5 pb-3 text-sm text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
