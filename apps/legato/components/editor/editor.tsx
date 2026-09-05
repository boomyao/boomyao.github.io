'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload,
  Music2,
  ShieldCheck,
  ArrowUpRight,
  Film,
  AudioLines,
  Play,
  SlidersHorizontal,
  WandSparkles,
  Download,
  LoaderCircle,
  Undo2,
  Redo2,
  RotateCcw,
  Scissors,
  Plus,
  Minus,
  Check,
  X,
  ArrowLeft,
  ArrowRight,
  Save,
  FolderOpen,
  Info,
} from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Player } from './player';
import { Waveform } from './waveform';
import { analyze, renderAudio, toWav } from '@/lib/audio/client';
import {
  type Analysis,
  type Settings,
  type Repair,
  type AudioData,
  formatTime,
  clamp,
} from '@/lib/audio/types';
import { buildPlan } from '@/lib/audio/timeline';
import { applyAutomatic, reviewGroups } from '@/lib/audio/arrange';
import { restoreProject } from '@/lib/project';
import {
  createDemo,
  loadMedia,
  exportVideo,
  supportedFormats,
  type MediaAsset,
} from '@/lib/media';

type Edits = { analysis: Analysis; settings: Settings; repairs: Repair[] };
type ExportResult = { url: string; name: string; size: number; video: boolean };
function projectText(
  asset: MediaAsset,
  edits: Edits,
  title: string,
  fps: number,
  punch: boolean,
  sha256?: string,
) {
  return JSON.stringify(
    {
      format: 'legato-project',
      version: 3,
      title,
      fps,
      source: {
        name: asset.name,
        size: asset.file?.size || 0,
        duration: asset.duration,
        sha256,
      },
      settings: edits.settings,
      repairs: edits.repairs,
      onsets: edits.analysis.onsets,
      pulse: edits.analysis.pulse,
      punch,
    },
    null,
    2,
  );
}
function message(e: unknown) {
  return e instanceof Error ? e.message : '操作未完成，请重试。';
}
function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export default function Editor() {
  const fileInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    job = useRef<AbortController | null>(null),
    cache = useRef<{ key: string; data: AudioData } | null>(null),
    version = useRef(0);
  const [asset, setAsset] = useState<MediaAsset | null>(null),
    [edits, setEdits] = useState<Edits | null>(null),
    [history, setHistory] = useState<Edits[]>([]),
    [future, setFuture] = useState<Edits[]>([]),
    [busy, setBusy] = useState(''),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [over, setOver] = useState(false),
    [mode, setMode] = useState<'original' | 'edited'>('original'),
    [position, setPosition] = useState(0),
    [seek, setSeek] = useState<{
      time: number;
      id: number;
      play?: boolean;
      end?: number;
    }>({ time: 0, id: 0 }),
    [selection, setSelection] = useState<[number, number] | null>(null),
    [selectedNote, setSelectedNote] = useState<string | null>(null),
    [zoom, setZoom] = useState(1),
    [exportOpen, setExportOpen] = useState(false),
    [format, setFormat] = useState<'mp4' | 'webm' | 'wav'>('mp4'),
    [formats, setFormats] = useState({ mp4: false, webm: false }),
    [formatsReady, setFormatsReady] = useState(false),
    [resolution, setResolution] = useState('720'),
    [punch, setPunch] = useState(true),
    [fps, setFps] = useState(30),
    [projectTitle, setProjectTitle] = useState(''),
    [sourceHash, setSourceHash] = useState<string | undefined>(),
    [result, setResult] = useState<ExportResult | null>(null),
    [helpOpen, setHelpOpen] = useState(false),
    [sensitivity, setSensitivity] = useState(1);
  const [saveStatus, setSaveStatus] = useState('');
  const reviews = useMemo(
    () => (edits ? reviewGroups(edits.analysis, edits.settings) : []),
    [edits],
  );
  const currentReview = reviews[0];
  const plan = useMemo(
    () =>
      edits ? buildPlan(edits.analysis, edits.settings, edits.repairs) : null,
    [edits],
  );
  const editKey = useMemo(
    () =>
      JSON.stringify([
        asset?.name,
        asset?.duration,
        edits?.settings,
        edits?.repairs,
        edits?.analysis.onsets.map((o) => [
          o.time,
          o.enabled,
          o.offset,
          o.beats,
          o.autoBeats,
        ]),
      ]),
    [asset, edits],
  );
  useEffect(() => {
    supportedFormats()
      .then((f) => {
        setFormats(f);
        setFormat(f.mp4 ? 'mp4' : f.webm ? 'webm' : 'wav');
      })
      .catch(() => setFormat('wav'))
      .finally(() => setFormatsReady(true));
    return () => job.current?.abort();
  }, []);
  useEffect(
    () => () => {
      if (asset?.url) URL.revokeObjectURL(asset.url);
    },
    [asset],
  );
  useEffect(
    () => () => {
      if (result) URL.revokeObjectURL(result.url);
    },
    [result],
  );
  useEffect(() => {
    cache.current = null;
    setResult(null);
  }, [editKey, punch, resolution, format, fps]);
  useEffect(() => {
    if (!asset?.file || !edits || !sourceHash || busy) return;
    const timer = setTimeout(() => {
      try {
        const key = `legato:project:v3:${sourceHash}`;
        localStorage.setItem(
          key,
          projectText(asset, edits, projectTitle, fps, punch, sourceHash),
        );
        const index = JSON.parse(
          localStorage.getItem('legato:recent:v3') || '[]',
        ) as string[];
        const recent = [
          key,
          ...index.filter((k) => typeof k === 'string' && k !== key),
        ];
        for (const old of recent.slice(5))
          if (old.startsWith('legato:project:v3:'))
            localStorage.removeItem(old);
        localStorage.setItem(
          'legato:recent:v3',
          JSON.stringify(recent.slice(0, 5)),
        );
        setSaveStatus('剪辑已保存在此浏览器，重新选择同一原片即可恢复。');
      } catch {
        setSaveStatus('此浏览器无法自动保存，请使用「保存剪辑」备份。');
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [asset, edits, sourceHash, projectTitle, fps, punch, busy]);
  const onPosition = useCallback((t: number) => setPosition(t), []);
  const seekTo = useCallback((time: number) => {
    setSeek((s) => ({ time, id: s.id + 1 }));
    setPosition(time);
  }, []);
  function audition(start: number, end: number, original = false) {
    setMode(original ? 'original' : 'edited');
    setSeek((s) => ({ id: s.id + 1, time: start, end, play: true }));
    setPosition(start);
  }
  function confirmReview(choice: 'current' | 'flow' | 'keep') {
    if (!currentReview) return;
    const ids = new Set(currentReview.ids);
    change((e) => ({
      ...e,
      analysis: {
        ...e.analysis,
        onsets: e.analysis.onsets.map((n, i, notes) =>
          !ids.has(n.id)
            ? n
            : {
                ...n,
                reviewed: true,
                beats:
                  choice === 'flow'
                    ? (n.flowBeats ?? n.autoBeats)
                    : choice === 'keep' && i
                      ? clamp(
                          (n.time - notes[i - 1].time) / (30 / e.settings.bpm),
                          0.1,
                          16,
                        )
                      : n.beats,
              },
        ),
      },
      repairs:
        choice === 'keep'
          ? e.repairs.map((r) =>
              r.start < currentReview.end && r.end > currentReview.start
                ? { ...r, enabled: false }
                : r,
            )
          : e.repairs,
    }));
    setNotice('已记下你的选择，可撤销。');
  }
  const change = useCallback(
    (update: (current: Edits) => Edits) => {
      if (!edits || busy) return;
      setHistory((h) => [...h.slice(-39), edits]);
      setFuture([]);
      setEdits(update(edits));
      setMode('edited');
      setNotice('');
    },
    [edits, busy],
  );
  function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    change((e) => ({ ...e, settings: { ...e.settings, [key]: value } }));
  }
  function cancel() {
    job.current?.abort();
    version.current++;
    setBusy('');
    setProgress(0);
    setNotice('已取消，原视频保持不变。');
  }
  async function importAsset(file?: File, demo = false) {
    if (!file && !demo) return;
    job.current?.abort();
    const controller = new AbortController();
    job.current = controller;
    const id = ++version.current;
    setBusy('读取视频');
    setProgress(0);
    setError('');
    setNotice('');
    try {
      let readProgress = -1;
      const next = demo
        ? createDemo()
        : await loadMedia(file!, controller.signal, (n) => {
            const value = Math.floor(n * 20);
            if (value !== readProgress) {
              readProgress = value;
              setProgress(value);
            }
          });
      if (id !== version.current) {
        if (next.url) URL.revokeObjectURL(next.url);
        return;
      }
      setAsset(next);
      setProjectTitle('');
      setSourceHash(undefined);
      setSaveStatus('');
      setFps(30);
      setEdits(null);
      setHistory([]);
      setFuture([]);
      setSelection(null);
      setSelectedNote(null);
      setMode('original');
      setPosition(0);
      setSeek((s) => ({ time: 0, id: s.id + 1 }));
      setZoom(1);
      setResult(null);
      cache.current = null;
      setBusy('分析声音与发音间隔');
      const analysis = await analyze(next.audio, {
        signal: controller.signal,
        sensitivity,
        onProgress: (n) => setProgress(20 + n * 80),
      });
      if (id !== version.current) return;
      let arranged = applyAutomatic(analysis);
      let recovered = false;
      let recoveryFailed = false;
      if (next.file) {
        const hash = await crypto.subtle.digest(
          'SHA-256',
          await next.file.arrayBuffer(),
        );
        if (id !== version.current) return;
        const sha = Array.from(new Uint8Array(hash), (b) =>
          b.toString(16).padStart(2, '0'),
        ).join('');
        setSourceHash(sha);
        try {
          const saved = localStorage.getItem(`legato:project:v3:${sha}`);
          if (saved) {
            const restored = await restoreProject(saved, next, analysis);
            if (id !== version.current) return;
            arranged = {
              analysis: restored.analysis,
              settings: restored.settings,
              repairs: restored.repairs,
            };
            setProjectTitle(restored.title);
            setFps(restored.fps);
            setPunch(restored.punch);
            recovered = true;
          }
        } catch {
          recoveryFailed = true;
        }
      }
      setEdits(arranged);
      setMode('edited');
      seekTo(arranged.settings.start);
      const reviewCount = reviewGroups(
        arranged.analysis,
        arranged.settings,
      ).length;
      setNotice(
        recovered
          ? '已恢复这段视频上次的剪辑与试听确认。'
          : recoveryFailed
            ? '旧记录未能恢复，已重新生成自动初稿；如有下载的剪辑记录，可使用「载入剪辑」。'
            : arranged.settings.timing === 'automatic'
              ? `自动初稿已生成，无需先调参数。直接播放，${reviewCount ? `再试听下方 ${reviewCount} 段拿不准的位置。` : '也可随时与原片对比。'}`
              : '没有找到足够稳定的节奏依据，已保守整理。建议先试听，再手动调整。',
      );
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(message(e));
    } finally {
      if (id === version.current) {
        setBusy('');
        setProgress(0);
      }
    }
  }
  async function reanalyze() {
    if (!asset || busy) return;
    const controller = new AbortController();
    job.current = controller;
    const id = ++version.current;
    setBusy('重新检测发音点');
    setError('');
    try {
      const a = await analyze(asset.audio, {
        signal: controller.signal,
        sensitivity,
        onProgress: (n) => setProgress(n * 100),
      });
      if (id !== version.current) return;
      if (edits) setHistory((h) => [...h.slice(-39), edits]);
      setFuture([]);
      const arranged = applyAutomatic(a);
      setEdits({
        ...arranged,
        repairs: [
          ...(edits?.repairs.filter((r) => r.kind === 'manual') || []),
          ...arranged.repairs,
        ],
      });
      setMode('edited');
      seekTo(arranged.settings.start);
      setSelectedNote(null);
      setProjectTitle('');
      setNotice(
        '已重新自动分析；手动剪切保留，确认过的拍位已清除，可撤销恢复。',
      );
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(message(e));
    } finally {
      if (id === version.current) {
        setBusy('');
        setProgress(0);
      }
    }
  }
  const prepare = useCallback(async (): Promise<AudioData | null> => {
    if (!asset || !edits || !plan || !plan.spans.length) return null;
    if (cache.current?.key === editKey) return cache.current.data;
    if (busy) return null;
    const controller = new AbortController();
    job.current = controller;
    const id = ++version.current;
    setBusy('准备修剪后的声音');
    setProgress(0);
    setError('');
    try {
      const data = await renderAudio(
        asset.audio,
        plan,
        edits.settings.smooth,
        controller.signal,
        (n) => setProgress(n * 100),
      );
      if (id !== version.current) return null;
      cache.current = { key: editKey, data };
      return data;
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(message(e));
      return null;
    } finally {
      if (id === version.current) {
        setBusy('');
        setProgress(0);
      }
    }
  }, [asset, edits, plan, editKey, busy]);
  async function doExport() {
    if (!asset || !edits || !plan || busy) return;
    const controller = new AbortController();
    job.current = controller;
    const id = ++version.current;
    setBusy('整理音频');
    setProgress(0);
    setError('');
    setResult(null);
    try {
      let data = cache.current?.key === editKey ? cache.current.data : null;
      if (!data) {
        data = await renderAudio(
          asset.audio,
          plan,
          edits.settings.smooth,
          controller.signal,
          (n) => setProgress(n * 30),
        );
        cache.current = { key: editKey, data };
      }
      if (id !== version.current) return;
      let blob: Blob;
      if (format === 'wav') {
        blob = toWav(data);
      } else {
        setBusy('在本机导出视频');
        blob = await exportVideo(
          asset,
          data,
          plan,
          { format, maxHeight: Number(resolution), fps, punch },
          controller.signal,
          (n) => setProgress(30 + n * 70),
        );
      }
      if (id !== version.current) return;
      const name = asset.name.replace(/\.[^.]+$/, '') + '-顺奏版.' + format;
      setResult({
        url: URL.createObjectURL(blob),
        name,
        size: blob.size,
        video: format !== 'wav',
      });
      setNotice('导出完成，可以预览并下载。');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(message(e));
    } finally {
      if (id === version.current) {
        setBusy('');
        setProgress(0);
      }
    }
  }
  function addCut() {
    if (!selection || selection[1] - selection[0] < 0.04 || !edits) return;
    const [start, end] = selection;
    change((e) => ({
      ...e,
      repairs: [
        ...e.repairs,
        {
          id: `manual-${Date.now()}`,
          start,
          end,
          enabled: true,
          kind: 'manual',
          label: '手动修剪',
        },
      ],
    }));
    setSelection(null);
  }
  function updateNote(offset: number) {
    if (!selectedNote) return;
    change((e) => ({
      ...e,
      analysis: {
        ...e.analysis,
        onsets: e.analysis.onsets.map((o) =>
          o.id === selectedNote
            ? { ...o, offset: clamp(o.offset + offset, -0.15, 0.15) }
            : o,
        ),
      },
    }));
  }
  function undo() {
    if (!history.length || !edits || busy) return;
    setFuture((f) => [edits, ...f]);
    setEdits(history.at(-1)!);
    setMode('edited');
    setHistory((h) => h.slice(0, -1));
  }
  function redo() {
    if (!future.length || !edits || busy) return;
    setHistory((h) => [...h, edits]);
    setEdits(future[0]);
    setMode('edited');
    setFuture((f) => f.slice(1));
  }
  function reset() {
    change((e) => ({
      ...e,
      analysis: {
        ...e.analysis,
        onsets: e.analysis.onsets.map((o) => ({
          ...o,
          enabled: true,
          offset: 0,
          beats: undefined,
        })),
      },
      settings: {
        bpm: Math.round((30 / e.analysis.pulse) * 10) / 10,
        strength: 55,
        keepLongNotes: true,
        start: 0,
        end: e.analysis.duration,
        smooth: true,
      },
      repairs: e.analysis.repairs.map((r) => ({ ...r, enabled: false })),
    }));
    setSelection(null);
    setSelectedNote(null);
    setMode('original');
    setProjectTitle('');
  }
  function saveProject() {
    if (!asset || !edits) return;
    downloadBlob(
      new Blob(
        [projectText(asset, edits, projectTitle, fps, punch, sourceHash)],
        { type: 'application/json' },
      ),
      asset.name.replace(/\.[^.]+$/, '') + '.legato.json',
    );
  }
  async function loadProject(file?: File) {
    if (!file || !asset || !edits || busy) return;
    const id = ++version.current;
    setBusy('校验原片并恢复剪辑');
    setError('');
    try {
      if (file.size > 2000000) throw new Error('剪辑记录过大。');
      const restored = await restoreProject(
        await file.text(),
        asset,
        edits.analysis,
      );
      if (id !== version.current) return;
      setHistory((h) => [...h.slice(-39), edits]);
      setFuture([]);
      setEdits({
        analysis: restored.analysis,
        settings: restored.settings,
        repairs: restored.repairs,
      });
      setPunch(restored.punch);
      setFps(restored.fps);
      setProjectTitle(restored.title);
      setSourceHash(restored.sha256);
      setSelectedNote(null);
      setSelection(null);
      setMode('edited');
      seekTo(restored.settings.start);
      const confirmed = restored.analysis.onsets.filter(
        (o) => o.enabled && o.beats !== undefined,
      ).length;
      setNotice(
        `已恢复${restored.title ? '「' + restored.title + '」' : '剪辑记录'}，${confirmed} 个确认拍位。点击播放试听。`,
      );
    } catch (e) {
      if (id === version.current) setError(message(e));
    } finally {
      if (id === version.current) setBusy('');
    }
  }
  function addOnset() {
    if (!edits || busy) return;
    if (edits.analysis.onsets.some((o) => Math.abs(o.time - position) < 0.06)) {
      setNotice('光标附近已有发音点，请直接选择蓝点微调。');
      return;
    }
    const id = `added-${Date.now()}`;
    change((e) => ({
      ...e,
      analysis: {
        ...e.analysis,
        onsets: [
          ...e.analysis.onsets,
          {
            id,
            time: clamp(position, 0, e.analysis.duration),
            strength: 0.5,
            enabled: true,
            offset: 0,
          },
        ].sort((a, b) => a.time - b.time),
      },
    }));
    setSelectedNote(id);
    setNotice('已在光标位置补充发音点。请确认与前一音之间应相隔几拍。');
  }
  const chosenNote = edits?.analysis.onsets.find((o) => o.id === selectedNote);
  const saved = asset && plan ? asset.duration - plan.duration : 0;
  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <a
            className="toolbox-link"
            href="/"
            aria-label="返回 boomyao 工具箱"
            title="返回工具箱"
          >
            <ArrowLeft size={17} />
            <span>工具箱</span>
          </a>
          <div className="brand-mark">
            <AudioLines size={23} />
          </div>
          <div className="brand-name">
            顺奏<span>LEGATO</span>
          </div>
        </div>
        <div className="local-badge">
          <ShieldCheck size={15} />
          全部处理在本机完成
        </div>
        <div className="top-actions">
          <button
            className="btn subtle"
            onClick={() => setHelpOpen(true)}
            aria-label="使用说明"
          >
            <Info size={16} />
            <span className="hidden sm:inline">使用说明</span>
          </button>
          <button
            className="btn subtle"
            disabled={!!busy}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={16} />
            {asset ? '更换视频' : '导入视频'}
          </button>
          <button
            className="btn primary"
            onClick={() => setExportOpen(true)}
            disabled={!edits || !plan?.spans.length || !!busy}
          >
            <Download size={16} />
            导出
            <ArrowUpRight size={15} />
          </button>
        </div>
      </header>
      <input
        ref={fileInput}
        type="file"
        accept="video/*,.mkv,.mov"
        onChange={(e) => {
          void importAsset(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={projectInput}
        type="file"
        accept=".json"
        onChange={(e) => {
          void loadProject(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <div className="workspace">
        <div className="workspace-title">
          <h1>演奏修剪台</h1>
          <span className="file-tag" title={asset?.name}>
            <Film size={15} />
            {asset
              ? `${asset.name} · ${formatTime(asset.duration)}`
              : '等待导入演奏视频'}
          </span>
        </div>
        {error && (
          <div className="status-box error" role="alert">
            <Info size={18} />
            <span>{error}</span>
            <button
              className="icon-btn"
              onClick={() => setError('')}
              aria-label="关闭提示"
            >
              <X size={16} />
            </button>
          </div>
        )}
        {busy && (
          <output className="status-box">
            <LoaderCircle size={18} className="spin" />
            <div className="flex-1">
              <div className="flex justify-between mb-2">
                <span>{busy}</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} aria-label={busy} />
            </div>
            <button className="btn small subtle" onClick={cancel}>
              取消
            </button>
          </output>
        )}
        {!busy && notice && !error && (
          <output className="status-box">
            <Check size={17} />
            <span>{notice}</span>
            <button
              className="icon-btn"
              onClick={() => setNotice('')}
              aria-label="关闭提示"
            >
              <X size={16} />
            </button>
          </output>
        )}
        <div className="editor-grid">
          {asset ? (
            <Player
              asset={asset}
              plan={plan}
              mode={mode}
              onMode={setMode}
              prepare={prepare}
              onPosition={onPosition}
              seek={seek}
              busy={!!busy}
              punch={punch}
              appliedCuts={edits?.repairs.filter((r) => r.enabled).length ?? 0}
              confirmedNotes={
                edits?.analysis.onsets.filter(
                  (o) => o.enabled && o.beats !== undefined,
                ).length ?? 0
              }
              automatic={edits?.settings.timing === 'automatic'}
              reviewCount={reviews.length}
            />
          ) : (
            <section className="viewer">
              <div className="viewer-head">
                <span className="viewer-label">
                  <Film size={15} />
                  演奏画面
                </span>
                <span className="eyebrow">ORIGINAL</span>
              </div>
              <div className="video-stage">
                <div
                  className={`dropzone ${over ? 'over' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOver(true);
                  }}
                  onDragLeave={() => setOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setOver(false);
                    if (!busy) void importAsset(e.dataTransfer.files[0]);
                  }}
                >
                  <div className="import-icon">
                    <Music2 size={29} />
                  </div>
                  <h2>让这一次演奏，更连贯</h2>
                  <p>拖入视频，从停顿与节奏开始整理。</p>
                  <button
                    className="btn primary"
                    onClick={() => fileInput.current?.click()}
                    disabled={!!busy}
                  >
                    <Upload size={16} />
                    选择演奏视频
                  </button>
                  <button
                    className="btn subtle small mt-3"
                    disabled={!!busy}
                    onClick={() => void importAsset(undefined, true)}
                  >
                    先试试节奏示例 <ArrowRight size={14} />
                  </button>
                  <p className="help">
                    MP4 / MOV / WebM · 5 分钟以内 · 文件不会上传
                  </p>
                </div>
              </div>
              <div className="transport">
                <div className="transport-left">
                  <button
                    className="play-btn"
                    disabled
                    aria-label="等待导入后播放"
                  >
                    <Play size={17} />
                  </button>
                  <span className="timecode">
                    00:00.0 <span>/ —</span>
                  </span>
                </div>
                <span className="hint">保留你的演奏原声</span>
              </div>
            </section>
          )}
          <aside className="inspector">
            <div className="inspector-head">
              <h2>节奏整理</h2>
              <span className="pill">
                <SlidersHorizontal size={13} />
                {edits?.settings.timing === 'automatic'
                  ? '自动整理'
                  : edits?.analysis.onsets.some((o) => o.beats !== undefined)
                    ? '已确认拍位'
                    : '自动初步整理'}
              </span>
            </div>
            {projectTitle && (
              <p className="px-5 pt-3 text-sm text-[#d6f77a]">
                精修工程 · {projectTitle}
              </p>
            )}
            {edits?.settings.timing === 'automatic' &&
              edits.analysis.automatic && (
                <div className="px-5 pt-4 text-sm text-[#a8b5c5]">
                  <p>已参考片中较稳定的节奏，参数通常无需修改。</p>
                  <button
                    className="btn small subtle mt-2"
                    disabled={!!busy}
                    onClick={() =>
                      audition(
                        edits.analysis.automatic!.stableStart,
                        edits.analysis.automatic!.stableEnd,
                        true,
                      )
                    }
                  >
                    <Play size={14} />
                    听节奏依据{' '}
                    {formatTime(edits.analysis.automatic.stableStart)} —{' '}
                    {formatTime(edits.analysis.automatic.stableEnd)}
                  </button>
                </div>
              )}
            <fieldset
              disabled={!edits || !!busy}
              className="inspector-content border-0 m-0 min-w-0"
            >
              <div>
                <div className="control-head">
                  <label htmlFor="tempo">目标速度</label>
                  <span className="flex items-center gap-2">
                    <input
                      id="tempo"
                      aria-label="目标 BPM"
                      type="number"
                      min={30}
                      max={180}
                      step={0.1}
                      value={edits?.settings.bpm || 67}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (v >= 30 && v <= 180) updateSetting('bpm', v);
                      }}
                    />
                    <span className="text-xs text-[#8f99a7]">BPM</span>
                  </span>
                </div>
                <Slider
                  min={35}
                  max={140}
                  step={0.5}
                  value={[edits?.settings.bpm || 67]}
                  onValueChange={(v) =>
                    updateSetting('bpm', Array.isArray(v) ? v[0] : v)
                  }
                  aria-label="目标速度"
                />
                <p className="hint">
                  {edits
                    ? `建议 ${(30 / edits.analysis.pulse).toFixed(1)} BPM · ${edits.analysis.confidence > 0.65 ? '脉冲较清楚' : '建议结合试听调整'}`
                    : '导入后，根据连续发音间隔建议基础速度。'}
                </p>
              </div>
              <div className="divider" />
              <div>
                <div className="control-head">
                  <span>调整力度</span>
                  <strong>{edits?.settings.strength ?? 55}%</strong>
                </div>
                <Slider
                  min={0}
                  max={100}
                  step={5}
                  value={[edits?.settings.strength ?? 55]}
                  onValueChange={(v) =>
                    updateSetting('strength', Array.isArray(v) ? v[0] : v)
                  }
                  aria-label="节奏调整力度"
                />
                <p className="hint">
                  仅影响自动估计的间隔；手动确认的拍位按指定节奏执行。
                </p>
              </div>
              {edits?.settings.timing !== 'automatic' && (
                <div>
                  <div className="control-head mb-0">
                    <label htmlFor="keep-notes">保留长音与乐句呼吸</label>
                    <Switch
                      id="keep-notes"
                      checked={edits?.settings.keepLongNotes ?? true}
                      onCheckedChange={(v) => updateSetting('keepLongNotes', v)}
                      size="sm"
                    />
                  </div>
                  <p className="hint">长间隔交给下方的停顿检查，避免误剪。</p>
                </div>
              )}
              <div className="divider" />
              <div className="stats">
                <div className="stat">
                  <strong>
                    {edits?.analysis.onsets.filter((o) => o.enabled).length ??
                      '—'}
                  </strong>
                  <span>发音点</span>
                </div>
                <div className="stat">
                  <strong>
                    {edits
                      ? reviews.length +
                        edits.repairs.filter((r) => !r.enabled).length
                      : '—'}
                  </strong>
                  <span>待检查</span>
                </div>
                <div className="stat">
                  <strong>
                    {edits
                      ? `${saved >= 0 ? '−' : '+'}${Math.abs(saved).toFixed(1)}s`
                      : '—'}
                  </strong>
                  <span>时长变化</span>
                </div>
              </div>
            </fieldset>
            <div className="inspector-foot">
              <button
                className="btn full small mb-3"
                disabled={!edits || !!busy}
                onClick={() => projectInput.current?.click()}
              >
                <FolderOpen size={15} />
                载入精修工程
              </button>
              <button
                className="btn full small mb-3"
                disabled={!edits || !!busy}
                onClick={() => {
                  change((e) => applyAutomatic(e.analysis));
                  setProjectTitle('');
                  setNotice('已重新生成自动初稿，可撤销恢复之前的剪辑。');
                }}
              >
                <WandSparkles size={15} />
                重新自动整理
              </button>
              <button
                className="btn primary"
                disabled={!edits || !!busy || !plan?.spans.length}
                onClick={() =>
                  audition(edits?.settings.start ?? 0, edits?.settings.end ?? 0)
                }
              >
                <Play size={17} />
                播放整理结果
              </button>
            </div>
          </aside>
        </div>
        {edits?.settings.timing === 'automatic' && (
          <section
            className="my-5 rounded-xl border border-[#354334] bg-[#171d19] p-5"
            aria-label="疑难片段确认"
          >
            <div className="flex flex-wrap justify-between gap-3 items-center mb-3">
              <h2 className="font-semibold text-base">
                {currentReview
                  ? `再听 ${reviews.length} 个片段`
                  : '试听确认已完成'}
              </h2>
              <span className="text-sm text-[#a8b5ac]">
                {currentReview
                  ? '自动初稿已可播放和导出'
                  : '仍可在时间线上微调，或直接导出'}
              </span>
            </div>
            {currentReview ? (
              <>
                <p className="text-sm text-[#bdc7bd] mb-3">
                  {formatTime(currentReview.start)} —{' '}
                  {formatTime(currentReview.end)} · {currentReview.reason}
                  。长音、短音连接和试探发音需要结合试听判断。
                </p>
                <div className="flex flex-wrap gap-2 mb-4">
                  <button
                    className="btn small"
                    disabled={!!busy}
                    onClick={() =>
                      audition(currentReview.start, currentReview.end, true)
                    }
                  >
                    <Play size={14} />
                    听原片这一段
                  </button>
                  <button
                    className="btn small"
                    disabled={!!busy}
                    onClick={() =>
                      audition(currentReview.start, currentReview.end)
                    }
                  >
                    <Play size={14} />
                    听整理后这一段
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn primary small"
                    disabled={!!busy}
                    onClick={() => confirmReview('current')}
                  >
                    <Check size={14} />
                    这样就好，下一段
                  </button>
                  <button
                    className="btn small"
                    disabled={!!busy}
                    onClick={() => confirmReview('flow')}
                  >
                    这些间隔再紧凑些
                  </button>
                  <button
                    className="btn small"
                    disabled={!!busy}
                    onClick={() => confirmReview('keep')}
                  >
                    保留原来的停留
                  </button>
                </div>
                <p className="text-sm text-[#94a096] mt-3">
                  选择后会保存，可随时撤销。其余片段已按自动方案整理。
                </p>
              </>
            ) : (
              <p className="text-sm text-[#bdc7bd]">
                当前方案保留原声与完整时间顺序。导出前可再完整播放一次。
              </p>
            )}
          </section>
        )}
        <section className="timeline">
          <div className="timeline-head">
            <div className="timeline-title">
              <AudioLines size={17} />
              声音时间线
              <span className="text-xs text-[#778394] font-normal ml-1">
                原片时间
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="legend hidden sm:flex">
                <span>
                  <i className="dot" />
                  发音点
                </span>
                <span>
                  <i className="dot yellow" />
                  待检查
                </span>
              </div>
              <div className="zoom-buttons">
                <button
                  className="icon-btn"
                  aria-label="缩小时间线"
                  disabled={zoom <= 1}
                  onClick={() => setZoom((z) => Math.max(1, z / 2))}
                >
                  <Minus size={15} />
                </button>
                <span>{zoom}×</span>
                <button
                  className="icon-btn"
                  aria-label="放大时间线"
                  disabled={!edits || zoom >= 8}
                  onClick={() => setZoom((z) => Math.min(8, z * 2))}
                >
                  <Plus size={15} />
                </button>
              </div>
            </div>
          </div>
          <div className="timeline-body">
            {edits ? (
              <Waveform
                analysis={edits.analysis}
                repairs={edits.repairs}
                position={position}
                zoom={zoom}
                selection={selection}
                selectedNote={selectedNote}
                onSeek={seekTo}
                onSelect={setSelection}
                onNote={setSelectedNote}
                start={edits.settings.start}
                end={edits.settings.end}
              />
            ) : (
              <div className="timeline-empty">
                导入后查看波形、发音点与剪辑位置
              </div>
            )}
            <div className="timeline-bottom">
              <div className="selection-fields">
                <span>选区</span>
                <input
                  aria-label="选区开始秒数"
                  type="number"
                  min={0}
                  max={asset?.duration || 0}
                  step={0.01}
                  value={selection?.[0].toFixed(2) || ''}
                  placeholder="开始"
                  disabled={!edits || !!busy}
                  onChange={(e) => {
                    const t = clamp(
                      Number(e.target.value),
                      0,
                      asset?.duration || 0,
                    );
                    setSelection([t, Math.max(t, selection?.[1] ?? t + 0.5)]);
                  }}
                />
                <span>—</span>
                <input
                  aria-label="选区结束秒数"
                  type="number"
                  min={0}
                  max={asset?.duration || 0}
                  step={0.01}
                  value={selection?.[1].toFixed(2) || ''}
                  placeholder="结束"
                  disabled={!edits || !!busy}
                  onChange={(e) => {
                    const t = clamp(
                      Number(e.target.value),
                      0,
                      asset?.duration || 0,
                    );
                    setSelection([
                      Math.min(t, selection?.[0] ?? Math.max(0, t - 0.5)),
                      t,
                    ]);
                  }}
                />
                <button
                  className="btn small"
                  disabled={
                    !selection || selection[1] - selection[0] < 0.04 || !!busy
                  }
                  onClick={addCut}
                >
                  <Scissors size={14} />
                  删除选区
                </button>
                <button
                  className="btn small"
                  disabled={!edits || !!busy}
                  onClick={addOnset}
                >
                  <Plus size={14} />
                  补充发音点
                </button>
                {selection && (
                  <button
                    className="icon-btn"
                    aria-label="清除选区"
                    onClick={() => setSelection(null)}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <div className="flex gap-1">
                <button
                  className="icon-btn"
                  title="撤销"
                  aria-label="撤销"
                  disabled={!history.length || !!busy}
                  onClick={undo}
                >
                  <Undo2 size={16} />
                </button>
                <button
                  className="icon-btn"
                  title="重做"
                  aria-label="重做"
                  disabled={!future.length || !!busy}
                  onClick={redo}
                >
                  <Redo2 size={16} />
                </button>
                <button
                  className="icon-btn"
                  title="重置剪辑"
                  aria-label="重置剪辑"
                  disabled={!edits || !!busy}
                  onClick={reset}
                >
                  <RotateCcw size={15} />
                </button>
              </div>
            </div>
            {chosenNote && (
              <div className="selected-onset">
                <span>发音点 {formatTime(chosenNote.time, true)}</span>
                <span className="toolbar-separator" />
                <button
                  className="btn small"
                  onClick={() => updateNote(-0.02)}
                  disabled={!!busy}
                >
                  <ArrowLeft size={13} />
                  提前 20ms
                </button>
                <button
                  className="btn small"
                  onClick={() => updateNote(0.02)}
                  disabled={!!busy}
                >
                  延后 20ms
                  <ArrowRight size={13} />
                </button>
                <span>
                  {chosenNote.offset >= 0 ? '+' : ''}
                  {Math.round(chosenNote.offset * 1000)}ms
                </span>
                <Checkbox
                  checked={chosenNote.enabled}
                  aria-label="使用此发音点校正节奏"
                  disabled={!!busy}
                  onCheckedChange={(enabled) =>
                    change((e) => ({
                      ...e,
                      analysis: {
                        ...e.analysis,
                        onsets: e.analysis.onsets.map((o) =>
                          o.id === selectedNote ? { ...o, enabled } : o,
                        ),
                      },
                    }))
                  }
                />
                <span>用于校正</span>
                <label className="flex items-center gap-2 text-sm">
                  与前音相隔（拍）
                  <input
                    className="w-24 rounded border border-[#354052] bg-[#111820] px-2 py-1"
                    aria-label="与前音相隔拍数"
                    type="number"
                    min={0.05}
                    max={8}
                    step={0.125}
                    placeholder="自动估计"
                    disabled={!!busy}
                    value={
                      chosenNote.beats === undefined
                        ? ''
                        : Number((chosenNote.beats / 2).toFixed(5))
                    }
                    onChange={(event) => {
                      const beats =
                        event.target.value === ''
                          ? undefined
                          : Number(event.target.value) * 2;
                      if (beats !== undefined && (beats < 0.1 || beats > 16))
                        return;
                      change((e) => ({
                        ...e,
                        analysis: {
                          ...e.analysis,
                          onsets: e.analysis.onsets.map((o) =>
                            o.id === selectedNote ? { ...o, beats } : o,
                          ),
                        },
                      }));
                    }}
                  />
                </label>
                <button
                  className="icon-btn"
                  onClick={() => setSelectedNote(null)}
                  aria-label="关闭发音点调整"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
        </section>
        <div className="lower-grid">
          <section className="repairs-panel">
            <div className="section-heading">
              <h2>
                停顿检查{' '}
                <span className="text-[#7c8898] ml-1">
                  {edits?.repairs.length || 0}
                </span>
              </h2>
              <span className="text-xs text-[#8290a1]">勾选后才会删除</span>
            </div>
            {edits?.repairs.length ? (
              <div className="repair-list">
                {edits.repairs.map((r) => (
                  <div
                    className={`repair ${r.enabled ? 'selected' : ''}`}
                    key={r.id}
                  >
                    <Checkbox
                      aria-label={`应用剪切：${formatTime(r.start)} 至 ${formatTime(r.end)}`}
                      checked={r.enabled}
                      disabled={!!busy}
                      onCheckedChange={(enabled) =>
                        change((e) => ({
                          ...e,
                          repairs: e.repairs.map((x) =>
                            x.id === r.id ? { ...x, enabled } : x,
                          ),
                        }))
                      }
                    />
                    <div className="repair-text">
                      {edits.analysis.onsets.some(
                        (o) => o.enabled && o.time > r.start && o.time < r.end,
                      ) && (
                        <small className="text-amber-300">
                          区间内包含发音点，请先试听
                        </small>
                      )}
                      {formatTime(r.start, true)} — {formatTime(r.end, true)}
                      <small>
                        {r.label} · {r.enabled ? '将删除' : '建议试听'}{' '}
                        {(r.end - r.start).toFixed(2)} 秒
                      </small>
                    </div>
                    <div className="flex gap-1">
                      <button
                        className="icon-btn"
                        title="跳到这段前面试听"
                        aria-label="定位到这段停顿"
                        disabled={!!busy}
                        onClick={() => {
                          setMode('original');
                          seekTo(Math.max(0, r.start - 0.65));
                          setSelection([r.start, r.end]);
                        }}
                      >
                        <Play size={14} />
                      </button>
                      {r.kind === 'manual' && (
                        <button
                          className="icon-btn"
                          aria-label="移除这项剪辑"
                          disabled={!!busy}
                          onClick={() =>
                            change((e) => ({
                              ...e,
                              repairs: e.repairs.filter((x) => x.id !== r.id),
                            }))
                          }
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-note">
                {edits
                  ? '没有明显的长间隔。你仍可在时间线上拖出选区，手动修剪。'
                  : '长音和停顿不总是一回事。导入后，先试听可疑位置，再决定是否修剪。'}
              </div>
            )}
          </section>
          <section className="notes-panel">
            <div className="section-heading">
              <h2>首尾与细节</h2>
              <button
                className="btn small subtle"
                disabled={!edits || !!busy}
                onClick={() =>
                  change((e) => ({
                    ...e,
                    settings: {
                      ...e.settings,
                      start: e.analysis.suggestedStart,
                      end: e.analysis.suggestedEnd,
                    },
                  }))
                }
              >
                贴近演奏首尾
              </button>
            </div>
            <fieldset disabled={!edits || !!busy} className="border-0 p-0 m-0">
              <div className="clip-range">
                <label>
                  开始（秒）
                  <input
                    type="number"
                    step={0.05}
                    min={0}
                    max={edits ? edits.settings.end - 0.15 : 0}
                    value={edits?.settings.start.toFixed(2) || '0.00'}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (edits && n >= 0 && n < edits.settings.end - 0.15)
                        updateSetting('start', n);
                    }}
                  />
                </label>
                <label>
                  结束（秒）
                  <input
                    type="number"
                    step={0.05}
                    max={asset?.duration || 0}
                    min={edits ? edits.settings.start + 0.15 : 0}
                    value={edits?.settings.end.toFixed(2) || '0.00'}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (
                        edits &&
                        asset &&
                        n > edits.settings.start + 0.15 &&
                        n <= asset.duration
                      )
                        updateSetting('end', n);
                    }}
                  />
                </label>
              </div>
              <div className="control-head mt-4">
                <label htmlFor="smooth">轻微平衡音量</label>
                <Switch
                  id="smooth"
                  size="sm"
                  checked={edits?.settings.smooth ?? true}
                  onCheckedChange={(v) => updateSetting('smooth', v)}
                />
              </div>
              <div className="control-head">
                <label htmlFor="punch">剪切处轻微推近</label>
                <Switch
                  id="punch"
                  size="sm"
                  checked={punch}
                  onCheckedChange={setPunch}
                />
              </div>
            </fieldset>
            <p>
              调整节奏和停顿，保留原来的音高与演奏内容。错音与缺失乐句需要你另行判断。
            </p>
          </section>
        </div>
        {edits && (
          <section className="mt-5 flex flex-wrap justify-between gap-4 items-center">
            <div className="flex items-center gap-3 text-sm text-[#929eac]">
              <span>发音检测</span>
              <div className="w-32">
                <Slider
                  min={0.6}
                  max={1.8}
                  step={0.1}
                  value={[sensitivity]}
                  disabled={!!busy}
                  onValueChange={(v) =>
                    setSensitivity(Array.isArray(v) ? v[0] : v)
                  }
                  aria-label="发音检测灵敏度"
                />
              </div>
              <span className="text-xs">{sensitivity.toFixed(1)}×</span>
              <button
                className="btn small subtle"
                disabled={!!busy}
                onClick={() => void reanalyze()}
              >
                重新检测
              </button>
            </div>
            <div className="flex gap-2">
              <button
                className="btn small subtle"
                disabled={!!busy}
                onClick={saveProject}
              >
                <Save size={14} />
                保存剪辑
              </button>
              <button
                className="btn small subtle"
                disabled={!!busy}
                onClick={() => projectInput.current?.click()}
              >
                <FolderOpen size={14} />
                载入剪辑
              </button>
            </div>
          </section>
        )}
        {saveStatus && (
          <p className="mt-4 text-sm text-[#98a699]" aria-live="polite">
            {saveStatus}
          </p>
        )}
        <footer className="footer">
          <span>原片保留在本机 · 空格播放 / 暂停 · 拖动波形选择片段</span>
          <span>
            <a
              href="https://github.com/boomyao/boomyao.github.io/tree/main/apps/legato"
              target="_blank"
              rel="noreferrer"
            >
              应用源码
            </a>
            <span className="mx-2">·</span>
            <a
              href={`${import.meta.env.BASE_URL}licenses.txt`}
              target="_blank"
              rel="noreferrer"
            >
              开源许可
            </a>
          </span>
        </footer>
      </div>
      <Dialog
        open={exportOpen}
        onOpenChange={(v) => {
          if (!busy) setExportOpen(v);
        }}
      >
        <DialogContent className="export-dialog" showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>导出演奏视频</DialogTitle>
            <DialogDescription>
              全部在本机处理，原文件不会改变。
              {reviews.length > 0 &&
                ` 当前初稿还有 ${reviews.length} 段建议试听。`}
            </DialogDescription>
          </DialogHeader>
          <div className="export-settings">
            {result ? (
              <div className="export-result">
                {result.video ? (
                  <video controls src={result.url} playsInline />
                ) : (
                  <audio controls src={result.url} className="w-full mb-3" />
                )}
                <p className="text-sm mb-3 break-all">
                  {result.name}
                  <span className="text-[#8996a7] ml-2">
                    {(result.size / 1024 / 1024).toFixed(1)} MB
                  </span>
                </p>
                <a
                  className="btn primary full"
                  href={result.url}
                  download={result.name}
                >
                  <Download size={16} />
                  下载成片
                </a>
              </div>
            ) : (
              <>
                <fieldset
                  disabled={!!busy}
                  className="border-0 p-0 m-0 grid gap-4"
                >
                  <div className="control-head mb-0">
                    <label htmlFor="export-format">文件格式</label>
                    <Select
                      value={format}
                      onValueChange={(v) => {
                        if (v) setFormat(v as typeof format);
                      }}
                    >
                      <SelectTrigger id="export-format" className="min-w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mp4" disabled={!formats.mp4}>
                          MP4 · 广泛兼容
                        </SelectItem>
                        <SelectItem value="webm" disabled={!formats.webm}>
                          WebM · 浏览器视频
                        </SelectItem>
                        <SelectItem value="wav">WAV · 仅声音</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {format !== 'wav' && (
                    <div className="control-head mb-0">
                      <label htmlFor="export-resolution">画面清晰度</label>
                      <Select
                        value={resolution}
                        onValueChange={(v) => {
                          if (v) setResolution(v);
                        }}
                      >
                        <SelectTrigger
                          id="export-resolution"
                          className="min-w-48"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="720">720p · 更快导出</SelectItem>
                          <SelectItem value="1080">1080p · 更清晰</SelectItem>
                          <SelectItem value="2160">
                            保留原尺寸 · 最高 4K
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {format !== 'wav' && (
                    <div className="control-head mb-0">
                      <label htmlFor="export-fps">视频帧率</label>
                      <Select
                        value={String(fps)}
                        onValueChange={(v) => v && setFps(Number(v))}
                      >
                        <SelectTrigger id="export-fps" className="min-w-48">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[24, 30, 48, 60].map((v) => (
                            <SelectItem key={v} value={String(v)}>
                              {v} fps
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </fieldset>
                <div className="stats py-2">
                  <div className="stat">
                    <strong>{formatTime(plan?.duration || 0)}</strong>
                    <span>成片时长</span>
                  </div>
                  <div className="stat">
                    <strong>
                      {edits?.repairs.filter((r) => r.enabled).length || 0}
                    </strong>
                    <span>已应用剪切</span>
                  </div>
                  <div className="stat">
                    <strong>
                      {format === 'wav' ? '原音高' : `${fps} fps`}
                    </strong>
                    <span>{format === 'wav' ? '保留琴音' : '视频帧率'}</span>
                  </div>
                </div>
                {formatsReady && !formats.mp4 && (
                  <p className="hint">
                    {formats.webm
                      ? '当前浏览器可导出 WebM。需要 MP4 时请使用支持 H.264 / AAC 编码的 Chrome 或 Edge。'
                      : '当前浏览器可导出声音。视频导出需要支持 WebCodecs 的桌面版 Chrome 或 Edge。'}
                  </p>
                )}
                {busy ? (
                  <div>
                    <p className="text-sm mb-3">
                      {busy} · {Math.round(progress)}%
                    </p>
                    <Progress value={progress} aria-label="导出进度" />
                    <button className="btn subtle full mt-4" onClick={cancel}>
                      取消导出
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn primary full"
                    onClick={() => void doExport()}
                    disabled={!plan?.spans.length || !formatsReady}
                  >
                    <Download size={16} />
                    开始导出
                  </button>
                )}
              </>
            )}
            {error && (
              <p role="alert" className="text-sm text-red-300">
                {error}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="export-dialog">
          <DialogHeader>
            <DialogTitle>从一段练习，到更连贯的演奏</DialogTitle>
            <DialogDescription>
              适合钢琴、吉他等发音清楚的器乐视频。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm leading-7 text-[#b1bac7]">
            <p>
              <strong className="text-white">1. 导入并分析。</strong>{' '}
              选择视频后会自动估计节奏、比较相似乐句、压缩较长等待并整理首尾，直接生成可播放初稿，通常无需先调参数。
            </p>
            <p>
              <strong className="text-white">2. 试听与微调。</strong>{' '}
              在「再听几个片段」中对比原片和整理后，选择保持当前方案、再紧凑些或保留原来的停留。需要更细的修改时，可在时间线上调整发音点与拍数。所有修改均可撤销。
            </p>
            <p>
              <strong className="text-white">3. 预览并导出。</strong> 声音使用
              Rubber Band
              保持音高变速，画面跟随同一时间映射。导出期间请保持此页打开。
            </p>
            <p>
              自动结果可能把长音和犹豫混淆，不识别乐谱、纠正错音或补齐缺失乐句。合奏和背景音乐可能影响判断。最近五段视频的剪辑参数保存在当前浏览器，重新选择同一原片会恢复；跨浏览器请使用「保存剪辑」与「载入剪辑」。
            </p>
            <p className="text-xs text-[#8290a2]">
              建议桌面版 Chrome / Edge。支持 5 分钟、500 MB
              以内的素材；可用输入与导出格式取决于浏览器编码能力。
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
