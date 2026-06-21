import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState, useEffect, useCallback } from "react";
import { useLocalSettings } from "@/hooks/useLocalSettings";
import { fetchFile } from "@ffmpeg/util";
import { getFFmpeg, removeLogHandler, hasAudioByExt } from "@/lib/ffmpeg-client";
import {
  ArrowRight,
  Mic,
  Image as ImageIcon,
  User,
  Palette,
  Wand2,
  Upload,
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
  ChevronDown,
  ChevronUp,
  Trash2,
  Plus,
  Info,
  Cloud,
  Cpu,
} from "lucide-react";

export const Route = createFileRoute("/transform")({
  head: () => ({
    meta: [
      { title: "تحويل احترافي — Video Enhancer Pro" },
      {
        name: "description",
        content: "تغيير الصوت، الخلفية، تمويه الوجه، والتأثيرات البصرية — كل شيء في مسار واحد.",
      },
    ],
  }),
  component: TransformPage,
});

/* ─── Types ──────────────────────────────────────── */
type FaceMode = "blur" | "pixelate" | "cover";
type FaceRegion = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  mode: FaceMode;
  color: string;
  strength: number;
};

/* ─── Voice presets ──────────────────────────────── */
const VOICE_PRESETS = [
  {
    id: "feminine",
    label: "أنثوي",
    emoji: "🎀",
    af: "asetrate=44100*1.25,aresample=44100,atempo=0.8",
  },
  {
    id: "masculine",
    label: "رجولي",
    emoji: "🎙️",
    af: "asetrate=44100*0.82,aresample=44100,atempo=1.22",
  },
  { id: "robot", label: "ربوت", emoji: "🤖", af: "aecho=0.9:0.9:50:0.6,atremolo=10:0.7" },
  {
    id: "chipmunk",
    label: "سنجاب",
    emoji: "🐿️",
    af: "asetrate=44100*1.6,aresample=44100,atempo=0.625",
  },
  { id: "deep", label: "عميق", emoji: "🎸", af: "asetrate=44100*0.72,aresample=44100,atempo=1.39" },
  { id: "phone", label: "هاتف", emoji: "📞", af: "highpass=f=300,lowpass=f=3400,volume=1.5" },
  { id: "underwater", label: "تحت الماء", emoji: "🌊", af: "aecho=0.8:0.8:60:0.5,lowpass=f=800" },
  { id: "echo", label: "صدى جبل", emoji: "🏔️", af: "aecho=0.8:0.88:1000:0.5" },
] as const;

/* ─── Style presets ─────────────────────────────── */
const STYLE_PRESETS = [
  {
    id: "cinematic",
    label: "سينمائي",
    vf: "eq=contrast=1.2:saturation=0.85:gamma=1.1,vignette=PI/6",
  },
  {
    id: "vintage",
    label: "كلاسيكي",
    vf: "eq=contrast=0.9:saturation=0.65:brightness=0.04,vignette=PI/4",
  },
  { id: "warm", label: "دافئ", vf: "colorbalance=rs=0.1:gs=-0.02:bs=-0.1:rm=0.07:bm=-0.05" },
  { id: "cool", label: "بارد", vf: "colorbalance=bs=0.15:bm=0.1:bh=0.05,eq=saturation=1.1" },
  {
    id: "hdr",
    label: "HDR",
    vf: "eq=contrast=1.35:saturation=1.4:brightness=-0.02,unsharp=5:5:0.9",
  },
  { id: "bw", label: "أبيض وأسود", vf: "hue=s=0,eq=contrast=1.2:brightness=0.03" },
  { id: "vivid", label: "حيوي", vf: "eq=saturation=1.6:contrast=1.15,unsharp=3:3:0.4" },
  { id: "cartoon", label: "كرتون", vf: "unsharp=5:5:2.0:5:5:0.0,eq=saturation=1.8:contrast=1.3" },
] as const;

/* ─── Helpers ────────────────────────────────────── */
function uid() {
  return Math.random().toString(36).slice(2, 10);
}
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

const FACE_FILL: Record<FaceMode, string> = {
  blur: "rgba(14,165,233,0.45)",
  pixelate: "rgba(139,92,246,0.45)",
  cover: "rgba(245,158,11,0.45)",
};

