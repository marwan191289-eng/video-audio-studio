import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState, useCallback, useEffect } from "react";
import { fetchFile } from "@ffmpeg/util";
import { getFFmpeg, removeLogHandler, hasAudioByExt } from "@/lib/ffmpeg-client";
import { saveVideo } from "@/lib/api/library.functions";
import {
  ArrowRight, Upload, Wand2, Download, Save, Loader2, RotateCcw,
  Scissors, Zap, Volume2, VolumeX, Film, RefreshCw, Type, Palette,
  Layers, Merge, Image, Play, ChevronRight, CheckCircle2, AlertCircle,
  Settings2, Sparkles, X, Star, Check,
} from "lucide-react";

export const Route = createFileRoute("/enhance")({
  head: () => ({
    meta: [
      { title: "محرر الفيديو — Video Enhancer Pro" },
      { name: "description", content: "محرر فيديو احترافي شامل بمستوى CapCut" },
    ],
  }),
  component: EnhancePage,
});

type Mode =
  | "auto-enhance" | "enhance" | "denoise" | "speed" | "trim" | "crop" | "rotate"
  | "reverse" | "extract-audio" | "remove-audio" | "compress"
  | "upscale" | "fps" | "gif" | "thumbnail" | "text-overlay"
  | "color-grade" | "logo-overlay" | "concat" | "stabilize";

const MODES: { value: Mode; label: string; icon: React.ElementType; color: string; group: string }[] = [
  { value: "auto-enhance",  label: "تحسين تلقائي ✦",    icon: Star,      color: "amber",   group: "أساسي" },
  { value: "enhance",       label: "تحسين الجودة",       icon: Wand2,     color: "violet",  group: "أساسي" },
  { value: "color-grade",   label: "تصحيح الألوان",      icon: Palette,   color: "pink",    group: "أساسي" },
  { value: "text-overlay",  label: "نص على الفيديو",     icon: Type,      color: "sky",     group: "أساسي" },
  { value: "logo-overlay",  label: "إضافة شعار/صورة",   icon: Image,     color: "emerald", group: "أساسي" },
  { value: "denoise",       label: "إزالة الضوضاء",      icon: Sparkles,  color: "blue",    group: "جودة" },
  { value: "compress",      label: "ضغط الفيديو",        icon: Layers,    color: "orange",  group: "جودة" },
  { value: "upscale",       label: "ترقية الدقة",         icon: Zap,       color: "yellow",  group: "جودة" },
  { value: "fps",           label: "تغيير FPS",           icon: Film,      color: "teal",    group: "جودة" },
  { value: "trim",          label: "قص مقطع",             icon: Scissors,  color: "red",     group: "تحرير" },
  { value: "speed",         label: "تغيير السرعة",        icon: Play,      color: "green",   group: "تحرير" },
  { value: "crop",          label: "اقتصاص",              icon: Film,      color: "purple",  group: "تحرير" },
  { value: "rotate",        label: "تدوير / قلب",         icon: RotateCcw, color: "indigo",  group: "تحرير" },
  { value: "reverse",       label: "عكس الفيديو",         icon: RefreshCw, color: "rose",    group: "تحرير" },
  { value: "concat",        label: "دمج فيديوهات",        icon: Merge,     color: "amber",   group: "تحرير" },
  { value: "extract-audio", label: "استخراج الصوت",       icon: Volume2,   color: "lime",    group: "صوت" },
  { value: "remove-audio",  label: "إزالة الصوت",         icon: VolumeX,   color: "gray",    group: "صوت" },
  { value: "gif",           label: "تحويل إلى GIF",       icon: Sparkles,  color: "fuchsia", group: "تحويل" },
  { value: "thumbnail",     label: "التقاط صورة",          icon: Image,     color: "cyan",    group: "تحويل" },
];

const COLOR_PRESETS = [
  { id: "none",      label: "بدون",      filter: "" },
  { id: "vivid",     label: "حيوي",      filter: "eq=contrast=1.2:saturation=1.5:brightness=0.05" },
  { id: "cinema",    label: "سينمائي",   filter: "eq=contrast=1.15:saturation=0.85:gamma=1.1,curves=r='0/0 0.5/0.45 1/0.9':g='0/0 0.5/0.5 1/1':b='0/0.05 0.5/0.5 1/1'" },
  { id: "warm",      label: "دافئ",      filter: "eq=contrast=1.05:saturation=1.3,colortemperature=warmth=0.3" },
  { id: "cool",      label: "بارد",      filter: "eq=contrast=1.05:saturation=1.1,hue=h=10:s=0.9" },
  { id: "vintage",   label: "كلاسيكي",   filter: "eq=contrast=0.9:saturation=0.7:brightness=0.05,curves=r='0/0.05 1/0.9':g='0/0.02 1/0.88':b='0/0.06 1/0.82'" },
  { id: "bw",        label: "أبيض وأسود", filter: "hue=s=0,eq=contrast=1.1" },
  { id: "dramatic",  label: "درامي",     filter: "eq=contrast=1.4:saturation=0.8:gamma=0.9,vignette=PI/4" },
  { id: "soft",      label: "ناعم",      filter: "eq=contrast=0.95:saturation=1.1:brightness=0.03,unsharp=3:3:0.5" },
  { id: "neon",      label: "نيون",      filter: "eq=contrast=1.3:saturation=2:brightness=-0.05" },
];

const TEXT_POSITIONS = [
  { id: "top-center",    label: "أعلى وسط",     x: "(w-text_w)/2", y: "h*0.05" },
  { id: "bottom-center", label: "أسفل وسط",     x: "(w-text_w)/2", y: "h*0.88" },
  { id: "center",        label: "مركز",          x: "(w-text_w)/2", y: "(h-text_h)/2" },
  { id: "top-right",     label: "أعلى يمين",    x: "w-text_w-20",  y: "h*0.05" },
  { id: "bottom-right",  label: "أسفل يمين",    x: "w-text_w-20",  y: "h*0.88" },
  { id: "top-left",      label: "أعلى يسار",    x: "20",           y: "h*0.05" },
  { id: "bottom-left",   label: "أسفل يسار",    x: "20",           y: "h*0.88" },
];

type VideoMeta = {
  duration: number;
  width: number;
  height: number;
  bitrate: number;
  container: string;
};

function fmtDuration(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function containerLabel(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    mp4: "MP4", mov: "MOV", avi: "AVI", mkv: "MKV",
    webm: "WebM", flv: "FLV", wmv: "WMV", m4v: "M4V",
    ts: "MPEG-TS", ogv: "OGV",
  };
  return map[ext] ?? ext.toUpperCase();
}

