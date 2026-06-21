import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState, useEffect } from "react";
import { fetchFile } from "@ffmpeg/util";
import { getFFmpeg, removeLogHandler, hasAudioByExt } from "@/lib/ffmpeg-client";
import JSZip from "jszip";
import {
  saveSession,
  loadSessions,
  getBlob,
  removeSession,
  clearAllHistory,
  type HistorySession,
} from "@/lib/history-db";
import {
  ArrowRight,
  Upload,
  Download,
  Loader2,
  Layers,
  CheckCircle2,
  AlertCircle,
  X,
  Play,
  RefreshCw,
  Star,
  Palette,
  Film,
  Volume2,
  VolumeX,
  Zap,
  Sparkles,
  Package,
  ChevronDown,
  ChevronUp,
  History,
  Trash2,
  Clock,
} from "lucide-react";

export const Route = createFileRoute("/batch")({
  head: () => ({
    meta: [
      { title: "معالجة دفعية — Video Enhancer Pro" },
      { name: "description", content: "طبّق نفس العملية على عشرات الفيديوهات دفعةً واحدة." },
    ],
  }),
  component: BatchPage,
});

type BatchMode =
  | "auto-enhance"
  | "compress"
  | "resize"
  | "fps"
  | "extract-audio"
  | "remove-audio"
  | "color-grade"
  | "gif"
  | "remove-watermark-blur";

type FileStatus = "pending" | "processing" | "done" | "error";

type BatchFile = {
  id: string;
  file: File;
  status: FileStatus;
  progress: number;
  startedAt: number | null;
  speedMBps: number | null;
  etaSec: number | null;
  outputUrl: string | null;
  outputName: string | null;
  outputBlob: Blob | null;
  error: string | null;
};

const BATCH_MODES: {
  value: BatchMode;
  label: string;
  icon: React.ElementType;
  color: string;
  desc: string;
}[] = [
  {
    value: "auto-enhance",
    label: "تحسين تلقائي",
    icon: Star,
    color: "amber",
    desc: "جودة + ألوان + حدّة",
  },
  {
    value: "compress",
    label: "ضغط الحجم",
    icon: Layers,
    color: "orange",
    desc: "تقليل الحجم بـ CRF",
  },
  {
    value: "resize",
    label: "تغيير الدقة",
    icon: Zap,
    color: "yellow",
    desc: "تحجيم إلى دقة موحّدة",
  },
  { value: "fps", label: "تغيير FPS", icon: Film, color: "teal", desc: "معدل إطارات ثابت" },
  {
    value: "color-grade",
    label: "تصحيح الألوان",
    icon: Palette,
    color: "pink",
    desc: "فلتر لوني موحّد",
  },
  {
    value: "gif",
    label: "تحويل إلى GIF",
    icon: Sparkles,
    color: "fuchsia",
    desc: "GIF محسّن بـ palette",
  },
  {
    value: "extract-audio",
    label: "استخراج الصوت",
    icon: Volume2,
    color: "lime",
    desc: "MP3 من كل فيديو",
  },
  {
    value: "remove-audio",
    label: "حذف الصوت",
    icon: VolumeX,
    color: "gray",
    desc: "فيديو بدون صوت",
  },
];