/* ─── FFmpeg builder ─────────────────────────────── */
function buildArgs(opts: {
  vw: number;
  vh: number;
  voiceAf: string | null;
  bgEnabled: boolean;
  bgColor: string;
  bgSim: number;
  bgBlend: number;
  bgMode: "solid" | "image";
  bgSolid: string;
  bgHasImg: boolean;
  faceRegions: FaceRegion[];
  styleVf: string | null;
  hasAudio: boolean;
}): { preArgs: string[]; postArgs: string[]; outName: string; needsBgImage: boolean } {
  const outName = "tr_out.mp4";
  const {
    vw,
    vh,
    voiceAf,
    bgEnabled,
    bgColor,
    bgSim,
    bgBlend,
    bgMode,
    bgSolid,
    bgHasImg,
    faceRegions,
    styleVf,
    hasAudio,
  } = opts;

  const needsComplex =
    bgEnabled || faceRegions.some((r) => r.mode === "blur" || r.mode === "pixelate");
  const needsBgImage = bgEnabled && bgMode === "image" && bgHasImg;

  const audioOutArgs = hasAudio
    ? voiceAf
      ? ["-af", voiceAf, "-c:a", "aac", "-b:a", "128k"]
      : ["-c:a", "copy"]
    : ["-an"];

  if (!needsComplex) {
    const vfParts: string[] = [];

    if (bgEnabled) {
      vfParts.push(
        `colorkey=color=${bgColor.replace("#", "0x")}:similarity=${bgSim}:blend=${bgBlend}`,
      );
    }
    for (const r of faceRegions) {
      if (r.mode === "cover")
        vfParts.push(
          `drawbox=x=${r.x}:y=${r.y}:w=${r.w}:h=${r.h}:color=${r.color.replace("#", "0x")}@1:t=fill`,
        );
    }
    if (styleVf) vfParts.push(styleVf);

    return {
      preArgs: [],
      postArgs: [
        ...(vfParts.length ? ["-vf", vfParts.join(",")] : []),
        ...audioOutArgs,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "18",
        outName,
      ],
      outName,
      needsBgImage: false,
    };
  }

  let stream = "0:v";
  const parts: string[] = [];
  let n = 0;

  if (bgEnabled) {
    const keyStr = `colorkey=color=${bgColor.replace("#", "0x")}:similarity=${bgSim}:blend=${bgBlend}`;
    if (bgMode === "image" && bgHasImg) {
      parts.push(`[1:v]scale=${vw}:${vh}[bgsc]`);
      parts.push(`[${stream}]${keyStr}[keyed${n}]`);
      parts.push(`[bgsc][keyed${n}]overlay[bgd${n}]`);
    } else {
      const hexColor = bgSolid.replace("#", "");
      parts.push(`color=c=#${hexColor}:s=${vw}x${vh}:r=30[bgsolid${n}]`);
      parts.push(`[${stream}]${keyStr}[keyed${n}]`);
      parts.push(`[bgsolid${n}][keyed${n}]overlay[bgd${n}]`);
    }
    stream = `bgd${n}`;
    n++;
  }

  for (const r of faceRegions) {
    const out = `face${n}`;
    if (r.mode === "cover") {
      parts.push(
        `[${stream}]drawbox=x=${r.x}:y=${r.y}:w=${r.w}:h=${r.h}:color=${r.color.replace("#", "0x")}@1:t=fill[${out}]`,
      );
    } else if (r.mode === "blur") {
      const [mn, sp, bl] = [`mn${n}`, `sp${n}`, `bl${n}`];
      parts.push(`[${stream}]split=2[${mn}][${sp}]`);
      parts.push(`[${sp}]crop=${r.w}:${r.h}:${r.x}:${r.y},avgblur=${r.strength}[${bl}]`);
      parts.push(`[${mn}][${bl}]overlay=${r.x}:${r.y}[${out}]`);
    } else {
      const [mn, sp, bl] = [`mn${n}`, `sp${n}`, `bl${n}`];
      const ps = Math.max(3, Math.round(r.strength / 4));
      parts.push(`[${stream}]split=2[${mn}][${sp}]`);
      parts.push(
        `[${sp}]crop=${r.w}:${r.h}:${r.x}:${r.y},scale=iw/${ps}:-1:flags=neighbor,scale=${r.w}:${r.h}:flags=neighbor[${bl}]`,
      );
      parts.push(`[${mn}][${bl}]overlay=${r.x}:${r.y}[${out}]`);
    }
    stream = out;
    n++;
  }

  if (styleVf) {
    const out = `sty${n}`;
    parts.push(`[${stream}]${styleVf}[${out}]`);
    stream = out;
    n++;
  }

  const mapAudio = hasAudio ? ["-map", "0:a"] : [];

  return {
    preArgs: needsBgImage ? ["-i", "tr_bg.jpg"] : [],
    postArgs: [
      "-filter_complex",
      parts.join(";"),
      "-map",
      `[${stream}]`,
      ...mapAudio,
      ...audioOutArgs,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "18",
      outName,
    ],
    outName,
    needsBgImage,
  };
}