function EnhancePage() {
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [extraFiles, setExtraFiles] = useState<File[]>([]);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null);
  const [outputName, setOutputName] = useState("output.mp4");
  const [mode, setMode] = useState<Mode>("enhance");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingFFmpeg, setLoadingFFmpeg] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Auto-enhance
  const [autoLevel, setAutoLevel] = useState<"light" | "balanced" | "strong">("balanced");

  useEffect(() => {
    if (!file) { setMeta(null); return; }
    const url = URL.createObjectURL(file);
    const vid = document.createElement("video");
    vid.preload = "metadata";
    vid.src = url;
    vid.onloadedmetadata = () => {
      const dur = vid.duration;
      const bitrate = dur > 0 ? Math.round((file.size * 8) / dur / 1000) : 0;
      setMeta({
        duration: dur,
        width: vid.videoWidth,
        height: vid.videoHeight,
        bitrate,
        container: containerLabel(file.name),
      });
      if (isFinite(dur) && dur > 0) setTrimEnd(Math.floor(dur));
      URL.revokeObjectURL(url);
    };
    vid.onerror = () => { URL.revokeObjectURL(url); };
    return () => { URL.revokeObjectURL(url); };
  }, [file]);

  // Enhance
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(1);
  const [saturation, setSaturation] = useState(1);
  const [sharpness, setSharpness] = useState(0);
  const [gamma, setGamma] = useState(1);
  const [denoiseFilter, setDenoiseFilter] = useState<"none" | "hqdn3d" | "nlmeans">("none");

  // Denoise
  const [denoiseStrength, setDenoiseStrength] = useState<"light" | "medium" | "strong">("medium");

  // Color grade
  const [colorPreset, setColorPreset] = useState("none");
  const [brightness2, setBrightness2] = useState(0);
  const [contrast2, setContrast2] = useState(1);
  const [saturation2, setSaturation2] = useState(1);
  const [gamma2, setGamma2] = useState(1);

  // Text overlay
  const [textContent, setTextContent] = useState("نص على الفيديو");
  const [textSize, setTextSize] = useState(48);
  const [textColor, setTextColor] = useState("white");
  const [textBg, setTextBg] = useState(true);
  const [textPosition, setTextPosition] = useState("bottom-center");
  const [textBold, setTextBold] = useState(true);
  const [textStartTime, setTextStartTime] = useState(0);
  const [textEndTime, setTextEndTime] = useState(5);
  const [textAlwaysShow, setTextAlwaysShow] = useState(true);

  // Logo overlay
  const [logoPosition, setLogoPosition] = useState<"top-right" | "top-left" | "bottom-right" | "bottom-left" | "center">("bottom-right");
  const [logoScale, setLogoScale] = useState(15);
  const [logoOpacity, setLogoOpacity] = useState(0.9);

  // Speed
  const [speed, setSpeed] = useState(1);

  // Trim
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(10);

  // Crop
  const [cropW, setCropW] = useState(1280);
  const [cropH, setCropH] = useState(720);
  const [cropX, setCropX] = useState(0);
  const [cropY, setCropY] = useState(0);

  // Rotate
  const [rotateDir, setRotateDir] = useState<"90cw" | "90ccw" | "180" | "fliph" | "flipv">("90cw");

  // Compress
  const [crf, setCrf] = useState(23);

  // Upscale
  const [upscaleRes, setUpscaleRes] = useState<"1920x1080" | "1280x720" | "3840x2160">("1920x1080");

  // FPS
  const [targetFps, setTargetFps] = useState(30);

  // GIF
  const [gifFps, setGifFps] = useState(10);
  const [gifWidth, setGifWidth] = useState(480);

  // Thumbnail
  const [thumbAt, setThumbAt] = useState(2);

  const inputRef = useRef<HTMLInputElement>(null);
  const extraRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);

  const appendLog = useCallback((m: string) => setLog((p) => (p + "\n" + m).slice(-8000)), []);

  function showToast(msg: string, type: "ok" | "err") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith("video/")) {
      setFile(f);
      setOutputUrl(null);
      setOutputBlob(null);
    }
  }

  async function onProcess() {
    if (!file) return;
    setBusy(true);
    setLoadingFFmpeg(true);
    setProgress(0);
    setOutputUrl(null);
    setOutputBlob(null);
    setLog("");
    const logHandler = (m: string) => appendLog(m);

    try {
      const ffmpeg = await getFFmpeg(logHandler);
      setLoadingFFmpeg(false);

      let lastProg = 0;
      ffmpeg.on("progress", ({ progress: p }) => {
        const val = Math.max(lastProg, Math.round(p * 100));
        lastProg = val;
        setProgress(val);
      });

      const ext = file.name.split(".").pop()?.toLowerCase() || "mp4";
      const inputName = `input.${ext}`;
      await ffmpeg.writeFile(inputName, await fetchFile(file));

      const hasAudio = hasAudioByExt(inputName);
      let outName = "output.mp4";
      let args: string[] = [];

      if (mode === "enhance") {
        const vf: string[] = [];
        vf.push(`eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}:gamma=${gamma}`);
        if (sharpness > 0) vf.push(`unsharp=5:5:${sharpness.toFixed(2)}`);
        if (denoiseFilter === "hqdn3d") vf.push("hqdn3d=4:3:6:4.5");
        if (denoiseFilter === "nlmeans") vf.push("nlmeans=10:7:5:3:3");
        args = ["-i", inputName, "-vf", vf.join(","),
          ...(hasAudio ? ["-c:a", "copy"] : []),
          "-c:v", "libx264", "-preset", "ultrafast", outName];

      } else if (mode === "color-grade") {
        const preset = COLOR_PRESETS.find(p => p.id === colorPreset);
        const customFilter = `eq=brightness=${brightness2}:contrast=${contrast2}:saturation=${saturation2}:gamma=${gamma2}`;
        const filters: string[] = [];
        if (preset && preset.filter) filters.push(preset.filter);
        else filters.push(customFilter);
        args = ["-i", inputName, "-vf", filters.join(","),
          ...(hasAudio ? ["-c:a", "copy"] : []),
          "-c:v", "libx264", "-preset", "ultrafast", outName];

      } else if (mode === "text-overlay") {
        const pos = TEXT_POSITIONS.find(p => p.id === textPosition)!;
        const safeText = textContent.replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
        const fontColor = textColor;
        const bgColor = textBg ? "black@0.5" : "none";
        const timeFilter = textAlwaysShow ? "" : `:enable='between(t,${textStartTime},${textEndTime})'`;
        const drawFilter = `drawtext=text='${safeText}':fontsize=${textSize}:fontcolor=${fontColor}:box=1:boxcolor=${bgColor}:boxborderw=8:x=${pos.x}:y=${pos.y}${timeFilter}`;
        args = ["-i", inputName, "-vf", drawFilter,
          ...(hasAudio ? ["-c:a", "copy"] : []),
          "-c:v", "libx264", "-preset", "ultrafast", outName];

      } else if (mode === "logo-overlay") {
        if (!logoFile) { showToast("الرجاء رفع صورة الشعار أولاً", "err"); return; }
        const logoExt = logoFile.name.split(".").pop()?.toLowerCase() || "png";
        await ffmpeg.writeFile(`logo.${logoExt}`, await fetchFile(logoFile));
        const scaleW = `iw*${logoScale}/100`;
        const posMap: Record<string, string> = {
          "top-right": `x=W-w-20:y=20`,
          "top-left": `x=20:y=20`,
          "bottom-right": `x=W-w-20:y=H-h-20`,
          "bottom-left": `x=20:y=H-h-20`,
          "center": `x=(W-w)/2:y=(H-h)/2`,
        };
        args = [
          "-i", inputName, "-i", `logo.${logoExt}`,
          "-filter_complex",
          `[1:v]scale=${scaleW}:-1,format=rgba,colorchannelmixer=aa=${logoOpacity}[logo];[0:v][logo]overlay=${posMap[logoPosition]}`,
          ...(hasAudio ? ["-c:a", "copy"] : []),
          "-c:v", "libx264", "-preset", "ultrafast", outName,
        ];

      } else if (mode === "denoise") {
        const map = {
          light: "hqdn3d=2:1:3:2.5",
          medium: "hqdn3d=4:3:6:4.5",
          strong: "nlmeans=10:7:5:3:3",
        };
        args = ["-i", inputName, "-vf", map[denoiseStrength],
          ...(hasAudio ? ["-c:a", "copy"] : []),
          "-c:v", "libx264", "-preset", "ultrafast", outName];

      } else if (mode === "extract-audio") {
        outName = "output.mp3";
        args = ["-i", inputName, "-vn", "-acodec", "libmp3lame", "-q:a", "2", outName];

      } else if (mode === "remove-audio") {
        args = ["-i", inputName, "-c:v", "copy", "-an", outName];

      } else if (mode === "speed") {
        const clampedAtempo = Math.max(0.5, Math.min(2, speed));
        if (hasAudio) {
          args = [
            "-i", inputName,
            "-filter_complex",
            `[0:v]setpts=${(1 / speed).toFixed(4)}*PTS[v];[0:a]atempo=${clampedAtempo}[a]`,
            "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "ultrafast", outName,
          ];
        } else {
          args = ["-i", inputName, "-vf", `setpts=${(1 / speed).toFixed(4)}*PTS`,
            "-c:v", "libx264", "-preset", "ultrafast", "-an", outName];
        }

      } else if (mode === "trim") {
        const dur = Math.max(0.1, trimEnd - trimStart);
        args = ["-ss", String(trimStart), "-i", inputName, "-t", String(dur), "-c", "copy", outName];

      } else if (mode === "crop") {
        args = ["-i", inputName, "-vf", `crop=${cropW}:${cropH}:${cropX}:${cropY}`,
          ...(hasAudio ? ["-c:a", "copy"] : []),
          "-c:v", "libx264", "-preset", "ultrafast", outName];

      } else if (mode === "rotate") {
        const filterMap: Record<string, string> = {
          "90cw": "transpose=1", "90ccw": "transpose=2",
          "180": "transpose=2,transpose=2",
          "fliph": "hflip", "flipv": "vflip",
        };
        args = ["-i", inputName, "-vf", filterMap[rotateDir],
          ...(hasAudio ? ["-c:a", "copy"] : []),
          "-c:v", "libx264", "-preset", "ultrafast", outName];

      } else if (mode === "reverse") {
        if (hasAudio) {
          args = ["-i", inputName, "-vf", "reverse", "-af", "areverse",
            "-c:v", "libx264", "-preset", "ultrafast", outName];
        } else {
          args = ["-i", inputName, "-vf", "reverse",
            "-c:v", "libx264", "-preset", "ultrafast", "-an", outName];
        }

      } else if (mode === "concat") {
        if (extraFiles.length === 0) {
          showToast("أضف ملفاً واحداً على الأقل للدمج", "err"); return;
        }
        for (let i = 0; i < extraFiles.length; i++) {
          const ef = extraFiles[i];
          const eext = ef.name.split(".").pop()?.toLowerCase() || "mp4";
          await ffmpeg.writeFile(`extra${i}.${eext}`, await fetchFile(ef));
        }
        const listContent = [`file '${inputName}'`];
        for (let i = 0; i < extraFiles.length; i++) {
          const eext = extraFiles[i].name.split(".").pop()?.toLowerCase() || "mp4";
          listContent.push(`file 'extra${i}.${eext}'`);
        }
        const enc = new TextEncoder();
        await ffmpeg.writeFile("list.txt", enc.encode(listContent.join("\n")));
        args = ["-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", outName];

      } else if (mode === "compress") {
        args = ["-i", inputName, "-c:v", "libx264", "-crf", String(crf),
          "-preset", "veryfast", ...(hasAudio ? ["-c:a", "aac", "-b:a", "128k"] : ["-an"]), outName];

      } else if (mode === "upscale") {
        const [w, h] = upscaleRes.split("x");
        args = ["-i", inputName, "-vf", `scale=${w}:${h}:flags=lanczos`,
          ...(hasAudio ? ["-c:a", "copy"] : []),
          "-c:v", "libx264", "-preset", "ultrafast", outName];

      } else if (mode === "fps") {
        args = ["-i", inputName, "-filter:v", `fps=${targetFps}`,
          ...(hasAudio ? ["-c:a", "copy"] : []),
          "-c:v", "libx264", "-preset", "ultrafast", outName];

      } else if (mode === "gif") {
        outName = "output.gif";
        args = ["-i", inputName, "-vf",
          `fps=${gifFps},scale=${gifWidth}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
          outName];

      } else if (mode === "thumbnail") {
        outName = "thumb.jpg";
        args = ["-ss", String(thumbAt), "-i", inputName, "-frames:v", "1",
          "-q:v", "2", outName];

      } else if (mode === "stabilize") {
        const detOut = "stabilize_vectors.trf";
        await ffmpeg.exec(["-i", inputName, "-vf", "vidstabdetect=stepsize=6:shakiness=8:accuracy=9:result=stabilize_vectors.trf", "-f", "null", "-"]);
        appendLog("✓ مرحلة التحليل اكتملت، جاري التثبيت...");
        args = ["-i", inputName, "-vf", `vidstabtransform=input=${detOut}:zoom=1:smoothing=30,unsharp=5:5:0.8`,
          ...(hasAudio ? ["-c:a", "copy"] : []),
          "-c:v", "libx264", "-preset", "ultrafast", outName];

      } else if (mode === "auto-enhance") {
        const vf: string[] = [];
        const needsUpscale = meta && meta.height > 0 && meta.height < (autoLevel === "strong" ? 1080 : 720);

        if (autoLevel === "light") {
          vf.push("hqdn3d=2:1:3:2.5");
          vf.push("eq=brightness=0.02:contrast=1.05:saturation=1.15:gamma=0.97");
          vf.push("unsharp=3:3:0.3");
        } else if (autoLevel === "balanced") {
          vf.push("hqdn3d=3:2:4:3.5");
          vf.push("eq=brightness=0.03:contrast=1.1:saturation=1.25:gamma=0.95");
          vf.push("unsharp=5:5:0.5");
          if (needsUpscale) vf.push("scale=1280:720:flags=lanczos");
        } else {
          vf.push("hqdn3d=4:3:6:4.5");
          vf.push("eq=brightness=0.05:contrast=1.15:saturation=1.4:gamma=0.92");
          vf.push("unsharp=5:5:0.8");
          if (needsUpscale) vf.push("scale=1920:1080:flags=lanczos");
        }

        const audioArgs: string[] = hasAudio
          ? autoLevel === "strong"
            ? ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "192k"]
            : ["-af", "loudnorm=I=-18:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "128k"]
          : [];

        args = [
          "-i", inputName,
          "-vf", vf.join(","),
          ...audioArgs,
          "-c:v", "libx264", "-crf", autoLevel === "strong" ? "18" : autoLevel === "balanced" ? "20" : "22",
          "-preset", "ultrafast", outName,
        ];
      }

      await ffmpeg.exec(args);
      setProgress(100);

      const data = (await ffmpeg.readFile(outName)) as Uint8Array;
      const mime = outName.endsWith(".mp3") ? "audio/mpeg"
        : outName.endsWith(".gif") ? "image/gif"
        : outName.endsWith(".jpg") ? "image/jpeg"
        : "video/mp4";
      const blob = new Blob([data.buffer as ArrayBuffer], { type: mime });
      setOutputBlob(blob);
      setOutputName(outName);
      setOutputUrl(URL.createObjectURL(blob));
      showToast("✓ اكتملت المعالجة بنجاح!", "ok");

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e) || "حدث خطأ غير معروف";
      appendLog("❌ خطأ: " + msg);
      showToast("فشلت العملية: " + msg.slice(0, 80), "err");
      setShowLog(true);
    } finally {
      removeLogHandler(logHandler);
      setBusy(false);
      setLoadingFFmpeg(false);
    }
  }

  async function onSaveToCloud() {
    if (!outputBlob) return;
    setSaving(true);
    try {
      const reader = new FileReader();
      const fileData: string = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(outputBlob);
      });
      await saveVideo({ data: { name: outputName, fileData, mimeType: outputBlob.type, sizeBytes: outputBlob.size, settings: { mode } } });
      showToast("✓ تم الحفظ في مكتبتك", "ok");
    } catch (e) {
      showToast("فشل الحفظ: " + (e instanceof Error ? e.message : String(e)), "err");
    } finally {
      setSaving(false);
    }
  }

  const groups = [...new Set(MODES.map(m => m.group))];

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-medium shadow-2xl backdrop-blur-md border transition-all animate-in slide-in-from-top-2 ${toast.type === "ok" ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300" : "bg-red-500/20 border-red-500/40 text-red-300"}`}>
          {toast.type === "ok" ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3.5 border-b border-border/60 sticky top-0 z-40 bg-background/95 backdrop-blur-sm">
        <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition">
          <ArrowRight className="size-4" /> الرئيسية
        </Link>
        <div className="flex items-center gap-2 font-bold text-sm">
          <div className="p-1.5 rounded-lg bg-violet-500/15">
            <Wand2 className="size-4 text-violet-400" />
          </div>
          محرر الفيديو
        </div>
        <div className="flex items-center gap-3">
          <Link to="/batch" className="text-sm text-muted-foreground hover:text-violet-400 transition">دفعي</Link>
          <Link to="/library" className="text-sm text-muted-foreground hover:text-primary transition">مكتبتي</Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5 grid gap-5 lg:grid-cols-[1fr_360px] xl:grid-cols-[1fr_400px]">
        {/* ── LEFT: Preview + Controls ── */}
        <section className="space-y-4 min-w-0">
          {/* Video Preview */}
          <div
            className={`rounded-2xl border-2 ${dragOver ? "border-violet-500 bg-violet-500/5" : "border-border"} bg-card/50 overflow-hidden aspect-video flex items-center justify-center min-h-[240px] transition-colors relative`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            {outputUrl ? (
              outputName.endsWith(".mp3") ? (
                <div className="w-full px-8 py-6 space-y-3">
                  <div className="flex items-center gap-3 text-sm font-medium">
                    <Volume2 className="size-5 text-violet-400" /> {outputName}
                  </div>
                  <audio src={outputUrl} controls className="w-full" />
                </div>
              ) : outputName.endsWith(".gif") || outputName.endsWith(".jpg") ? (
                <img src={outputUrl} alt="output" className="max-w-full max-h-full object-contain" />
              ) : (
                <video src={outputUrl} controls className="w-full h-full rounded-2xl" />
              )
            ) : file ? (
              <video src={URL.createObjectURL(file)} controls className="w-full h-full rounded-2xl" />
            ) : (
              <button onClick={() => inputRef.current?.click()} className="flex flex-col items-center gap-4 text-muted-foreground hover:text-violet-400 transition p-10 w-full h-full group">
                <div className="rounded-3xl border-2 border-dashed border-current p-8 group-hover:border-violet-400 transition">
                  <Upload className="size-12 mx-auto mb-3" />
                  <span className="block text-base font-semibold">اضغط أو اسحب الفيديو هنا</span>
                  <span className="block text-xs mt-1.5 opacity-60">MP4, MOV, AVI, MKV, WebM — حتى 500MB</span>
                </div>
              </button>
            )}
            {dragOver && (
              <div className="absolute inset-0 flex items-center justify-center bg-violet-500/10 rounded-2xl">
                <span className="text-violet-400 font-bold text-lg">أفلت الملف هنا</span>
              </div>
            )}
          </div>

          <input ref={inputRef} type="file" accept="video/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setOutputUrl(null); setOutputBlob(null); } }} />
          <input ref={extraRef} type="file" accept="video/*" multiple className="hidden"
            onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length) setExtraFiles(prev => [...prev, ...files]); }} />
          <input ref={logoRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) setLogoFile(f); }} />

          {/* File info bar */}
          {file && (
            <div className="flex items-center justify-between text-sm bg-card/60 rounded-xl px-4 py-2.5 border border-border">
              <span className="text-muted-foreground truncate max-w-xs">{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</span>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => inputRef.current?.click()} className="text-violet-400 hover:underline text-xs">تغيير</button>
                <button onClick={() => { setFile(null); setOutputUrl(null); setOutputBlob(null); }} className="text-destructive hover:underline text-xs">
                  <X className="size-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Video Metadata Card */}
          {meta && !outputUrl && (
            <div className="rounded-xl border border-border bg-card/40 px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">المدة</span>
                <span className="text-sm font-mono font-bold text-foreground tabular-nums">
                  {isFinite(meta.duration) ? fmtDuration(meta.duration) : "—"}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">الدقة</span>
                <span className="text-sm font-mono font-bold text-foreground tabular-nums">
                  {meta.width && meta.height ? `${meta.width}×${meta.height}` : "—"}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">البيت-ريت</span>
                <span className="text-sm font-mono font-bold text-foreground tabular-nums">
                  {meta.bitrate > 0
                    ? meta.bitrate >= 1000
                      ? `${(meta.bitrate / 1000).toFixed(1)} Mbps`
                      : `${meta.bitrate} kbps`
                    : "—"}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">الصيغة</span>
                <span className="text-sm font-mono font-bold text-violet-400">{meta.container}</span>
              </div>
            </div>
          )}

          {/* Progress */}
          {busy && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin text-violet-400" />
                  <span className="font-medium">{loadingFFmpeg ? "جاري تحميل محرك FFmpeg..." : `جاري المعالجة...`}</span>
                </div>
                <span className="font-mono text-violet-400 font-bold">{loadingFFmpeg ? "..." : `${progress}%`}</span>
              </div>
              <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-violet-500 to-purple-400 transition-all duration-500 rounded-full"
                  style={{ width: `${loadingFFmpeg ? 8 : Math.max(4, progress)}%` }} />
              </div>
              {loadingFFmpeg && <p className="text-xs text-muted-foreground">يتم تحميل FFmpeg.wasm (~32MB) مرة واحدة فقط</p>}
            </div>
          )}

          {/* Output actions */}
          {outputUrl && (
            <div className="flex flex-wrap gap-2.5">
              <a href={outputUrl} download={outputName}
                className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 font-semibold text-white hover:opacity-90 transition shadow-lg shadow-violet-500/20">
                <Download className="size-4" /> تنزيل الملف
              </a>
              <button onClick={onSaveToCloud} disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 font-semibold hover:bg-secondary disabled:opacity-50 transition text-sm">
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                حفظ في مكتبتي
              </button>
              <button onClick={() => { setOutputUrl(null); setOutputBlob(null); }}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm hover:bg-secondary transition text-muted-foreground">
                <RefreshCw className="size-4" /> معالجة جديدة
              </button>
            </div>
          )}

          {/* Log */}
          {log && (
            <div className="rounded-xl border border-border bg-card/60">
              <button onClick={() => setShowLog(!showLog)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-2">
                  <Settings2 className="size-3.5" /> سجل FFmpeg
                </span>
                <ChevronRight className={`size-4 transition-transform ${showLog ? "rotate-90" : ""}`} />
              </button>
              {showLog && (
                <pre className="px-4 pb-4 text-xs whitespace-pre-wrap text-muted-foreground max-h-52 overflow-auto font-mono leading-relaxed border-t border-border/50 pt-3">{log}</pre>
              )}
            </div>
          )}

          {/* Process Button (mobile) */}
          <button onClick={onProcess} disabled={!file || busy}
            className="lg:hidden w-full inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-6 py-3.5 font-bold text-white hover:opacity-90 transition disabled:opacity-40 shadow-lg shadow-violet-500/20">
            {busy ? <Loader2 className="size-5 animate-spin" /> : <Wand2 className="size-5" />}
            {busy ? (loadingFFmpeg ? "جاري تحميل FFmpeg..." : `معالجة... ${progress}%`) : "تطبيق"}
          </button>
        </section>

        {/* ── RIGHT: Mode Selector + Settings ── */}
        <aside className="space-y-4">
          {/* Mode Groups */}
          <div className="rounded-2xl border border-border bg-card/60 p-3 space-y-3">
            <h2 className="text-sm font-bold px-1 flex items-center gap-2">
              <Layers className="size-4 text-muted-foreground" /> اختر العملية
            </h2>
            {groups.map(group => (
              <div key={group}>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium px-1 mb-1.5">{group}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {MODES.filter(m => m.group === group).map((m) => (
                    <button key={m.value} onClick={() => setMode(m.value)}
                      className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition text-right ${mode === m.value ? "bg-violet-600 text-white shadow-sm" : "bg-background/60 border border-border hover:bg-secondary text-muted-foreground hover:text-foreground"}`}>
                      <m.icon className="size-3.5 shrink-0" />
                      <span className="truncate">{m.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Mode-specific settings */}
          <ModeSettings
            mode={mode}
            file={file} meta={meta}
            autoLevel={autoLevel} setAutoLevel={setAutoLevel}
            brightness={brightness} setBrightness={setBrightness}
            contrast={contrast} setContrast={setContrast}
            saturation={saturation} setSaturation={setSaturation}
            sharpness={sharpness} setSharpness={setSharpness}
            gamma={gamma} setGamma={setGamma}
            denoiseFilter={denoiseFilter} setDenoiseFilter={setDenoiseFilter}
            denoiseStrength={denoiseStrength} setDenoiseStrength={setDenoiseStrength}
            colorPreset={colorPreset} setColorPreset={setColorPreset}
            brightness2={brightness2} setBrightness2={setBrightness2}
            contrast2={contrast2} setContrast2={setContrast2}
            saturation2={saturation2} setSaturation2={setSaturation2}
            gamma2={gamma2} setGamma2={setGamma2}
            textContent={textContent} setTextContent={setTextContent}
            textSize={textSize} setTextSize={setTextSize}
            textColor={textColor} setTextColor={setTextColor}
            textBg={textBg} setTextBg={setTextBg}
            textPosition={textPosition} setTextPosition={setTextPosition}
            textBold={textBold} setTextBold={setTextBold}
            textStartTime={textStartTime} setTextStartTime={setTextStartTime}
            textEndTime={textEndTime} setTextEndTime={setTextEndTime}
            textAlwaysShow={textAlwaysShow} setTextAlwaysShow={setTextAlwaysShow}
            logoFile={logoFile} logoRef={logoRef}
            logoPosition={logoPosition} setLogoPosition={setLogoPosition}
            logoScale={logoScale} setLogoScale={setLogoScale}
            logoOpacity={logoOpacity} setLogoOpacity={setLogoOpacity}
            speed={speed} setSpeed={setSpeed}
            trimStart={trimStart} setTrimStart={setTrimStart}
            trimEnd={trimEnd} setTrimEnd={setTrimEnd}
            cropW={cropW} setCropW={setCropW}
            cropH={cropH} setCropH={setCropH}
            cropX={cropX} setCropX={setCropX}
            cropY={cropY} setCropY={setCropY}
            rotateDir={rotateDir} setRotateDir={setRotateDir}
            crf={crf} setCrf={setCrf}
            upscaleRes={upscaleRes} setUpscaleRes={setUpscaleRes}
            targetFps={targetFps} setTargetFps={setTargetFps}
            gifFps={gifFps} setGifFps={setGifFps}
            gifWidth={gifWidth} setGifWidth={setGifWidth}
            thumbAt={thumbAt} setThumbAt={setThumbAt}
            extraFiles={extraFiles} setExtraFiles={setExtraFiles}
            extraRef={extraRef}
          />

          {/* Process Button */}
          <button onClick={onProcess} disabled={!file || busy}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-6 py-3.5 font-bold text-white hover:opacity-90 transition disabled:opacity-40 shadow-lg shadow-violet-500/20 text-sm">
            {busy ? <Loader2 className="size-5 animate-spin" /> : <Wand2 className="size-5" />}
            {busy ? (loadingFFmpeg ? "جاري تحميل FFmpeg..." : `معالجة... ${progress}%`) : `تطبيق: ${MODES.find(m => m.value === mode)?.label}`}
          </button>
        </aside>
      </main>
    </div>
  );
}

// ── Settings sub-component ──
function ModeSettings(p: any) {
  const Card = ({ children }: { children: React.ReactNode }) => (
    <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">{children}</div>
  );
  const Title = ({ children }: { children: React.ReactNode }) => (
    <h3 className="text-sm font-bold">{children}</h3>
  );

  if (p.mode === "enhance") return (
    <Card>
      <Title>إعدادات التحسين</Title>
      <Slider label="السطوع" value={p.brightness} min={-1} max={1} step={0.05} onChange={p.setBrightness} display={p.brightness.toFixed(2)} />
      <Slider label="التباين" value={p.contrast} min={0.5} max={2} step={0.05} onChange={p.setContrast} display={p.contrast.toFixed(2)} />
      <Slider label="التشبع" value={p.saturation} min={0} max={3} step={0.1} onChange={p.setSaturation} display={p.saturation.toFixed(1)} />
      <Slider label="الحدّة" value={p.sharpness} min={0} max={2} step={0.1} onChange={p.setSharpness} display={p.sharpness.toFixed(1)} />
      <Slider label="جاما" value={p.gamma} min={0.5} max={2} step={0.05} onChange={p.setGamma} display={p.gamma.toFixed(2)} />
      <label className="block">
        <span className="text-xs text-muted-foreground">إزالة الضوضاء</span>
        <select value={p.denoiseFilter} onChange={(e) => p.setDenoiseFilter(e.target.value)}
          className="w-full mt-1 rounded-lg bg-input border border-border px-3 py-2 text-xs">
          <option value="none">بدون</option>
          <option value="hqdn3d">hqdn3d — سريع</option>
          <option value="nlmeans">nlmeans — جودة أعلى</option>
        </select>
      </label>
      <QuickReset onReset={() => { p.setBrightness(0); p.setContrast(1); p.setSaturation(1); p.setSharpness(0); p.setGamma(1); p.setDenoiseFilter("none"); }} />
    </Card>
  );

  if (p.mode === "color-grade") return (
    <Card>
      <Title>تصحيح الألوان</Title>
      <div className="grid grid-cols-5 gap-1.5">
        {COLOR_PRESETS.map(cp => (
          <button key={cp.id} onClick={() => p.setColorPreset(cp.id)}
            className={`rounded-lg py-1.5 text-[10px] font-medium transition ${p.colorPreset === cp.id ? "bg-pink-600 text-white" : "bg-background border border-border hover:bg-secondary text-muted-foreground"}`}>
            {cp.label}
          </button>
        ))}
      </div>
      {p.colorPreset === "none" && <>
        <Slider label="السطوع" value={p.brightness2} min={-1} max={1} step={0.05} onChange={p.setBrightness2} display={p.brightness2.toFixed(2)} color="pink" />
        <Slider label="التباين" value={p.contrast2} min={0.5} max={2} step={0.05} onChange={p.setContrast2} display={p.contrast2.toFixed(2)} color="pink" />
        <Slider label="التشبع" value={p.saturation2} min={0} max={3} step={0.1} onChange={p.setSaturation2} display={p.saturation2.toFixed(1)} color="pink" />
        <Slider label="جاما" value={p.gamma2} min={0.5} max={2} step={0.05} onChange={p.setGamma2} display={p.gamma2.toFixed(2)} color="pink" />
      </>}
    </Card>
  );

  if (p.mode === "text-overlay") return (
    <Card>
      <Title>نص على الفيديو</Title>
      <label className="block">
        <span className="text-xs text-muted-foreground">النص</span>
        <textarea value={p.textContent} onChange={(e) => p.setTextContent(e.target.value)} rows={2}
          className="w-full mt-1 rounded-lg bg-input border border-border px-3 py-2 text-sm resize-none" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs text-muted-foreground">الحجم</span>
          <input type="number" value={p.textSize} onChange={(e) => p.setTextSize(+e.target.value)} min={16} max={200}
            className="w-full mt-1 rounded-lg bg-input border border-border px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">اللون</span>
          <select value={p.textColor} onChange={(e) => p.setTextColor(e.target.value)}
            className="w-full mt-1 rounded-lg bg-input border border-border px-3 py-2 text-xs">
            {["white","yellow","red","lime","cyan","orange","black"].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="text-xs text-muted-foreground">الموضع</span>
        <select value={p.textPosition} onChange={(e) => p.setTextPosition(e.target.value)}
          className="w-full mt-1 rounded-lg bg-input border border-border px-3 py-2 text-xs">
          {TEXT_POSITIONS.map(tp => <option key={tp.id} value={tp.id}>{tp.label}</option>)}
        </select>
      </label>
      <div className="flex gap-3">
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input type="checkbox" checked={p.textBg} onChange={(e) => p.setTextBg(e.target.checked)} className="accent-sky-500" />
          خلفية شفافة
        </label>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input type="checkbox" checked={p.textAlwaysShow} onChange={(e) => p.setTextAlwaysShow(e.target.checked)} className="accent-sky-500" />
          دائماً
        </label>
      </div>
      {!p.textAlwaysShow && (
        <div className="grid grid-cols-2 gap-2">
          <NumInput label="من (ثانية)" value={p.textStartTime} onChange={p.setTextStartTime} />
          <NumInput label="إلى (ثانية)" value={p.textEndTime} onChange={p.setTextEndTime} />
        </div>
      )}
    </Card>
  );

  if (p.mode === "logo-overlay") return (
    <Card>
      <Title>إضافة شعار / صورة</Title>
      <div className="rounded-xl border border-dashed border-border p-3 text-center">
        {p.logoFile ? (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground truncate">{p.logoFile.name}</span>
            <button onClick={() => p.logoRef.current?.click()} className="text-xs text-primary">تغيير</button>
          </div>
        ) : (
          <button onClick={() => p.logoRef.current?.click()} className="flex flex-col items-center gap-1.5 w-full text-muted-foreground hover:text-emerald-400 transition">
            <Upload className="size-5" />
            <span className="text-xs">رفع صورة PNG/JPG</span>
          </button>
        )}
      </div>
      <label className="block">
        <span className="text-xs text-muted-foreground">الموضع</span>
        <div className="grid grid-cols-2 gap-1.5 mt-1.5">
          {[["top-right","أعلى يمين"],["top-left","أعلى يسار"],["bottom-right","أسفل يمين"],["bottom-left","أسفل يسار"],["center","مركز"]].map(([v,l]) => (
            <button key={v} onClick={() => p.setLogoPosition(v)}
              className={`rounded-lg py-1.5 text-xs font-medium transition ${p.logoPosition === v ? "bg-emerald-600 text-white" : "bg-background border border-border hover:bg-secondary text-muted-foreground"}`}>
              {l}
            </button>
          ))}
        </div>
      </label>
      <Slider label={`حجم الشعار: ${p.logoScale}%`} value={p.logoScale} min={5} max={50} step={1} onChange={p.setLogoScale} display={p.logoScale + "%"} color="emerald" />
      <Slider label={`الشفافية: ${Math.round(p.logoOpacity * 100)}%`} value={p.logoOpacity} min={0.1} max={1} step={0.05} onChange={p.setLogoOpacity} display={Math.round(p.logoOpacity * 100) + "%"} color="emerald" />
    </Card>
  );

  if (p.mode === "denoise") return (
    <Card>
      <Title>إزالة الضوضاء</Title>
      <div className="grid grid-cols-3 gap-1.5">
        {[["light","خفيف"],["medium","متوسط"],["strong","قوي"]].map(([v,l]) => (
          <button key={v} onClick={() => p.setDenoiseStrength(v)}
            className={`rounded-lg py-2 text-xs font-medium transition ${p.denoiseStrength === v ? "bg-blue-600 text-white" : "bg-background border border-border hover:bg-secondary text-muted-foreground"}`}>
            {l}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {p.denoiseStrength === "light" ? "hqdn3d — سريع جداً" : p.denoiseStrength === "medium" ? "hqdn3d متوسط — توازن ممتاز" : "nlmeans — أعلى جودة، أبطأ"}
      </p>
    </Card>
  );

  if (p.mode === "speed") return (
    <Card>
      <Title>تغيير السرعة</Title>
      <Slider label={`السرعة: ${p.speed.toFixed(2)}x`} value={p.speed} min={0.25} max={4} step={0.05} onChange={p.setSpeed} display={p.speed.toFixed(2) + "x"} color="green" />
      <div className="grid grid-cols-4 gap-1.5">
        {[0.5, 1, 1.5, 2].map(v => (
          <button key={v} onClick={() => p.setSpeed(v)}
            className={`rounded-lg py-1.5 text-xs font-medium transition ${p.speed === v ? "bg-green-600 text-white" : "bg-background border border-border hover:bg-secondary text-muted-foreground"}`}>
            {v}x
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">ملاحظة: الصوت يُعالج حتى 2x فقط. أسرع من ذلك يُحذف الصوت.</p>
    </Card>
  );

  if (p.mode === "trim") return (
    <Card>
      <Title>قص مقطع</Title>
      {p.file && p.meta?.duration ? (
        <WaveformTrimmer
          file={p.file}
          duration={p.meta.duration}
          trimStart={p.trimStart}
          trimEnd={p.trimEnd}
          setTrimStart={p.setTrimStart}
          setTrimEnd={p.setTrimEnd}
        />
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <NumInput label="من (ثانية)" value={p.trimStart} onChange={p.setTrimStart} />
            <NumInput label="إلى (ثانية)" value={p.trimEnd} onChange={p.setTrimEnd} />
          </div>
          <p className="text-[11px] text-muted-foreground">المدة: {Math.max(0, p.trimEnd - p.trimStart).toFixed(1)} ثانية</p>
        </div>
      )}
    </Card>
  );

  if (p.mode === "crop") return (
    <Card>
      <Title>اقتصاص</Title>
      <div className="grid grid-cols-2 gap-2">
        <NumInput label="العرض (px)" value={p.cropW} onChange={p.setCropW} />
        <NumInput label="الارتفاع (px)" value={p.cropH} onChange={p.setCropH} />
        <NumInput label="X (يسار)" value={p.cropX} onChange={p.setCropX} />
        <NumInput label="Y (أعلى)" value={p.cropY} onChange={p.setCropY} />
      </div>
    </Card>
  );

  if (p.mode === "rotate") return (
    <Card>
      <Title>تدوير / قلب</Title>
      <div className="grid grid-cols-2 gap-1.5">
        {[["90cw","90° يمين"],["90ccw","90° يسار"],["180","180°"],["fliph","قلب أفقي"],["flipv","قلب رأسي"]].map(([v,l]) => (
          <button key={v} onClick={() => p.setRotateDir(v)}
            className={`rounded-lg py-2 text-xs font-medium transition ${p.rotateDir === v ? "bg-indigo-600 text-white" : "bg-background border border-border hover:bg-secondary text-muted-foreground"}`}>
            {l}
          </button>
        ))}
      </div>
    </Card>
  );

  if (p.mode === "compress") return (
    <Card>
      <Title>ضغط الفيديو</Title>
      <Slider label={`CRF: ${p.crf} (أقل = جودة أعلى)`} value={p.crf} min={15} max={35} step={1} onChange={p.setCrf} display={String(p.crf)} color="orange" />
      <div className="grid grid-cols-3 gap-1.5 text-[10px] text-center">
        {[[18,"جودة عالية"],[23,"متوازن"],[28,"حجم أصغر"]].map(([v,l]) => (
          <button key={v} onClick={() => p.setCrf(v as number)}
            className={`rounded-lg py-1.5 font-medium transition ${p.crf === v ? "bg-orange-600 text-white" : "bg-background border border-border hover:bg-secondary text-muted-foreground"}`}>
            CRF {v}<br />{l}
          </button>
        ))}
      </div>
    </Card>
  );

  if (p.mode === "upscale") return (
    <Card>
      <Title>ترقية الدقة</Title>
      {[["1280x720","720p HD"],["1920x1080","1080p Full HD"],["3840x2160","4K Ultra HD"]].map(([v,l]) => (
        <button key={v} onClick={() => p.setUpscaleRes(v)}
          className={`w-full rounded-xl py-2.5 text-sm font-medium transition ${p.upscaleRes === v ? "bg-yellow-600 text-white" : "bg-background border border-border hover:bg-secondary text-muted-foreground"}`}>
          {l}
        </button>
      ))}
    </Card>
  );

  if (p.mode === "fps") return (
    <Card>
      <Title>معدل الإطارات</Title>
      <div className="grid grid-cols-3 gap-1.5">
        {[24,30,60].map(f => (
          <button key={f} onClick={() => p.setTargetFps(f)}
            className={`rounded-lg py-2 text-sm font-medium transition ${p.targetFps === f ? "bg-teal-600 text-white" : "bg-background border border-border hover:bg-secondary text-muted-foreground"}`}>
            {f} fps
          </button>
        ))}
      </div>
      <NumInput label="FPS مخصص" value={p.targetFps} onChange={p.setTargetFps} />
    </Card>
  );

  if (p.mode === "gif") return (
    <Card>
      <Title>تحويل إلى GIF</Title>
      <NumInput label="معدل الإطارات (fps)" value={p.gifFps} onChange={p.setGifFps} />
      <NumInput label="العرض (px)" value={p.gifWidth} onChange={p.setGifWidth} />
      <p className="text-[11px] text-muted-foreground">يستخدم palette محسّن لجودة ألوان ممتازة</p>
    </Card>
  );

  if (p.mode === "thumbnail") return (
    <Card>
      <Title>التقاط صورة</Title>
      <NumInput label="الوقت (ثانية)" value={p.thumbAt} onChange={p.setThumbAt} />
      <p className="text-[11px] text-muted-foreground">يستخرج إطار بجودة JPEG عالية</p>
    </Card>
  );

  if (p.mode === "concat") return (
    <Card>
      <Title>دمج فيديوهات</Title>
      <p className="text-[11px] text-muted-foreground">الفيديو الرئيسي + الملفات التالية ستُدمج بالترتيب.</p>
      <button onClick={() => p.extraRef.current?.click()}
        className="w-full rounded-xl border border-dashed border-border py-2.5 text-xs text-muted-foreground hover:text-amber-400 hover:border-amber-400 transition">
        + إضافة فيديوهات للدمج
      </button>
      {p.extraFiles.length > 0 && (
        <div className="space-y-1.5 max-h-32 overflow-auto">
          {p.extraFiles.map((f: File, i: number) => (
            <div key={i} className="flex items-center justify-between text-xs bg-background/60 border border-border rounded-lg px-3 py-1.5">
              <span className="truncate">{i + 1}. {f.name}</span>
              <button onClick={() => p.setExtraFiles((prev: File[]) => prev.filter((_: File, idx: number) => idx !== i))} className="text-destructive ml-2">✕</button>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">تأكد أن جميع الفيديوهات بنفس الدقة والصيغة للحصول على أفضل نتيجة.</p>
    </Card>
  );

  if (p.mode === "extract-audio") return (
    <Card>
      <Title>استخراج الصوت</Title>
      <p className="text-xs text-muted-foreground">يستخرج الصوت كملف MP3 بجودة عالية (VBR Q2)</p>
    </Card>
  );

  if (p.mode === "remove-audio") return (
    <Card>
      <Title>إزالة الصوت</Title>
      <p className="text-xs text-muted-foreground">ينسخ الفيديو بدون أي مسار صوتي</p>
    </Card>
  );

  if (p.mode === "reverse") return (
    <Card>
      <Title>عكس الفيديو</Title>
      <p className="text-xs text-muted-foreground">يعكس الفيديو والصوت معاً. تنبيه: ملفات كبيرة تستغرق وقتاً.</p>
    </Card>
  );

  if (p.mode === "stabilize") return (
    <Card>
      <Title>تثبيت الفيديو</Title>
      <p className="text-xs text-muted-foreground">يتطلب مرحلتين: تحليل → تثبيت. قد يستغرق وقتاً للملفات الطويلة.</p>
    </Card>
  );

  if (p.mode === "auto-enhance") {
    const h = p.meta?.height ?? 0;
    const willUpscale = h > 0 && h < (p.autoLevel === "strong" ? 1080 : 720);
    const ops: { label: string; detail: string; active: boolean }[] = [
      { label: "إزالة التشويش",  detail: p.autoLevel === "strong" ? "hqdn3d قوي" : "hqdn3d متوسط", active: true },
      { label: "تحسين الألوان",  detail: p.autoLevel === "light" ? "دفء خفيف" : p.autoLevel === "balanced" ? "تباين + تشبع" : "ألوان قوية", active: true },
      { label: "زيادة الحدّة",   detail: p.autoLevel === "light" ? "خفيف 0.3" : p.autoLevel === "balanced" ? "متوسط 0.5" : "قوي 0.8", active: true },
      { label: "ترقية الدقة",    detail: p.autoLevel === "balanced" ? "→ 720p" : "→ 1080p", active: willUpscale },
      { label: "تطبيع الصوت",   detail: "loudnorm EBU R128", active: p.autoLevel !== "light" },
    ];
    return (
      <Card>
        <div className="flex items-center gap-2 mb-1">
          <Star className="size-4 text-amber-400" />
          <Title>التحسين التلقائي الذكي</Title>
        </div>
        <div className="grid grid-cols-3 gap-1.5 mb-3">
          {(["light","balanced","strong"] as const).map((lv) => (
            <button key={lv} onClick={() => p.setAutoLevel(lv)}
              className={`rounded-lg py-2 text-xs font-semibold transition ${p.autoLevel === lv ? "bg-amber-500 text-white" : "bg-background border border-border hover:bg-secondary text-muted-foreground"}`}>
              {lv === "light" ? "خفيف" : lv === "balanced" ? "متوازن ✦" : "قوي"}
            </button>
          ))}
        </div>
        <div className="space-y-1.5">
          {ops.map((op) => (
            <div key={op.label} className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs transition ${op.active ? "bg-amber-500/10 border border-amber-500/20" : "bg-background/40 border border-border opacity-40"}`}>
              <div className="flex items-center gap-2">
                <div className={`size-4 rounded-full flex items-center justify-center ${op.active ? "bg-amber-500" : "bg-muted"}`}>
                  {op.active && <Check className="size-2.5 text-white" strokeWidth={3} />}
                </div>
                <span className={op.active ? "text-foreground font-medium" : "text-muted-foreground"}>{op.label}</span>
              </div>
              <span className="text-muted-foreground font-mono text-[10px]">{op.detail}</span>
            </div>
          ))}
        </div>
        {p.meta && (
          <p className="text-[11px] text-muted-foreground mt-2">
            الفيديو: {p.meta.width}×{p.meta.height} · {(p.meta.bitrate / 1000).toFixed(1)} Mbps
            {willUpscale ? " · سيتم ترقية الدقة تلقائياً" : ""}
          </p>
        )}
        {!p.meta && <p className="text-[11px] text-amber-400/80 mt-1">ارفع فيديو لرؤية التحسينات المقترحة</p>}
      </Card>
    );
  }

  return null;
}