const COLOR_PRESETS = [
  { id: "vivid", label: "حيوي", filter: "eq=contrast=1.2:saturation=1.5:brightness=0.05" },
  { id: "cinema", label: "سينمائي", filter: "eq=contrast=1.15:saturation=0.85:gamma=1.1" },
  { id: "warm", label: "دافئ", filter: "eq=contrast=1.05:saturation=1.3:brightness=0.03" },
  { id: "cool", label: "بارد", filter: "hue=h=10:s=0.9,eq=contrast=1.05" },
  { id: "vintage", label: "كلاسيكي", filter: "eq=contrast=0.9:saturation=0.7:brightness=0.05" },
  { id: "bw", label: "أبيض وأسود", filter: "hue=s=0,eq=contrast=1.1" },
];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function BatchPage() {
  const [files, setFiles] = useState<BatchFile[]>([]);
  const [mode, setMode] = useState<BatchMode>("auto-enhance");
  const [running, setRunning] = useState(false);
  const [allDone, setAllDone] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showSettings, setShowSettings] = useState(true);
  const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);
  const [history, setHistory] = useState<HistorySession[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    loadSessions()
      .then(setHistory)
      .catch(() => {});
  }, []);

  async function refreshHistory() {
    try {
      setHistory(await loadSessions());
    } catch {
      /* ignore */
    }
  }

  // Settings
  const [autoLevel, setAutoLevel] = useState<"light" | "balanced" | "strong">("balanced");
  const [crf, setCrf] = useState(28);
  const [targetRes, setTargetRes] = useState<"1920x1080" | "1280x720" | "854x480">("1280x720");
  const [targetFps, setTargetFps] = useState(30);
  const [gifFps, setGifFps] = useState(10);
  const [gifWidth, setGifWidth] = useState(480);
  const [colorPreset, setColorPreset] = useState("vivid");

  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);

  function showToast(msg: string, type: "ok" | "err") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  function addFiles(incoming: File[]) {
    const videos = incoming.filter(
      (f) => f.type.startsWith("video/") || /\.(mp4|mov|avi|mkv|webm|flv|m4v)$/i.test(f.name),
    );
    const newEntries: BatchFile[] = videos.map((f) => ({
      id: uid(),
      file: f,
      status: "pending",
      progress: 0,
      startedAt: null,
      speedMBps: null,
      etaSec: null,
      outputUrl: null,
      outputName: null,
      outputBlob: null,
      error: null,
    }));
    setFiles((prev) => [...prev, ...newEntries]);
    setAllDone(false);
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  function updateFile(id: string, patch: Partial<BatchFile>) {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  async function processAll() {
    const pending = files.filter((f) => f.status === "pending" || f.status === "error");
    if (!pending.length) return;
    setRunning(true);
    abortRef.current = false;

    const sessionId = uid();
    const sessionBlobs: { itemId: string; blob: Blob }[] = [];
    const sessionItems: import("@/lib/history-db").HistoryItem[] = [];

    for (const entry of pending) {
      if (abortRef.current) break;

      const processingStartedAt = Date.now();
      updateFile(entry.id, {
        status: "processing",
        progress: 0,
        error: null,
        startedAt: processingStartedAt,
        speedMBps: null,
        etaSec: null,
      });

      const logLines: string[] = [];
      const logHandler = (m: string) => logLines.push(m);

      try {
        const ffmpeg = await getFFmpeg(logHandler);
        const fileSizeMB = entry.file.size / 1024 / 1024;

        ffmpeg.on("progress", ({ progress: p }) => {
          const pct = Math.round(Math.max(0, Math.min(100, p * 100)));
          const elapsedSec = (Date.now() - processingStartedAt) / 1000;
          let speedMBps: number | null = null;
          let etaSec: number | null = null;
          if (elapsedSec > 0.5 && pct > 1) {
            speedMBps = parseFloat(((fileSizeMB * pct) / 100 / elapsedSec).toFixed(2));
            const remaining = fileSizeMB * (1 - pct / 100);
            etaSec = speedMBps > 0 ? Math.round(remaining / speedMBps) : null;
          }
          updateFile(entry.id, { progress: pct, speedMBps, etaSec });
        });

        const ext = entry.file.name.split(".").pop()?.toLowerCase() || "mp4";
        const inputName = `input_${entry.id}.${ext}`;
        await ffmpeg.writeFile(inputName, await fetchFile(entry.file));
        const hasAudio = hasAudioByExt(inputName);

        let outName = `output_${entry.id}.mp4`;
        let args: string[] = [];

        if (mode === "auto-enhance") {
          const vf: string[] = [];
          if (autoLevel === "light") {
            vf.push(
              "hqdn3d=2:1:3:2.5",
              "eq=brightness=0.02:contrast=1.05:saturation=1.15:gamma=0.97",
              "unsharp=3:3:0.3",
            );
          } else if (autoLevel === "balanced") {
            vf.push(
              "hqdn3d=3:2:4:3.5",
              "eq=brightness=0.03:contrast=1.1:saturation=1.25:gamma=0.95",
              "unsharp=5:5:0.5",
            );
          } else {
            vf.push(
              "hqdn3d=4:3:6:4.5",
              "eq=brightness=0.05:contrast=1.15:saturation=1.4:gamma=0.92",
              "unsharp=5:5:0.8",
            );
          }
          const audioArgs: string[] = hasAudio
            ? autoLevel !== "light"
              ? ["-af", "loudnorm=I=-18:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "128k"]
              : ["-c:a", "copy"]
            : [];
          args = [
            "-i",
            inputName,
            "-vf",
            vf.join(","),
            ...audioArgs,
            "-c:v",
            "libx264",
            "-crf",
            autoLevel === "strong" ? "18" : "20",
            "-preset",
            "ultrafast",
            outName,
          ];
        } else if (mode === "compress") {
          args = [
            "-i",
            inputName,
            "-c:v",
            "libx264",
            "-crf",
            String(crf),
            "-preset",
            "veryfast",
            ...(hasAudio ? ["-c:a", "aac", "-b:a", "128k"] : ["-an"]),
            outName,
          ];
        } else if (mode === "resize") {
          const [w, h] = targetRes.split("x");
          args = [
            "-i",
            inputName,
            "-vf",
            `scale=${w}:${h}:flags=lanczos`,
            ...(hasAudio ? ["-c:a", "copy"] : []),
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            outName,
          ];
        } else if (mode === "fps") {
          args = [
            "-i",
            inputName,
            "-filter:v",
            `fps=${targetFps}`,
            ...(hasAudio ? ["-c:a", "copy"] : []),
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            outName,
          ];
        } else if (mode === "color-grade") {
          const preset = COLOR_PRESETS.find((p) => p.id === colorPreset);
          args = [
            "-i",
            inputName,
            "-vf",
            preset?.filter ?? "eq=contrast=1.1:saturation=1.2",
            ...(hasAudio ? ["-c:a", "copy"] : []),
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            outName,
          ];
        } else if (mode === "gif") {
          outName = `output_${entry.id}.gif`;
          args = [
            "-i",
            inputName,
            "-vf",
            `fps=${gifFps},scale=${gifWidth}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
            outName,
          ];
        } else if (mode === "extract-audio") {
          outName = `output_${entry.id}.mp3`;
          args = ["-i", inputName, "-vn", "-acodec", "libmp3lame", "-q:a", "2", outName];
        } else if (mode === "remove-audio") {
          args = ["-i", inputName, "-c:v", "copy", "-an", outName];
        }

        await ffmpeg.exec(args);

        const data = (await ffmpeg.readFile(outName)) as Uint8Array;
        const mime = outName.endsWith(".mp3")
          ? "audio/mpeg"
          : outName.endsWith(".gif")
            ? "image/gif"
            : "video/mp4";
        const blob = new Blob([data], { type: mime });
        const url = URL.createObjectURL(blob);

        const baseName = entry.file.name.replace(/\.[^.]+$/, "");
        const finalExt = outName.split(".").pop()!;
        const friendlyName = `${baseName}_${mode}.${finalExt}`;

        updateFile(entry.id, {
          status: "done",
          progress: 100,
          outputUrl: url,
          outputBlob: blob,
          outputName: friendlyName,
        });

        sessionBlobs.push({ itemId: entry.id, blob });
        sessionItems.push({
          id: entry.id,
          filename: friendlyName,
          sizeMB: parseFloat((blob.size / 1024 / 1024).toFixed(2)),
          mime,
        });

        await ffmpeg.deleteFile(inputName).catch(() => {});
        await ffmpeg.deleteFile(outName).catch(() => {});
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        updateFile(entry.id, { status: "error", error: msg.slice(0, 120) });
      } finally {
        removeLogHandler(logHandler);
      }
    }

    setRunning(false);
    setAllDone(true);
    showToast("اكتملت المعالجة الدفعية!", "ok");

    if (sessionItems.length > 0) {
      const opMeta = BATCH_MODES.find((m) => m.value === mode);
      try {
        await saveSession(
          {
            id: sessionId,
            ts: Date.now(),
            op: mode,
            opLabel: opMeta?.label ?? mode,
            items: sessionItems,
          },
          sessionBlobs,
        );
        await refreshHistory();
        setShowHistory(true);
      } catch {
        /* storage full or denied — continue silently */
      }
    }
  }

  async function downloadAll() {
    const done = files.filter((f) => f.status === "done" && f.outputBlob && f.outputName);
    if (!done.length) return;
    showToast("جاري إنشاء ملف ZIP...", "ok");
    const zip = new JSZip();
    for (const f of done) {
      zip.file(f.outputName!, f.outputBlob!);
    }
    const blob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 1 },
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `batch_${mode}_${Date.now()}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function resetAll() {
    files.forEach((f) => {
      if (f.outputUrl) URL.revokeObjectURL(f.outputUrl);
    });
    setFiles([]);
    setAllDone(false);
  }

  const doneCount = files.filter((f) => f.status === "done").length;
  const errorCount = files.filter((f) => f.status === "error").length;
  const pendingCount = files.filter((f) => f.status === "pending" || f.status === "error").length;
  const currentlyProcessing = files.find((f) => f.status === "processing");

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-medium shadow-2xl backdrop-blur-md border animate-in slide-in-from-top-2 ${toast.type === "ok" ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300" : "bg-red-500/20 border-red-500/40 text-red-300"}`}
        >
          {toast.type === "ok" ? (
            <CheckCircle2 className="size-4" />
          ) : (
            <AlertCircle className="size-4" />
          )}
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3.5 border-b border-border/60 sticky top-0 z-40 bg-background/95 backdrop-blur-sm">
        <Link
          to="/"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition"
        >
          <ArrowRight className="size-4" /> الرئيسية
        </Link>
        <div className="flex items-center gap-2 font-bold text-sm">
          <div className="p-1.5 rounded-lg bg-violet-500/15">
            <Layers className="size-4 text-violet-400" />
          </div>
          معالجة دفعية
        </div>
        <Link to="/library" className="text-sm text-muted-foreground hover:text-primary transition">
          مكتبتي
        </Link>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 space-y-5">
        {/* Stats bar */}
        {files.length > 0 && (
          <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-card/50 px-5 py-3">
            <div className="flex items-center gap-2 text-sm">
              <div className="size-2 rounded-full bg-muted-foreground" />
              <span className="text-muted-foreground">{files.length} ملف</span>
            </div>
            {doneCount > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <div className="size-2 rounded-full bg-emerald-500" />
                <span className="text-emerald-400">{doneCount} اكتمل</span>
              </div>
            )}
            {errorCount > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <div className="size-2 rounded-full bg-red-500" />
                <span className="text-red-400">{errorCount} فشل</span>
              </div>
            )}
            {running && currentlyProcessing && (
              <div className="flex items-center gap-2 text-sm ml-auto">
                <Loader2 className="size-4 animate-spin text-violet-400" />
                <span className="text-violet-400 font-medium">
                  جاري معالجة:{" "}
                  <span className="font-mono text-xs">
                    {currentlyProcessing.file.name.slice(0, 30)}
                  </span>
                </span>
              </div>
            )}
            {allDone && doneCount > 0 && (
              <button
                onClick={downloadAll}
                className="ml-auto flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:opacity-90 transition"
              >
                <Package className="size-3.5" /> تحميل الكل ({doneCount}) ZIP
              </button>
            )}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          {/* LEFT: File Queue */}
          <section className="space-y-4">
            {/* Drop Zone */}
            <div
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                addFiles(Array.from(e.dataTransfer.files));
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => inputRef.current?.click()}
              className={`relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 cursor-pointer transition ${dragOver ? "border-violet-400 bg-violet-500/10" : "border-border hover:border-violet-500/50 hover:bg-violet-500/5"}`}
            >
              <div className="rounded-2xl bg-violet-500/10 p-4">
                <Upload className="size-8 text-violet-400" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-base">اسحب الفيديوهات هنا أو اضغط للرفع</p>
                <p className="text-sm text-muted-foreground mt-1">
                  MP4, MOV, AVI, MKV, WebM — يمكن رفع عدة ملفات معاً
                </p>
              </div>
              {dragOver && (
                <div className="absolute inset-0 rounded-2xl bg-violet-500/10 flex items-center justify-center">
                  <span className="text-violet-400 font-bold text-lg">أفلت الملفات هنا</span>
                </div>
              )}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="video/*"
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />

            {/* File Cards */}
            {files.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <span className="text-sm font-semibold text-muted-foreground">
                    {files.length} ملف في القائمة
                  </span>
                  <button
                    onClick={resetAll}
                    className="text-xs text-muted-foreground hover:text-destructive transition flex items-center gap-1"
                  >
                    <RefreshCw className="size-3" /> مسح الكل
                  </button>
                </div>

                <div className="space-y-2">
                  {files.map((f) => (
                    <FileCard key={f.id} entry={f} onRemove={() => removeFile(f.id)} />
                  ))}
                </div>
              </div>
            )}

            {files.length === 0 && (
              <div className="rounded-2xl border border-border/50 bg-card/30 p-8 text-center space-y-2">
                <Layers className="size-8 text-muted-foreground/40 mx-auto" />
                <p className="text-sm text-muted-foreground">لم تُضف أي ملفات بعد</p>
                <p className="text-xs text-muted-foreground/60">
                  ارفع فيديوهات من الأعلى لبدء المعالجة الدفعية
                </p>
              </div>
            )}
          </section>

          {/* RIGHT: Settings + Run */}
          <aside className="space-y-4">
            {/* Operation Picker */}
            <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
              <h2 className="text-sm font-bold">اختر العملية</h2>
              <div className="grid grid-cols-2 gap-1.5">
                {BATCH_MODES.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => setMode(m.value)}
                    className={`flex flex-col gap-0.5 rounded-xl px-3 py-2.5 text-right transition ${mode === m.value ? "bg-violet-600 text-white shadow-sm" : "bg-background/60 border border-border hover:bg-secondary text-muted-foreground hover:text-foreground"}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <m.icon className="size-3.5 shrink-0" />
                      <span className="text-xs font-semibold truncate">{m.label}</span>
                    </div>
                    <span
                      className={`text-[10px] ${mode === m.value ? "text-white/70" : "text-muted-foreground"}`}
                    >
                      {m.desc}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Operation Settings */}
            <div className="rounded-2xl border border-border bg-card/60 overflow-hidden">
              <button
                onClick={() => setShowSettings((s) => !s)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-bold hover:bg-secondary/50 transition"
              >
                <span>إعدادات العملية</span>
                {showSettings ? (
                  <ChevronUp className="size-4" />
                ) : (
                  <ChevronDown className="size-4" />
                )}
              </button>
              {showSettings && (
                <div className="px-4 pb-4 space-y-3 border-t border-border/50 pt-3">
                  <BatchSettings
                    mode={mode}
                    autoLevel={autoLevel}
                    setAutoLevel={setAutoLevel}
                    crf={crf}
                    setCrf={setCrf}
                    targetRes={targetRes}
                    setTargetRes={setTargetRes}
                    targetFps={targetFps}
                    setTargetFps={setTargetFps}
                    gifFps={gifFps}
                    setGifFps={setGifFps}
                    gifWidth={gifWidth}
                    setGifWidth={setGifWidth}
                    colorPreset={colorPreset}
                    setColorPreset={setColorPreset}
                  />
                </div>
              )}
            </div>

            {/* Run Button */}
            <button
              onClick={processAll}
              disabled={running || pendingCount === 0}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-6 py-3.5 font-bold text-white hover:opacity-90 transition disabled:opacity-40 shadow-lg shadow-violet-500/20 text-sm"
            >
              {running ? (
                <>
                  <Loader2 className="size-5 animate-spin" /> جاري المعالجة...
                </>
              ) : (
                <>
                  <Play className="size-5" /> تشغيل ({pendingCount} ملف)
                </>
              )}
            </button>

            {running && (
              <button
                onClick={() => {
                  abortRef.current = true;
                }}
                className="w-full rounded-xl border border-red-500/40 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition"
              >
                إيقاف بعد الملف الحالي
              </button>
            )}

            {allDone && doneCount > 0 && (
              <button
                onClick={downloadAll}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-3.5 font-bold text-white hover:opacity-90 transition shadow-lg text-sm"
              >
                <Package className="size-5" /> تحميل الكل كـ ZIP ({doneCount} ملف)
              </button>
            )}

            {/* Summary */}
            <div className="rounded-2xl border border-border bg-card/40 p-4 space-y-2.5">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                ملخص الدفعة
              </h3>
              <SummaryRow
                label="العملية"
                value={BATCH_MODES.find((m) => m.value === mode)?.label ?? mode}
              />
              <SummaryRow label="إجمالي الملفات" value={String(files.length)} />
              <SummaryRow label="قيد الانتظار" value={String(pendingCount)} accent />
              <SummaryRow label="اكتمل" value={String(doneCount)} ok={doneCount > 0} />
              {errorCount > 0 && <SummaryRow label="فشل" value={String(errorCount)} err />}
            </div>
          </aside>
        </div>

        {/* ─── History Panel ─── */}
        <section className="rounded-2xl border border-border bg-card/50 overflow-hidden">
          <button
            onClick={() => setShowHistory((s) => !s)}
            className="w-full flex items-center justify-between px-5 py-3.5 text-sm font-bold hover:bg-secondary/40 transition"
          >
            <div className="flex items-center gap-2">
              <History className="size-4 text-violet-400" />
              سجل الجلسات
              {history.length > 0 && (
                <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-bold text-violet-400">
                  {history.length}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {history.length > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    clearAllHistory().then(refreshHistory);
                  }}
                  className="text-xs text-muted-foreground hover:text-destructive transition flex items-center gap-1"
                >
                  <Trash2 className="size-3" /> مسح الكل
                </button>
              )}
              {showHistory ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </div>
          </button>

          {showHistory && (
            <div className="border-t border-border/50 p-4">
              {history.length === 0 ? (
                <div className="py-8 text-center space-y-2">
                  <Clock className="size-7 text-muted-foreground/30 mx-auto" />
                  <p className="text-sm text-muted-foreground">لا توجد جلسات محفوظة</p>
                  <p className="text-xs text-muted-foreground/50">
                    بعد معالجة ملفات، يحفظ النظام النتائج هنا تلقائياً — يمكنك إعادة تحميلها حتى بعد
                    تحديث الصفحة.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {history.map((session) => (
                    <HistorySessionCard
                      key={session.id}
                      session={session}
                      onDelete={() =>
                        removeSession(
                          session.id,
                          session.items.map((i) => i.id),
                        ).then(refreshHistory)
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function FileCard({ entry, onRemove }: { entry: BatchFile; onRemove: () => void }) {
  const sizeMB = (entry.file.size / 1024 / 1024).toFixed(1);
  const ext = entry.file.name.split(".").pop()?.toUpperCase() ?? "";

  return (
    <div
      className={`rounded-xl border px-4 py-3 transition ${
        entry.status === "done"
          ? "border-emerald-500/30 bg-emerald-500/5"
          : entry.status === "error"
            ? "border-red-500/30 bg-red-500/5"
            : entry.status === "processing"
              ? "border-violet-500/40 bg-violet-500/5"
              : "border-border bg-card/40"
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div
          className={`mt-0.5 shrink-0 size-8 rounded-lg flex items-center justify-center text-[10px] font-bold ${
            entry.status === "done"
              ? "bg-emerald-500/20 text-emerald-400"
              : entry.status === "error"
                ? "bg-red-500/20 text-red-400"
                : entry.status === "processing"
                  ? "bg-violet-500/20 text-violet-400"
                  : "bg-muted text-muted-foreground"
          }`}
        >
          {entry.status === "processing" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : entry.status === "done" ? (
            <CheckCircle2 className="size-4" />
          ) : entry.status === "error" ? (
            <AlertCircle className="size-4" />
          ) : (
            ext
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" title={entry.file.name}>
            {entry.file.name}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{sizeMB} MB</p>

          {/* Progress bar */}
          {entry.status === "processing" && (
            <div className="mt-2 space-y-1.5">
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-purple-400 rounded-full transition-all duration-300"
                  style={{ width: `${Math.max(4, entry.progress)}%` }}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-violet-400 font-mono font-bold">
                  {entry.progress}%
                </span>
                <div className="flex items-center gap-2">
                  {entry.speedMBps !== null && (
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {entry.speedMBps} MB/s
                    </span>
                  )}
                  {entry.etaSec !== null && entry.etaSec > 0 && (
                    <span className="text-[10px] text-amber-400/80 font-mono">
                      {entry.etaSec < 60
                        ? `${entry.etaSec}ث`
                        : `${Math.floor(entry.etaSec / 60)}د ${entry.etaSec % 60}ث`}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {entry.status === "error" && (
            <p className="text-[10px] text-red-400 mt-1 line-clamp-2">{entry.error}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {entry.status === "done" && entry.outputUrl && entry.outputName && (
            <a
              href={entry.outputUrl}
              download={entry.outputName}
              className="flex items-center gap-1 rounded-lg bg-emerald-600/80 px-2.5 py-1 text-[11px] font-semibold text-white hover:opacity-90 transition"
            >
              <Download className="size-3" /> تحميل
            </a>
          )}
          {entry.status !== "processing" && (
            <button
              onClick={onRemove}
              className="size-7 rounded-lg bg-background/60 border border-border flex items-center justify-center text-muted-foreground hover:text-destructive hover:border-destructive/40 transition"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function BatchSettings(p: {
  mode: BatchMode;
  autoLevel: string;
  setAutoLevel: (v: any) => void;
  crf: number;
  setCrf: (v: number) => void;
  targetRes: string;
  setTargetRes: (v: any) => void;
  targetFps: number;
  setTargetFps: (v: number) => void;
  gifFps: number;
  setGifFps: (v: number) => void;
  gifWidth: number;
  setGifWidth: (v: number) => void;
  colorPreset: string;
  setColorPreset: (v: string) => void;
}) {
  if (p.mode === "auto-enhance")
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">مستوى التحسين</p>
        <div className="grid grid-cols-3 gap-1.5">
          {(["light", "balanced", "strong"] as const).map((lv) => (
            <button
              key={lv}
              onClick={() => p.setAutoLevel(lv)}
              className={`rounded-lg py-2 text-xs font-semibold transition ${p.autoLevel === lv ? "bg-amber-500 text-white" : "bg-background border border-border hover:bg-secondary text-muted-foreground"}`}
            >
              {lv === "light" ? "خفيف" : lv === "balanced" ? "متوازن" : "قوي"}
            </button>
          ))}
        </div>
      </div>
    );

  if (p.mode === "compress")
    return (
      <div className="space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">جودة CRF</span>
          <span className="font-mono font-bold">
            {p.crf} {p.crf <= 23 ? "(جودة عالية)" : p.crf <= 28 ? "(متوسط)" : "(حجم صغير)"}
          </span>
        </div>
        <input
          type="range"
          min={18}
          max={40}
          step={1}
          value={p.crf}
          onChange={(e) => p.setCrf(+e.target.value)}
          className="w-full accent-orange-500"
        />
        <p className="text-[10px] text-muted-foreground">
          كلما زادت القيمة قل الحجم وانخفضت الجودة. 23 هو الافتراضي.
        </p>
      </div>
    );

  if (p.mode === "resize")
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">الدقة المستهدفة</p>
        <div className="space-y-1.5">
          {(["1920x1080", "1280x720", "854x480"] as const).map((r) => (
            <button
              key={r}
              onClick={() => p.setTargetRes(r)}
              className={`w-full rounded-lg py-2 px-3 text-xs font-medium text-right transition ${p.targetRes === r ? "bg-yellow-500 text-black" : "bg-background border border-border hover:bg-secondary text-muted-foreground"}`}
            >
              {r === "1920x1080"
                ? "1080p (Full HD) · 1920×1080"
                : r === "1280x720"
                  ? "720p (HD) · 1280×720"
                  : "480p · 854×480"}
            </button>
          ))}
        </div>
      </div>
    );

  if (p.mode === "fps")
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">معدل الإطارات المستهدف</p>
        <div className="grid grid-cols-4 gap-1.5">
          {[24, 30, 60, 120].map((fps) => (
            <button
              key={fps}
              onClick={() => p.setTargetFps(fps)}
              className={`rounded-lg py-2 text-xs font-bold transition ${p.targetFps === fps ? "bg-teal-500 text-white" : "bg-background border border-border hover:bg-secondary text-muted-foreground"}`}
            >
              {fps}
            </button>
          ))}
        </div>
      </div>
    );

  if (p.mode === "color-grade")
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">الفلتر اللوني</p>
        <div className="grid grid-cols-2 gap-1.5">
          {COLOR_PRESETS.map((cp) => (
            <button
              key={cp.id}
              onClick={() => p.setColorPreset(cp.id)}
              className={`rounded-lg py-2 text-xs font-medium transition ${p.colorPreset === cp.id ? "bg-pink-600 text-white" : "bg-background border border-border hover:bg-secondary text-muted-foreground"}`}
            >
              {cp.label}
            </button>
          ))}
        </div>
      </div>
    );

  if (p.mode === "gif")
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">معدل الإطارات (FPS)</span>
            <span className="font-mono font-bold">{p.gifFps}</span>
          </div>
          <input
            type="range"
            min={5}
            max={30}
            step={1}
            value={p.gifFps}
            onChange={(e) => p.setGifFps(+e.target.value)}
            className="w-full accent-fuchsia-500"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">العرض (px)</span>
            <span className="font-mono font-bold">{p.gifWidth}px</span>
          </div>
          <input
            type="range"
            min={240}
            max={960}
            step={80}
            value={p.gifWidth}
            onChange={(e) => p.setGifWidth(+e.target.value)}
            className="w-full accent-fuchsia-500"
          />
        </div>
      </div>
    );

  return (
    <p className="text-xs text-muted-foreground py-1">
      {p.mode === "extract-audio"
        ? "يستخرج صوت كل فيديو كملف MP3 بجودة VBR عالية."
        : p.mode === "remove-audio"
          ? "يُزيل المسار الصوتي من كل فيديو مع نسخ الفيديو بدون إعادة تشفير."
          : "لا توجد إعدادات إضافية لهذه العملية."}
    </p>
  );
}

function SummaryRow({
  label,
  value,
  accent,
  ok,
  err,
}: {
  label: string;
  value: string;
  accent?: boolean;
  ok?: boolean;
  err?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`font-semibold font-mono ${ok ? "text-emerald-400" : err ? "text-red-400" : accent ? "text-violet-400" : "text-foreground"}`}
      >
        {value}
      </span>
    </div>
  );
}

function HistorySessionCard({
  session,
  onDelete,
}: {
  session: HistorySession;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const date = new Date(session.ts);
  const dateStr = date.toLocaleDateString("ar-SA", { month: "short", day: "numeric" });
  const timeStr = date.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" });
  const totalMB = session.items.reduce((s, i) => s + i.sizeMB, 0).toFixed(1);

  async function downloadItem(item: import("@/lib/history-db").HistoryItem) {
    setDownloading(item.id);
    try {
      const blob = await getBlob(session.id, item.id);
      if (!blob) {
        alert("الملف لم يعد متاحاً في التخزين");
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = item.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } finally {
      setDownloading(null);
    }
  }

  async function downloadAllItems() {
    setDownloading("zip");
    try {
      const zip = new JSZip();
      for (const item of session.items) {
        const blob = await getBlob(session.id, item.id);
        if (blob) zip.file(item.filename, blob);
      }
      const zipBlob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 1 },
      });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `session_${session.op}_${session.id}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-background/60 overflow-hidden">
      {/* Session header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="flex-1 flex items-center gap-3 text-right min-w-0"
        >
          <div className="rounded-lg bg-violet-500/15 p-2 shrink-0">
            <History className="size-3.5 text-violet-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold">{session.opLabel}</span>
              <span className="text-[10px] rounded-full bg-muted/60 px-2 py-0.5 text-muted-foreground font-mono">
                {session.items.length} ملف · {totalMB} MB
              </span>
            </div>
            <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
              <Clock className="size-3 shrink-0" />
              <span>
                {dateStr} · {timeStr}
              </span>
            </div>
          </div>
          {expanded ? (
            <ChevronUp className="size-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="size-4 text-muted-foreground shrink-0" />
          )}
        </button>

        <div className="flex items-center gap-2 shrink-0">
          {session.items.length > 1 && (
            <button
              onClick={downloadAllItems}
              disabled={downloading === "zip"}
              className="flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2.5 py-1.5 text-[11px] font-bold text-emerald-400 hover:bg-emerald-500/25 transition disabled:opacity-50"
            >
              {downloading === "zip" ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Package className="size-3" />
              )}
              ZIP
            </button>
          )}
          <button
            onClick={onDelete}
            className="rounded-lg p-1.5 text-muted-foreground hover:text-destructive hover:bg-red-500/10 transition"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Expanded items list */}
      {expanded && (
        <div className="border-t border-border/40 divide-y divide-border/30">
          {session.items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{item.filename}</p>
                <p className="text-[10px] text-muted-foreground">
                  {item.sizeMB} MB · {item.mime.split("/")[1]?.toUpperCase()}
                </p>
              </div>
              <button
                onClick={() => downloadItem(item)}
                disabled={downloading === item.id}
                className="flex items-center gap-1 rounded-lg bg-violet-500/15 px-3 py-1.5 text-[11px] font-bold text-violet-400 hover:bg-violet-500/25 transition disabled:opacity-50 shrink-0"
              >
                {downloading === item.id ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Download className="size-3" />
                )}
                تحميل
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