/* ─── Component ─────────────────────────────────── */
function TransformPage() {
  const [file, setFile] = useState<File | null>(null);
  const [videoMeta, setVideoMeta] = useState<{ w: number; h: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  /* Voice */
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voicePreset, setVoicePreset] = useLocalSettings<string>("vep-tr-voicePreset", "feminine");
  const [voiceOpen, setVoiceOpen] = useState(true);

  /* Background */
  const [bgEnabled, setBgEnabled] = useState(false);
  const [bgColor, setBgColor] = useLocalSettings<string>("vep-tr-bgColor", "#00ff00");
  const [bgSim, setBgSim] = useLocalSettings<number>("vep-tr-bgSim", 0.28);
  const [bgBlend, setBgBlend] = useLocalSettings<number>("vep-tr-bgBlend", 0.05);
  const [bgMode, setBgMode] = useLocalSettings<"solid" | "image">("vep-tr-bgMode", "solid");
  const [bgSolid, setBgSolid] = useLocalSettings<string>("vep-tr-bgSolid", "#1e293b");
  const [bgImageFile, setBgImageFile] = useState<File | null>(null);
  const [bgOpen, setBgOpen] = useState(false);

  /* Face regions */
  const [faceRegions, setFaceRegions] = useState<FaceRegion[]>([]);
  const [defaultFaceMode, setDefaultFaceMode] = useLocalSettings<FaceMode>("vep-tr-faceMode", "blur");
  const [defaultFaceStr, setDefaultFaceStr] = useLocalSettings<number>("vep-tr-faceStr", 18);
  const [defaultFaceColor, setDefaultFaceColor] = useLocalSettings<string>("vep-tr-faceColor", "#000000");
  const [selectedFaceId, setSelectedFaceId] = useState<string | null>(null);
  const [faceOpen, setFaceOpen] = useState(false);

  /* Style */
  const [styleEnabled, setStyleEnabled] = useState(false);
  const [stylePreset, setStylePreset] = useLocalSettings<string>("vep-tr-stylePreset", "cinematic");
  const [styleOpen, setStyleOpen] = useState(false);

  /* Processing */
  const [processMode, setProcessMode] = useLocalSettings<"local" | "cloud">("vep-tr-processMode", "local");
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ffLog, setFfLog] = useState("");
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [outputName, setOutputName] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);

  /* Canvas */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hiddenVidRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<ImageBitmap | null>(null);
  const fileUrlRef = useRef<string | null>(null);
  const drawStart = useRef<{ x: number; y: number } | null>(null);
  const curRect = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bgImgRef = useRef<HTMLInputElement>(null);

  function toast_(msg: string, type: "ok" | "err") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  }

  const paint = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv || !videoMeta) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (frameRef.current) ctx.drawImage(frameRef.current, 0, 0, cv.width, cv.height);
    else {
      ctx.fillStyle = "#0f0f1a";
      ctx.fillRect(0, 0, cv.width, cv.height);
    }

    const sx = cv.width / videoMeta.w;
    const sy = cv.height / videoMeta.h;

    for (const r of faceRegions) {
      const [dx, dy, dw, dh] = [r.x * sx, r.y * sy, r.w * sx, r.h * sy];
      ctx.fillStyle = FACE_FILL[r.mode];
      ctx.fillRect(dx, dy, dw, dh);
      ctx.strokeStyle =
        r.id === selectedFaceId
          ? "#fff"
          : r.mode === "blur"
            ? "#0ea5e9"
            : r.mode === "pixelate"
              ? "#8b5cf6"
              : "#f59e0b";
      ctx.lineWidth = r.id === selectedFaceId ? 2 : 1.5;
      if (r.id === selectedFaceId) ctx.setLineDash([5, 3]);
      ctx.strokeRect(dx, dy, dw, dh);
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.font = "bold 11px sans-serif";
      ctx.fillText(
        r.mode === "blur" ? "تمويه" : r.mode === "pixelate" ? "تكسير" : "تغطية",
        dx + 4,
        dy + 14,
      );
    }

    if (curRect.current) {
      const r = curRect.current;
      ctx.fillStyle = FACE_FILL[defaultFaceMode];
      ctx.fillRect(r.x * sx, r.y * sy, r.w * sx, r.h * sy);
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x * sx, r.y * sy, r.w * sx, r.h * sy);
    }
  }, [faceRegions, selectedFaceId, videoMeta, defaultFaceMode]);

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
    setFaceRegions([]);
    setSelectedFaceId(null);
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
    if (!videoMeta || !faceOpen) return;
    const rect = e.currentTarget.getBoundingClientRect();
    drawStart.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    curRect.current = { x: 0, y: 0, w: 0, h: 0 };
    setSelectedFaceId(null);
  }

  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drawStart.current || !videoMeta) return;
    const s = scales();
    if (!s) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    curRect.current = {
      x: clamp(Math.round(Math.min(drawStart.current.x, cx) * s.sx), 0, videoMeta.w - 2),
      y: clamp(Math.round(Math.min(drawStart.current.y, cy) * s.sy), 0, videoMeta.h - 2),
      w: clamp(Math.round(Math.abs(cx - drawStart.current.x) * s.sx), 2, videoMeta.w),
      h: clamp(Math.round(Math.abs(cy - drawStart.current.y) * s.sy), 2, videoMeta.h),
    };
    paint();
  }

  function onUp() {
    if (!drawStart.current || !curRect.current) return;
    const r = curRect.current;
    if (r.w > 6 && r.h > 6) {
      const region: FaceRegion = {
        id: uid(),
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h,
        mode: defaultFaceMode,
        strength: defaultFaceStr,
        color: defaultFaceColor,
      };
      setFaceRegions((p) => [...p, region]);
      setSelectedFaceId(region.id);
    }
    drawStart.current = null;
    curRect.current = null;
    paint();
  }

  function patchFace(id: string, patch: Partial<FaceRegion>) {
    setFaceRegions((p) => p.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  const hasAnyEffect = voiceEnabled || bgEnabled || faceRegions.length > 0 || styleEnabled;

  async function run() {
    if (!file) {
      toast_("ارفع فيديو أولاً", "err");
      return;
    }
    if (!hasAnyEffect) {
      toast_("فعّل تأثيراً واحداً على الأقل", "err");
      return;
    }
    if (!videoMeta) return;
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
      const inName = `tr_in.${ext}`;
      await ffmpeg.writeFile(inName, await fetchFile(file));
      const hasAudio = hasAudioByExt(inName);

      const voiceAf = voiceEnabled
        ? (VOICE_PRESETS.find((p) => p.id === voicePreset)?.af ?? null)
        : null;
      const styleVf = styleEnabled
        ? (STYLE_PRESETS.find((p) => p.id === stylePreset)?.vf ?? null)
        : null;

      const { preArgs, postArgs, outName, needsBgImage } = buildArgs({
        vw: videoMeta.w,
        vh: videoMeta.h,
        voiceAf,
        bgEnabled,
        bgColor,
        bgSim,
        bgBlend,
        bgMode,
        bgSolid,
        bgHasImg: !!bgImageFile,
        faceRegions,
        styleVf,
        hasAudio,
      });

      if (needsBgImage && bgImageFile) {
        await ffmpeg.writeFile("tr_bg.jpg", await fetchFile(bgImageFile));
      }

      if (processMode === "cloud" && !needsBgImage) {
        setProgress(20);
        const cloudArgs = ["-i", inName, ...preArgs, ...postArgs];
        const fd = new FormData();
        fd.append("file", file, inName);
        fd.append("args", JSON.stringify(cloudArgs));
        fd.append("outputName", outName);
        const cloudRes = await fetch("/api/cloud-exec", { method: "POST", body: fd });
        if (!cloudRes.ok) throw new Error("خطأ سحابي: " + (await cloudRes.text()).slice(0, 200));
        const resBlob = await cloudRes.blob();
        setProgress(100);
        setOutputUrl(URL.createObjectURL(new Blob([await resBlob.arrayBuffer()], { type: "video/mp4" })));
        setOutputName(`${file.name.replace(/\.[^.]+$/, "")}_transformed.mp4`);
        toast_("اكتملت التحويلات السحابية! ☁", "ok");
      } else {
        if (processMode === "cloud" && needsBgImage) {
          toast_("⚠ الخلفية المخصصة تتطلب الوضع المحلي — تم التبديل تلقائياً", "ok");
        }
        await ffmpeg.exec(["-i", inName, ...preArgs, ...postArgs]);
        const data = (await ffmpeg.readFile(outName)) as Uint8Array;
        const blob = new Blob([data.buffer as ArrayBuffer], { type: "video/mp4" });
        setOutputUrl(URL.createObjectURL(blob));
        setOutputName(`${file.name.replace(/\.[^.]+$/, "")}_transformed.mp4`);
        toast_("اكتملت التحويلات بنجاح!", "ok");
      }

      await Promise.all([
        ffmpeg.deleteFile(inName).catch(() => {}),
        ffmpeg.deleteFile(outName).catch(() => {}),
        needsBgImage ? ffmpeg.deleteFile("tr_bg.jpg").catch(() => {}) : Promise.resolve(),
      ]);
    } catch (e) {
      toast_(e instanceof Error ? e.message.slice(0, 120) : "حدث خطأ", "err");
    } finally {
      removeLogHandler(handler);
      setProcessing(false);
      setProgress(0);
      setFfLog("");
    }
  }

  const sectionHeader = (
    label: string,
    icon: React.ReactNode,
    open: boolean,
    setOpen: (v: boolean) => void,
    enabled: boolean,
    onToggle: (() => void) | null,
  ) => (
    <button
      onClick={() => setOpen(!open)}
      className={`w-full flex items-center justify-between px-4 py-3 text-sm font-bold hover:bg-secondary/40 transition ${enabled ? "text-foreground" : "text-muted-foreground"}`}
    >
      <div className="flex items-center gap-2">
        {onToggle && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className={`size-5 rounded flex items-center justify-center border-2 transition ${enabled ? "bg-primary border-primary text-white" : "border-muted-foreground/40"}`}
          >
            {enabled && <CheckCircle2 className="size-3" />}
          </div>
        )}
        {icon}
        {label}
        {enabled && <span className="size-2 rounded-full bg-emerald-400" />}
      </div>
      {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
    </button>
  );

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
          <div className="p-1.5 rounded-lg bg-fuchsia-500/15">
            <Wand2 className="size-4 text-fuchsia-400" />
          </div>
          تحويل احترافي
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
              className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold transition ${processMode === "local" ? "bg-fuchsia-500/15 text-fuchsia-400" : "text-muted-foreground hover:text-foreground"}`}>
              <Cpu className="size-3" /> محلي (WASM)
            </button>
            <button onClick={() => setProcessMode("cloud")}
              className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold transition ${processMode === "cloud" ? "bg-sky-500/15 text-sky-400" : "text-muted-foreground hover:text-foreground"}`}>
              <Cloud className="size-3" /> سحابي ☁
            </button>
          </div>
          <span className="text-[10px] text-muted-foreground">
            {processMode === "cloud" ? "معالجة على السيرفر — أسرع للملفات الكبيرة (الخلفية المخصصة تتطلب المحلي)" : "معالجة في المتصفح — خصوصية تامة"}
          </span>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          {/* ── LEFT: Video + Canvas ── */}
          <section className="space-y-4">
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
                className={`flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-16 cursor-pointer transition ${dragOver ? "border-fuchsia-400 bg-fuchsia-500/10" : "border-border hover:border-fuchsia-500/50 hover:bg-fuchsia-500/5"}`}
              >
                <div className="rounded-2xl bg-fuchsia-500/10 p-5">
                  <Upload className="size-10 text-fuchsia-400" />
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
                    <span className="text-xs text-muted-foreground">
                      {file.name} · {videoMeta.w}×{videoMeta.h}px
                    </span>
                    <button
                      onClick={() => {
                        setFile(null);
                        setFaceRegions([]);
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
                  <div className="relative rounded-2xl overflow-hidden border border-border bg-black select-none">
                    <canvas
                      ref={canvasRef}
                      width={800}
                      height={Math.round(800 * (videoMeta.h / videoMeta.w))}
                      className={`w-full block ${faceOpen ? "cursor-crosshair" : "cursor-default"}`}
                      onMouseDown={onDown}
                      onMouseMove={onMove}
                      onMouseUp={onUp}
                      onMouseLeave={onUp}
                    />
                    {faceOpen && faceRegions.length === 0 && (
                      <div className="absolute inset-0 flex items-end justify-center pb-4 pointer-events-none">
                        <span className="rounded-xl bg-black/60 backdrop-blur-sm px-3 py-1.5 text-xs text-white/60">
                          اسحب لرسم منطقة فوق الوجه أو الملابس أو أي عنصر
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
              aria-label="اختر فيديو"
              title="اختر فيديو"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) loadFile(f);
                e.target.value = "";
              }}
            />
            <input
              ref={bgImgRef}
              type="file"
              accept="image/*"
              aria-label="اختر صورة خلفية"
              title="اختر صورة خلفية"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setBgImageFile(f);
                e.target.value = "";
              }}
            />

            {processing && (
              <div className="rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/8 px-4 py-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin text-fuchsia-400" />
                    <span className="text-fuchsia-300 font-medium">جاري تطبيق التحويلات…</span>
                  </div>
                  <span className="font-mono text-fuchsia-400 font-bold">{progress}%</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <progress
                    value={progress}
                    max={100}
                    className="h-1.5 w-full appearance-none rounded-full bg-muted"
                    title={`${progress}%`}
                  >
                    <span className="sr-only">{`${progress}%`}</span>
                  </progress>
                </div>
                {ffLog && (
                  <p className="text-[10px] text-muted-foreground/60 font-mono line-clamp-2 break-all">
                    {ffLog}
                  </p>
                )}
              </div>
            )}

            {outputUrl && outputName && (
              <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-4 py-3">
                <CheckCircle2 className="size-5 text-emerald-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-emerald-300">اكتملت كل التحويلات</p>
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

            {/* Active effects summary */}
            {hasAnyEffect && (
              <div className="flex flex-wrap gap-2 px-1">
                {voiceEnabled && (
                  <Chip
                    color="violet"
                    label={`🎙️ ${VOICE_PRESETS.find((p) => p.id === voicePreset)?.label ?? ""}`}
                  />
                )}
                {bgEnabled && <Chip color="sky" label="🖼️ تغيير الخلفية" />}
                {faceRegions.length > 0 && (
                  <Chip color="pink" label={`👤 ${faceRegions.length} منطقة وجه`} />
                )}
                {styleEnabled && (
                  <Chip
                    color="amber"
                    label={`🎨 ${STYLE_PRESETS.find((p) => p.id === stylePreset)?.label ?? ""}`}
                  />
                )}
              </div>
            )}
          </section>

          {/* ── RIGHT: Controls ── */}
          <aside className="space-y-3">
            {/* ① Voice */}
            <div className="rounded-2xl border border-border bg-card/60 overflow-hidden">
              {sectionHeader(
                "تغيير الصوت",
                <Mic className="size-4" />,
                voiceOpen,
                setVoiceOpen,
                voiceEnabled,
                () => setVoiceEnabled((e) => !e),
              )}
              {voiceOpen && (
                <div className="border-t border-border/50 p-4 space-y-3">
                  <div className="grid grid-cols-4 gap-1.5">
                    {VOICE_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setVoicePreset(p.id);
                          setVoiceEnabled(true);
                        }}
                        className={`flex flex-col items-center gap-1 rounded-xl py-2.5 px-1 text-center transition ${voicePreset === p.id && voiceEnabled ? "bg-violet-600 text-white" : "bg-background/60 border border-border hover:bg-secondary text-muted-foreground hover:text-foreground"}`}
                      >
                        <span className="text-lg leading-none">{p.emoji}</span>
                        <span className="text-[10px] font-semibold leading-tight">{p.label}</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                    يُعيد تشكيل الصوت بالكامل. تأكد أن الفيديو يحتوي على مسار صوتي.
                  </p>
                </div>
              )}
            </div>

            {/* ② Background */}
            <div className="rounded-2xl border border-border bg-card/60 overflow-hidden">
              {sectionHeader(
                "تغيير الخلفية",
                <ImageIcon className="size-4" />,
                bgOpen,
                setBgOpen,
                bgEnabled,
                () => setBgEnabled((e) => !e),
              )}
              {bgOpen && (
                <div className="border-t border-border/50 p-4 space-y-3">
                  <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-2.5">
                    <p className="text-[10px] text-amber-300 leading-relaxed">
                      <strong>يتطلب خلفية ذات لون موحّد</strong> (خضراء، زرقاء، إلخ). فعّل الأداة ثم
                      اختر لون الخلفية الحالية وستُستبدل تلقائياً.
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">
                      لون الخلفية الحالية (Chroma Key)
                    </p>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={bgColor || "#00ff00"}
                        onChange={(e) => setBgColor(e.target.value)}
                        aria-label="اختر لون الخلفية الحالية"
                        title="اختر لون الخلفية الحالية"
                        className="size-10 rounded-lg cursor-pointer border border-border bg-transparent"
                      />
                      <div className="flex gap-1.5">
                        {["#00ff00", "#0000ff", "#ff0000", "#ffffff"].map((c) => (
                          <button
                            key={c}
                            onClick={() => setBgColor(c)}
                            aria-label={`اختيار لون ${c}`}
                            title={c}
                            className={`size-6 rounded border border-border/40 transition hover:scale-110 ${c === "#00ff00" ? "bg-lime-500" : c === "#0000ff" ? "bg-blue-500" : c === "#ff0000" ? "bg-red-500" : "bg-white"}`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">دقة التمييز</span>
                      <span className="font-mono">{bgSim.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={0.05}
                      max={0.6}
                      step={0.01}
                      value={bgSim}
                      aria-label="نسبة تشابه الخلفية"
                      onChange={(e) => setBgSim(+e.target.value)}
                      className="w-full accent-sky-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">نعومة الحواف</span>
                      <span className="font-mono">{bgBlend.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={0.3}
                      step={0.01}
                      value={bgBlend}
                      aria-label="نعومة حواف الخلفية"
                      onChange={(e) => setBgBlend(+e.target.value)}
                      className="w-full accent-sky-500"
                    />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">استبدال الخلفية بـ</p>
                    <div className="flex gap-2 mb-2">
                      {(["solid", "image"] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() => setBgMode(m)}
                          className={`flex-1 py-2 rounded-lg text-xs font-semibold transition ${bgMode === m ? "bg-sky-600 text-white" : "bg-background border border-border text-muted-foreground hover:bg-secondary"}`}
                        >
                          {m === "solid" ? "🎨 لون صلب" : "🖼️ صورة"}
                        </button>
                      ))}
                    </div>
                    {bgMode === "solid" && (
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={bgSolid || "#000000"}
                          onChange={(e) => setBgSolid(e.target.value)}
                          aria-label="اختر لون الخلفية الصلبة"
                          className="size-9 rounded-lg cursor-pointer border border-border bg-transparent"
                        />
                        <div className="flex gap-1.5">
                          {["#1e293b", "#ffffff", "#000000", "#0ea5e9"].map((c) => (
                            <button
                              key={c}
                              onClick={() => setBgSolid(c)}
                              aria-label={`اختيار لون ${c}`}
                              title={c}
                              className={`size-6 rounded border border-border/40 hover:scale-110 transition ${c === "#1e293b" ? "bg-slate-950" : c === "#ffffff" ? "bg-white" : c === "#000000" ? "bg-black" : "bg-sky-500"}`}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                    {bgMode === "image" && (
                      <button
                        onClick={() => bgImgRef.current?.click()}
                        className="w-full rounded-xl border-2 border-dashed border-border py-3 text-xs text-muted-foreground hover:border-sky-500/50 hover:text-sky-400 transition"
                      >
                        {bgImageFile ? `✓ ${bgImageFile.name}` : "+ اختر صورة للخلفية"}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ③ Face / Region privacy */}
            <div className="rounded-2xl border border-border bg-card/60 overflow-hidden">
              {sectionHeader(
                "تمويه الوجه والعناصر",
                <User className="size-4" />,
                faceOpen,
                setFaceOpen,
                faceRegions.length > 0,
                null,
              )}
              {faceOpen && (
                <div className="border-t border-border/50 p-4 space-y-3">
                  <div className="rounded-lg bg-sky-500/8 border border-sky-500/25 px-3 py-2">
                    <p className="text-[10px] text-sky-300">
                      <Info className="size-3 inline ml-1" />
                      ارسم مستطيلاً على الفيديو فوق أي عنصر (وجه، نص، ملابس، لوحة، إلخ). يمكن رسم
                      مناطق متعددة.
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">طريقة التأثير الافتراضية</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(["blur", "pixelate", "cover"] as FaceMode[]).map((m) => {
                        const labels = { blur: "تمويه", pixelate: "تكسير", cover: "تغطية" };
                        const colors = {
                          blur: "bg-sky-600",
                          pixelate: "bg-violet-600",
                          cover: "bg-amber-600",
                        };
                        return (
                          <button
                            key={m}
                            onClick={() => setDefaultFaceMode(m)}
                            className={`rounded-xl py-2 text-xs font-semibold transition ${defaultFaceMode === m ? `${colors[m]} text-white` : "bg-background border border-border text-muted-foreground hover:bg-secondary"}`}
                          >
                            {labels[m]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {defaultFaceMode !== "cover" && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">
                          {defaultFaceMode === "blur" ? "شدة التمويه" : "حجم البكسل"}
                        </span>
                        <span className="font-mono">{defaultFaceStr}</span>
                      </div>
                      <input
                        type="range"
                        min={5}
                        max={40}
                        step={1}
                        value={defaultFaceStr}
                        aria-label={defaultFaceMode === "blur" ? "شدة التمويه" : "حجم البكسل"}
                        onChange={(e) => setDefaultFaceStr(+e.target.value)}
                        className={`w-full ${defaultFaceMode === "blur" ? "accent-sky-500" : "accent-violet-500"}`}
                      />
                    </div>
                  )}
                  {defaultFaceMode === "cover" && (
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">لون التغطية</span>
                      <input
                        type="color"
                        value={defaultFaceColor || "#000000"}
                        onChange={(e) => setDefaultFaceColor(e.target.value)}
                        aria-label="اختر لون التغطية"
                        className="size-8 rounded cursor-pointer border border-border bg-transparent"
                      />
                      <div className="flex gap-1.5">
                        {["#000000", "#ffffff", "#1e293b", "#dc2626"].map((c) => (
                          <button
                            key={c}
                            onClick={() => setDefaultFaceColor(c)}
                            aria-label={`اختيار لون ${c}`}
                            title={c}
                            className={`size-5 rounded border border-border/40 hover:scale-110 transition ${c === "#000000" ? "bg-black" : c === "#ffffff" ? "bg-white" : c === "#1e293b" ? "bg-slate-950" : "bg-red-600"}`}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {faceRegions.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold">
                          {faceRegions.length} منطقة مرسومة
                        </span>
                        <button
                          onClick={() => {
                            setFaceRegions([]);
                            setSelectedFaceId(null);
                          }}
                          aria-label="حذف كل المناطق"
                          title="حذف كل المناطق"
                          className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1 transition"
                        >
                          <Trash2 className="size-3" /> حذف الكل
                        </button>
                      </div>
                      <div className="space-y-1 max-h-44 overflow-y-auto">
                        {faceRegions.map((r, i) => (
                          <div
                            key={r.id}
                            onClick={() => setSelectedFaceId(r.id === selectedFaceId ? null : r.id)}
                            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs cursor-pointer transition ${r.id === selectedFaceId ? "bg-secondary/60 border border-border" : "bg-background/40 border border-transparent hover:bg-secondary/30"}`}
                          >
                            <div
                              className={`size-2.5 rounded-sm shrink-0 ${r.mode === "blur" ? "bg-sky-500" : r.mode === "pixelate" ? "bg-violet-500" : "bg-amber-500"}`}
                            />
                            <span className="flex-1">
                              منطقة {i + 1} · {r.w}×{r.h}px
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setFaceRegions((p) => p.filter((x) => x.id !== r.id));
                                if (selectedFaceId === r.id) setSelectedFaceId(null);
                              }}
                              aria-label="حذف المنطقة"
                              title="حذف المنطقة"
                              className="text-muted-foreground hover:text-destructive transition"
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ④ Style */}
            <div className="rounded-2xl border border-border bg-card/60 overflow-hidden">
              {sectionHeader(
                "التأثيرات البصرية والأسلوب",
                <Palette className="size-4" />,
                styleOpen,
                setStyleOpen,
                styleEnabled,
                () => setStyleEnabled((e) => !e),
              )}
              {styleOpen && (
                <div className="border-t border-border/50 p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-1.5">
                    {STYLE_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setStylePreset(p.id);
                          setStyleEnabled(true);
                        }}
                        className={`rounded-xl py-2.5 px-3 text-xs font-semibold transition ${stylePreset === p.id && styleEnabled ? "bg-fuchsia-600 text-white" : "bg-background/60 border border-border hover:bg-secondary text-muted-foreground hover:text-foreground"}`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Apply button */}
            <button
              onClick={run}
              disabled={processing || !file || !hasAnyEffect}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-fuchsia-600 px-6 py-4 font-bold text-white hover:opacity-90 transition disabled:opacity-40 shadow-lg shadow-fuchsia-500/25 text-sm"
            >
              {processing ? (
                <>
                  <Loader2 className="size-5 animate-spin" /> جاري التطبيق…
                </>
              ) : (
                <>
                  <Wand2 className="size-5" /> تطبيق كل التحويلات
                </>
              )}
            </button>

            {!file && <p className="text-center text-xs text-muted-foreground">ارفع فيديو أولاً</p>}
            {file && !hasAnyEffect && (
              <p className="text-center text-xs text-muted-foreground">
                فعّل تأثيراً واحداً على الأقل
              </p>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}

function Chip({ color, label }: { color: string; label: string }) {
  const cls: Record<string, string> = {
    violet: "bg-violet-500/15 text-violet-300 border-violet-500/30",
    sky: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    pink: "bg-pink-500/15 text-pink-300 border-pink-500/30",
    amber: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${cls[color] ?? cls.violet}`}
    >
      {label}
    </span>
  );
}