function Slider({ label, value, min, max, step, onChange, display, color = "violet" }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; display: string; color?: string;
}) {
  const accentMap: Record<string, string> = {
    violet: "accent-violet-500", pink: "accent-pink-500", green: "accent-green-500",
    blue: "accent-blue-500", orange: "accent-orange-500", teal: "accent-teal-500",
    emerald: "accent-emerald-500",
  };
  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-foreground font-medium">{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className={`w-full ${accentMap[color] ?? "accent-violet-500"}`} />
    </div>
  );
}

function NumInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input type="number" value={value} onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full mt-1 rounded-lg bg-input border border-border px-3 py-2 text-sm font-mono" />
    </label>
  );
}

function QuickReset({ onReset }: { onReset: () => void }) {
  return (
    <button onClick={onReset} className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition">
      <RefreshCw className="size-3" /> إعادة تعيين
    </button>
  );
}

function WaveformTrimmer({
  file, duration, trimStart, trimEnd, setTrimStart, setTrimEnd,
}: {
  file: File; duration: number;
  trimStart: number; trimEnd: number;
  setTrimStart: (v: number) => void; setTrimEnd: (v: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [bars, setBars] = useState<Float32Array | null>(null);
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);
  const BAR_COUNT = 300;

  useEffect(() => {
    let cancelled = false;
    const ctx = new AudioContext();
    file.arrayBuffer()
      .then((buf) => ctx.decodeAudioData(buf))
      .then((decoded) => {
        if (cancelled) return;
        const ch = decoded.getChannelData(0);
        const blockSize = Math.max(1, Math.floor(ch.length / BAR_COUNT));
        const out = new Float32Array(BAR_COUNT);
        for (let i = 0; i < BAR_COUNT; i++) {
          let mx = 0;
          for (let j = 0; j < blockSize; j++) mx = Math.max(mx, Math.abs(ch[i * blockSize + j] ?? 0));
          out[i] = mx;
        }
        setBars(out);
      })
      .catch(() => {})
      .finally(() => ctx.close());
    return () => { cancelled = true; };
  }, [file]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bars) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    const midY = height / 2;
    const barW = width / BAR_COUNT;
    for (let i = 0; i < BAR_COUNT; i++) {
      const pct = i / BAR_COUNT;
      const inSel = pct >= trimStart / duration && pct <= trimEnd / duration;
      const h = Math.max(1, (bars[i] ?? 0) * midY * 0.92);
      ctx.fillStyle = inSel ? "#a78bfa" : "#374151";
      ctx.fillRect(i * barW, midY - h, Math.max(1, barW - 0.8), h * 2);
    }
  }, [bars, trimStart, trimEnd, duration]);

  function clientToTime(clientX: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration));
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging) return;
    const t = clientToTime(e.clientX);
    if (dragging === "start") setTrimStart(parseFloat(Math.min(t, trimEnd - 0.1).toFixed(2)));
    else setTrimEnd(parseFloat(Math.max(t, trimStart + 0.1).toFixed(2)));
  }

  const startPct = (trimStart / duration) * 100;
  const endPct   = (trimEnd   / duration) * 100;

  return (
    <div className="space-y-2.5">
      <div
        ref={containerRef}
        className="relative h-16 rounded-xl overflow-hidden bg-black/30 border border-border cursor-col-resize select-none"
        onPointerMove={onPointerMove}
        onPointerUp={() => setDragging(null)}
        onPointerLeave={() => setDragging(null)}
      >
        <canvas ref={canvasRef} width={600} height={64} className="w-full h-full block" />

        {!bars && (
          <div className="absolute inset-0 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> تحليل الصوت...
          </div>
        )}

        {/* Dark overlay outside selection */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-y-0 left-0 bg-black/55" style={{ width: `${startPct}%` }} />
          <div className="absolute inset-y-0 right-0 bg-black/55" style={{ width: `${100 - endPct}%` }} />
          <div className="absolute inset-y-0 border-2 border-violet-400/70 rounded"
            style={{ left: `${startPct}%`, right: `${100 - endPct}%` }} />
        </div>

        {/* Start handle */}
        <div
          className="absolute inset-y-0 w-3 bg-violet-500 hover:bg-violet-400 cursor-ew-resize flex items-center justify-center touch-none z-10"
          style={{ left: `${startPct}%`, transform: "translateX(-50%)" }}
          onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setDragging("start"); }}
        >
          <div className="w-0.5 h-5 bg-white/80 rounded-full" />
        </div>

        {/* End handle */}
        <div
          className="absolute inset-y-0 w-3 bg-violet-500 hover:bg-violet-400 cursor-ew-resize flex items-center justify-center touch-none z-10"
          style={{ left: `${endPct}%`, transform: "translateX(-50%)" }}
          onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setDragging("end"); }}
        >
          <div className="w-0.5 h-5 bg-white/80 rounded-full" />
        </div>

        {/* Time labels */}
        <div className="absolute bottom-0.5 left-1 text-[9px] text-white/60 font-mono pointer-events-none">
          {fmtDuration(trimStart)}
        </div>
        <div className="absolute bottom-0.5 right-1 text-[9px] text-white/60 font-mono pointer-events-none">
          {fmtDuration(trimEnd)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumInput label="من (ثانية)" value={trimStart} onChange={(v) => setTrimStart(Math.max(0, Math.min(v, trimEnd - 0.1)))} />
        <NumInput label="إلى (ثانية)" value={trimEnd}   onChange={(v) => setTrimEnd(Math.min(duration, Math.max(v, trimStart + 0.1)))} />
      </div>

      <p className="text-[11px] text-muted-foreground">
        المحدد: <span className="text-violet-400 font-semibold">{fmtDuration(trimEnd - trimStart)}</span>
        {" "}من أصل {fmtDuration(duration)} · اسحب المقابض البنفسجية
      </p>
    </div>
  );
}
