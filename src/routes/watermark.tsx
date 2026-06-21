import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState, useEffect, useCallback } from "react";
import { fetchFile } from "@ffmpeg/util";
import { getFFmpeg, removeLogHandler, hasAudioByExt } from "@/lib/ffmpeg-client";
import {
  ArrowRight,
  Upload,
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Droplets,
  Trash2,
  Plus,
  Wand2,
  Square,
  Eraser,
  X,
  Info,
  Cloud,
  Cpu,
} from "lucide-react";

export const Route = createFileRoute("/watermark")({
  head: () => ({
    meta: [
      { title: "إزالة العلامات المائية — Video Enhancer Pro" },
      {
        name: "description",
        content: "إزالة الشعارات والنصوص والعلامات المائية من الفيديو — delogo، ضبابية، أو تغطية.",
      },
    ],
  }),
  component: WatermarkPage,
});

type RegionMode = "delogo" | "blur" | "fill";

type Region = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  mode: RegionMode;
  blurStrength: number;
  fillColor: string;
};

const MODE_META: Record<
  RegionMode,
  { label: string; desc: string; color: string; border: string }
> = {
  delogo: {
    label: "استرداد",
    desc: "يملأ المنطقة بحسب المحيط — الأفضل للشعارات",
    color: "#8b5cf6",
    border: "border-violet-500/40",
  },
  blur: {
    label: "ضبابية",
    desc: "يضبب المنطقة — مثالي للنصوص والوجوه",
    color: "#0ea5e9",
    border: "border-sky-500/40",
  },
  fill: {
    label: "تغطية",
    desc: "يغطي بلون صلب — سريع وبسيط",
    color: "#f59e0b",
    border: "border-amber-500/40",
  },
};

const REGION_FILL: Record<RegionMode, string> = {
  delogo: "rgba(139,92,246,0.45)",
  blur: "rgba(14,165,233,0.45)",
  fill: "rgba(245,158,11,0.45)",
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function buildFiltergraph(
  regions: Region[],
  hasAudio: boolean,
): { args: string[]; outName: string } {
  const outName = "wm_out.mp4";
  const audioArgs = hasAudio ? ["-map", "0:a", "-c:a", "copy"] : ["-an"];

  if (regions.length === 0) {
    return { args: ["-c:v", "copy", ...audioArgs, outName], outName };
  }

  const hasBlur = regions.some((r) => r.mode === "blur");

  if (!hasBlur) {
    const vf = regions
      .map((r) => {
        if (r.mode === "delogo") return `delogo=x=${r.x}:y=${r.y}:w=${r.w}:h=${r.h}:show=0`;
        return `drawbox=x=${r.x}:y=${r.y}:w=${r.w}:h=${r.h}:color=${r.fillColor.replace("#", "0x")}@1:t=fill`;
      })
      .join(",");
    return {
      args: [
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "18",
        ...audioArgs,
        outName,
      ],
      outName,
    };
  }

  let stream = "0:v";
  const parts: string[] = [];
  let n = 0;

  for (const r of regions) {
    const out = `vo${n}`;
    if (r.mode === "delogo") {
      parts.push(`[${stream}]delogo=x=${r.x}:y=${r.y}:w=${r.w}:h=${r.h}:show=0[${out}]`);
    } else if (r.mode === "fill") {
      parts.push(
        `[${stream}]drawbox=x=${r.x}:y=${r.y}:w=${r.w}:h=${r.h}:color=${r.fillColor.replace("#", "0x")}@1:t=fill[${out}]`,
      );
    } else {
      const [mn, sp, bl] = [`mn${n}`, `sp${n}`, `bl${n}`];
      parts.push(`[${stream}]split=2[${mn}][${sp}]`);
      parts.push(`[${sp}]crop=${r.w}:${r.h}:${r.x}:${r.y},avgblur=${r.blurStrength}[${bl}]`);
      parts.push(`[${mn}][${bl}]overlay=${r.x}:${r.y}[${out}]`);
    }
    stream = out;
    n++;
  }

  const hasAudioMap = hasAudio ? ["-map", "0:a", "-c:a", "copy"] : ["-an"];
  return {
    args: [
      "-filter_complex",
      parts.join(";"),
      "-map",
      `[${stream}]`,
      ...hasAudioMap,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "18",
      outName,
    ],
    outName,
  };
}

function WatermarkPage() {
  const [file, setFile] = useState<File | null>(null);
  const [videoMeta, setVideoMeta] = useState<{ w: number; h: number } | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [defaultMode, setDefaultMode] = useState<RegionMode>("delogo");
  const [defaultBlur, setDefaultBlur] = useState(15);
  const [defaultFill, setDefaultFill] = useState("#000000");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showTip, setShowTip] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ffLog, setFfLog] = useState("");
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [outputName, setOutputName] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [processMode, setProcessMode] = useState<"local" | "cloud">("local");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hiddenVidRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<ImageBitmap | null>(null);
  const fileUrlRef = useRef<string | null>(null);
  const drawStart = useRef<{ x: number; y: number } | null>(null);
  const curRect = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function toast_(msg: string, type: "ok" | "err") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  const paint = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv || !videoMeta) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (frameRef.current) ctx.drawImage(frameRef.current, 0, 0, cv.width, cv.height);
    else {
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, cv.width, cv.height);
    }

    const sx = cv.width / videoMeta.w;
    const sy = cv.height / videoMeta.h;

    for (const r of regions) {
      const [dx, dy, dw, dh] = [r.x * sx, r.y * sy, r.w * sx, r.h * sy];
      ctx.fillStyle = REGION_FILL[r.mode];
      ctx.fillRect(dx, dy, dw, dh);
      ctx.strokeStyle = r.id === selectedId ? "#fff" : MODE_META[r.mode].color;
      ctx.lineWidth = r.id === selectedId ? 2 : 1.5;
      if (r.id === selectedId) ctx.setLineDash([5, 3]);
      ctx.strokeRect(dx, dy, dw, dh);
      ctx.setLineDash([]);
    }

    if (curRect.current) {
      const r = curRect.current;
      ctx.fillStyle = REGION_FILL[defaultMode];
      ctx.fillRect(r.x * sx, r.y * sy, r.w * sx, r.h * sy);
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x * sx, r.y * sy, r.w * sx, r.h * sy);
    }
  }, [regions, selectedId, videoMeta, defaultMode]);

  useEffect(() => {
    paint();
  }, [paint]);

  function loadFile(f: File) {
    if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
    if (outputUrl) {
      URL.revokeObjectURL(outputUrl);
      setOutputUrl(null);
    }
    const url = URL.createObjectURL(f);
    fileUrlRef.current = url;
    setFile(f);
    setRegions([]);
    setSelectedId(null);
    setVideoMeta(null);
    frameRef.current = null;

    const vid = hiddenVidRef.current!;
    vid.src = url;
    vid.onloadedmetadata = () => {
      setVideoMeta({ w: vid.videoWidth, h: vid.videoHeight });
      vid.currentTime = Math.min(0.5, vid.duration / 4);
    };
    vid.onseeked = () => {
      createImageBitmap(vid)
        .then((bmp) => {
          frameRef.current = bmp;
          paint();
        })
        .catch(() => {});
    };
    vid.load();
  }

  function scales() {
    const cv = canvasRef.current;
    if (!cv || !videoMeta) return null;
    return { sx: videoMeta.w / cv.width, sy: videoMeta.h / cv.height };
  }

  function onDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!videoMeta) return;
    const rect = e.currentTarget.getBoundingClientRect();
    drawStart.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    curRect.current = { x: 0, y: 0, w: 0, h: 0 };
    setSelectedId(null);
  }

  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drawStart.current || !videoMeta) return;
    const s = scales();
    if (!s) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const dispX = Math.min(drawStart.current.x, cx);
    const dispY = Math.min(drawStart.current.y, cy);
    curRect.current = {
      x: clamp(Math.round(dispX * s.sx), 0, videoMeta.w - 2),
      y: clamp(Math.round(dispY * s.sy), 0, videoMeta.h - 2),
      w: clamp(Math.round(Math.abs(cx - drawStart.current.x) * s.sx), 2, videoMeta.w),
      h: clamp(Math.round(Math.abs(cy - drawStart.current.y) * s.sy), 2, videoMeta.h),
    };
    paint();
  }

  function onUp() {
    if (!drawStart.current || !curRect.current) return;
    const r = curRect.current;
    if (r.w > 6 && r.h > 6) {
      const region: Region = {
        id: uid(),
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h,
        mode: defaultMode,
        blurStrength: defaultBlur,
        fillColor: defaultFill,
      };
      setRegions((p) => [...p, region]);
      setSelectedId(region.id);
    }
    drawStart.current = null;
    curRect.current = null;
    paint();
  }

  function removeRegion(id: string) {
    setRegions((p) => p.filter((r) => r.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function patchRegion(id: string, patch: Partial<Region>) {
    setRegions((p) => p.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function run() {
    if (!file) {
      toast_("ارفع فيديو أولاً", "err");
      return;
    }
    if (regions.length === 0) {
      toast_("ارسم منطقة واحدة على الأقل", "err");
      return;
    }
    setProcessing(true);
    setProgress(0);
    setFfLog("");
    if (outputUrl) {
      URL.revokeObjectURL(outputUrl);
      setOutputUrl(null);
    }

    const logs: string[] = [];
    const handler = (m: string) => {
      logs.push(m);
      setFfLog(logs.slice(-3).join("\n"));
    };
    try {
      const ffmpeg = await getFFmpeg(handler);
      ffmpeg.on("progress", ({ progress: p }) =>
        setProgress(Math.round(Math.max(0, Math.min(100, p * 100)))),
      );

      const ext = file.name.split(".").pop()?.toLowerCase() || "mp4";
      const inName = `wm_in.${ext}`;
      await ffmpeg.writeFile(inName, await fetchFile(file));
      const audio = hasAudioByExt(inName);

      const { args, outName } = buildFiltergraph(regions, audio);
      if (processMode === "cloud") {
        setProgress(20);
        const cloudArgs = ["-i", inName, ...args];
        const fd = new FormData();
        fd.append("file", file, inName);
        fd.append("args", JSON.stringify(cloudArgs));
        fd.append("outputName", outName);
        const cloudRes = await fetch("/api/cloud-exec", { method: "POST", body: fd });
        if (!cloudRes.ok) throw new Error("خطأ سحابي: " + (await cloudRes.text()).slice(0, 200));
        const resBlob = await cloudRes.blob();
        setProgress(100);
        setOutputUrl(URL.createObjectURL(new Blob([await resBlob.arrayBuffer()], { type: "video/mp4" })));
        setOutputName(`${file.name.replace(/\.[^.]+$/, "")}_clean.mp4`);
        toast_("اكتملت إزالة العلامات المائية! ☁", "ok");
      } else {
        await ffmpeg.exec(["-i", inName, ...args]);
        const data = (await ffmpeg.readFile(outName)) as Uint8Array;
        const blob = new Blob([data.buffer as ArrayBuffer], { type: "video/mp4" });
        setOutputUrl(URL.createObjectURL(blob));
        setOutputName(`${file.name.replace(/\.[^.]+$/, "")}_clean.mp4`);
        toast_("اكتملت المعالجة!", "ok");
      }

      await ffmpeg.deleteFile(inName).catch(() => {});
      await ffmpeg.deleteFile(outName).catch(() => {});
    } catch (e) {
      toast_(e instanceof Error ? e.message.slice(0, 120) : "حدث خطأ", "err");
    } finally {
      removeLogHandler(handler);
      setProcessing(false);
      setProgress(0);
      setFfLog("");
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <video ref={hiddenVidRef} className="hidden" muted playsInline crossOrigin="anonymous" />

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

      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3.5 border-b border-border/60 sticky top-0 z-40 bg-background/95 backdrop-blur-sm">
        <Link
          to="/"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition"
        >
          <ArrowRight className="size-4" /> الرئيسية
        </Link>
        <div className="flex items-center gap-2 font-bold text-sm">
          <div className="p-1.5 rounded-lg bg-rose-500/15">
            <Droplets className="size-4 text-rose-400" />
          </div>
          إزالة العلامات المائية
        </div>
        <Link to="/enhance" className="text-sm text-muted-foreground hover:text-primary transition">
          المحرر
        </Link>
      </header>

      {/* Processing mode bar */}
      <div className="border-b border-border bg-card/30">
        <div className="max-w-7xl mx-auto px-5 py-2.5 flex items-center gap-3">
          <span className="text-xs text-muted-foreground font-medium">وضع المعالجة:</span>
          <div className="flex rounded-xl border border-border overflow-hidden bg-background">
            <button onClick={() => setProcessMode("local")}
              className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold transition ${processMode === "local" ? "bg-rose-500/15 text-rose-400" : "text-muted-foreground hover:text-foreground"}`}>
              <Cpu className="size-3" /> محلي (WASM)
            </button>
            <button onClick={() => setProcessMode("cloud")}
              className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold transition ${processMode === "cloud" ? "bg-sky-500/15 text-sky-400" : "text-muted-foreground hover:text-foreground"}`}>
              <Cloud className="size-3" /> سحابي ☁
            </button>
          </div>
          <span className="text-[10px] text-muted-foreground">
            {processMode === "cloud" ? "يُعالج على السيرفر — مناسب للملفات الكبيرة" : "معالجة في المتصفح — خصوصية تامة"}
          </span>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          {/* ── LEFT: Canvas ── */}
          <section className="space-y-4">
            {showTip && file && (
              <div className="flex items-start gap-3 rounded-xl border border-sky-500/30 bg-sky-500/8 px-4 py-3">
                <Info className="size-4 text-sky-400 shrink-0 mt-0.5" />
                <p className="text-xs text-sky-300 flex-1">
                  اختر طريقة الإزالة من القائمة، ثم <strong>اسحب مستطيلاً</strong> فوق الشعار أو
                  النص على الصورة. يمكنك رسم عدة مناطق بطرق مختلفة.
                </p>
                <button
                  onClick={() => setShowTip(false)}
                  className="text-muted-foreground hover:text-foreground shrink-0"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}

            {!file ? (
              <div
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files[0];
                  if (f) loadFile(f);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onClick={() => inputRef.current?.click()}
                className={`flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-16 cursor-pointer transition ${dragOver ? "border-rose-400 bg-rose-500/10" : "border-border hover:border-rose-500/50 hover:bg-rose-500/5"}`}
              >
                <div className="rounded-2xl bg-rose-500/10 p-5">
                  <Droplets className="size-10 text-rose-400" />
                </div>
                <div className="text-center">
                  <p className="font-semibold text-base">اسحب فيديو أو اضغط للاختيار</p>
                  <p className="text-sm text-muted-foreground mt-1">MP4, MOV, MKV, WebM, AVI</p>
                </div>
              </div>
            ) : (
              videoMeta && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs text-muted-foreground font-medium">
                      {file.name} · {videoMeta.w}×{videoMeta.h}px
                    </span>
                    <button
                      onClick={() => {
                        setFile(null);
                        setRegions([]);
                        setVideoMeta(null);
                        frameRef.current = null;
                        if (outputUrl) {
                          URL.revokeObjectURL(outputUrl);
                          setOutputUrl(null);
                        }
                      }}
                      className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1 transition"
                    >
                      <X className="size-3" /> تغيير
                    </button>
                  </div>
                  <div className="relative rounded-2xl overflow-hidden border border-border select-none bg-black">
                    <canvas
                      ref={canvasRef}
                      width={800}
                      height={Math.round(800 * (videoMeta.h / videoMeta.w))}
                      className="w-full cursor-crosshair block"
                      onMouseDown={onDown}
                      onMouseMove={onMove}
                      onMouseUp={onUp}
                      onMouseLeave={onUp}
                    />
                    {regions.length === 0 && !processing && (
                      <div className="absolute inset-0 flex items-end justify-center pb-5 pointer-events-none">
                        <span className="rounded-xl bg-black/60 backdrop-blur-sm px-3 py-1.5 text-xs text-white/60">
                          اسحب لرسم منطقة فوق الشعار أو النص
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )
            )}

            <input
              ref={inputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) loadFile(f);
                e.target.value = "";
              }}
            />

            {processing && (
              <div className="rounded-xl border border-violet-500/30 bg-violet-500/8 px-4 py-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin text-violet-400" />
                    <span className="text-violet-300 font-medium">جاري المعالجة…</span>
                  </div>
                  <span className="font-mono text-violet-400 font-bold">{progress}%</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-violet-500 to-purple-400 rounded-full transition-all duration-300"
                    style={{ width: `${Math.max(4, progress)}%` }}
                  />
                </div>
                {ffLog && (
                  <p className="text-[10px] text-muted-foreground/60 font-mono leading-relaxed line-clamp-2 break-all">
                    {ffLog}
                  </p>
                )}
              </div>
            )}

            {outputUrl && outputName && (
              <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-4 py-3">
                <CheckCircle2 className="size-5 text-emerald-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-emerald-300">اكتملت الإزالة</p>
                  <p className="text-xs text-muted-foreground truncate">{outputName}</p>
                </div>
                <a
                  href={outputUrl}
                  download={outputName}
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:opacity-90 transition shrink-0"
                >
                  <Download className="size-4" /> تحميل
                </a>
              </div>
            )}
          </section>

          {/* ── RIGHT: Controls ── */}
          <aside className="space-y-4">
            {/* Default mode */}
            <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
              <h2 className="text-sm font-bold flex items-center gap-2">
                <Square className="size-4 text-muted-foreground" />
                طريقة الإزالة
              </h2>
              <div className="space-y-1.5">
                {(Object.keys(MODE_META) as RegionMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setDefaultMode(m)}
                    className={`w-full flex items-start gap-3 rounded-xl px-3 py-2.5 text-right transition ${defaultMode === m ? "text-white shadow-sm" : "bg-background/60 border border-border hover:bg-secondary text-muted-foreground hover:text-foreground"}`}
                    style={defaultMode === m ? { background: MODE_META[m].color } : undefined}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold">{MODE_META[m].label}</div>
                      <div
                        className={`text-[10px] mt-0.5 ${defaultMode === m ? "text-white/70" : "text-muted-foreground"}`}
                      >
                        {MODE_META[m].desc}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              {defaultMode === "blur" && (
                <div className="space-y-1.5 pt-1 border-t border-border/40">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">شدة الضبابية</span>
                    <span className="font-mono font-bold">{defaultBlur}</span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={40}
                    step={1}
                    value={defaultBlur}
                    onChange={(e) => setDefaultBlur(+e.target.value)}
                    className="w-full accent-sky-500"
                  />
                </div>
              )}
              {defaultMode === "fill" && (
                <div className="flex items-center gap-3 pt-1 border-t border-border/40">
                  <span className="text-xs text-muted-foreground">لون التغطية</span>
                  <input
                    type="color"
                    value={defaultFill}
                    onChange={(e) => setDefaultFill(e.target.value)}
                    className="size-8 rounded cursor-pointer border border-border bg-transparent"
                  />
                  <span className="font-mono text-xs">{defaultFill}</span>
                </div>
              )}
            </div>

            {/* Regions list */}
            <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold flex items-center gap-2">
                  <Eraser className="size-4 text-muted-foreground" />
                  المناطق المحددة
                  {regions.length > 0 && (
                    <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-400">
                      {regions.length}
                    </span>
                  )}
                </h2>
                {regions.length > 0 && (
                  <button
                    onClick={() => {
                      setRegions([]);
                      setSelectedId(null);
                    }}
                    className="text-xs text-muted-foreground hover:text-destructive transition flex items-center gap-1"
                  >
                    <Trash2 className="size-3" /> حذف الكل
                  </button>
                )}
              </div>

              {regions.length === 0 ? (
                <div className="py-6 text-center space-y-1.5">
                  <Plus className="size-6 text-muted-foreground/30 mx-auto" />
                  <p className="text-xs text-muted-foreground">ارسم مناطق على الفيديو لتظهر هنا</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {regions.map((r, i) => (
                    <div
                      key={r.id}
                      onClick={() => setSelectedId(r.id === selectedId ? null : r.id)}
                      className={`rounded-xl border p-3 cursor-pointer transition ${r.id === selectedId ? "border-white/20 bg-secondary/60" : "border-border bg-background/50 hover:bg-secondary/30"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className="size-3 rounded-sm shrink-0"
                            style={{ background: MODE_META[r.mode].color }}
                          />
                          <span className="text-xs font-semibold">منطقة {i + 1}</span>
                          <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                            {r.w}×{r.h}
                          </span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeRegion(r.id);
                          }}
                          className="text-muted-foreground hover:text-destructive transition shrink-0"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>

                      {r.id === selectedId && (
                        <div className="mt-3 space-y-2 border-t border-border/40 pt-2.5">
                          <div className="grid grid-cols-3 gap-1">
                            {(Object.keys(MODE_META) as RegionMode[]).map((m) => (
                              <button
                                key={m}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  patchRegion(r.id, { mode: m });
                                }}
                                className="rounded-lg py-1.5 text-[10px] font-semibold transition border"
                                style={
                                  r.mode === m
                                    ? {
                                        background: MODE_META[m].color,
                                        borderColor: "transparent",
                                        color: "#fff",
                                      }
                                    : {
                                        background: "transparent",
                                        borderColor: "rgba(255,255,255,0.1)",
                                        color: "#999",
                                      }
                                }
                              >
                                {MODE_META[m].label}
                              </button>
                            ))}
                          </div>
                          {r.mode === "blur" && (
                            <div className="space-y-1">
                              <div className="flex justify-between text-[10px]">
                                <span className="text-muted-foreground">الضبابية</span>
                                <span className="font-mono">{r.blurStrength}</span>
                              </div>
                              <input
                                type="range"
                                min={5}
                                max={40}
                                step={1}
                                value={r.blurStrength}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) =>
                                  patchRegion(r.id, { blurStrength: +e.target.value })
                                }
                                className="w-full accent-sky-500"
                              />
                            </div>
                          )}
                          {r.mode === "fill" && (
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-muted-foreground">اللون</span>
                              <input
                                type="color"
                                value={r.fillColor}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => patchRegion(r.id, { fillColor: e.target.value })}
                                className="size-6 rounded cursor-pointer border border-border bg-transparent"
                              />
                            </div>
                          )}
                          <p className="text-[9px] text-muted-foreground/50 font-mono">
                            x:{r.x} y:{r.y} · {r.w}×{r.h}px
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Legend */}
            <div className="rounded-2xl border border-border bg-card/40 p-4 space-y-2">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                دليل الألوان
              </h3>
              {(Object.keys(MODE_META) as RegionMode[]).map((m) => (
                <div key={m} className="flex items-center gap-2.5">
                  <div
                    className="size-3 rounded-sm shrink-0"
                    style={{ background: MODE_META[m].color }}
                  />
                  <span className="text-xs font-semibold">{MODE_META[m].label}</span>
                  <span className="text-[10px] text-muted-foreground">— {MODE_META[m].desc}</span>
                </div>
              ))}
            </div>

            {/* Run */}
            <button
              onClick={run}
              disabled={processing || !file || regions.length === 0}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-6 py-3.5 font-bold text-white hover:opacity-90 transition disabled:opacity-40 shadow-lg shadow-rose-500/20 text-sm"
            >
              {processing ? (
                <>
                  <Loader2 className="size-5 animate-spin" /> جاري المعالجة…
                </>
              ) : (
                <>
                  <Wand2 className="size-5" /> تطبيق الإزالة ({regions.length} منطقة)
                </>
              )}
            </button>

            {!file && (
              <p className="text-center text-xs text-muted-foreground">
                ارفع فيديو أولاً ثم ارسم المناطق
              </p>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
