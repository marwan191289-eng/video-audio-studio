import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState, useCallback } from "react";
import { fetchFile } from "@ffmpeg/util";
import { getFFmpeg, removeLogHandler } from "@/lib/ffmpeg-client";
import {
  ArrowRight,
  Upload,
  Download,
  Loader2,
  Music,
  Volume2,
  Mic,
  Waves,
  Music2,
  AudioWaveform,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  Settings2,
  RefreshCw,
  X,
  Cloud,
  Cpu,
} from "lucide-react";

export const Route = createFileRoute("/audio")({
  head: () => ({
    meta: [
      { title: "استوديو الصوت — Video Enhancer Pro" },
      {
        name: "description",
        content: "معالجة صوتية احترافية: تحسين، إزالة ضوضاء، EQ، صدى، نبرة، سرعة.",
      },
    ],
  }),
  component: AudioPage,
});

type AudioMode =
  | "extract"
  | "remove"
  | "replace"
  | "normalize"
  | "denoise"
  | "volume"
  | "fade"
  | "pitch"
  | "speed"
  | "echo"
  | "bass"
  | "treble"
  | "eq3band"
  | "stereo-mono"
  | "silence-remove"
  | "trim";

const AUDIO_MODES: {
  value: AudioMode;
  label: string;
  icon: React.ElementType;
  desc: string;
  group: string;
}[] = [
  {
    value: "extract",
    label: "استخراج الصوت",
    icon: Music,
    desc: "استخرج الصوت كـ MP3",
    group: "تحرير",
  },
  {
    value: "remove",
    label: "إزالة الصوت",
    icon: Volume2,
    desc: "احذف الصوت من الفيديو",
    group: "تحرير",
  },
  {
    value: "replace",
    label: "استبدال الصوت",
    icon: Music2,
    desc: "استبدل الصوت بمسار آخر",
    group: "تحرير",
  },
  { value: "trim", label: "قص الصوت", icon: Waves, desc: "قص جزء من الملف الصوتي", group: "تحرير" },
  {
    value: "normalize",
    label: "تطبيع المستوى",
    icon: Waves,
    desc: "EBU R128 - معايرة احترافية",
    group: "جودة",
  },
  {
    value: "denoise",
    label: "إزالة الضوضاء",
    icon: AudioWaveform,
    desc: "تنقية الصوت من الضوضاء",
    group: "جودة",
  },
  {
    value: "silence-remove",
    label: "حذف الصمت",
    icon: Waves,
    desc: "إزالة الأجزاء الصامتة تلقائياً",
    group: "جودة",
  },
  {
    value: "volume",
    label: "مستوى الصوت",
    icon: Volume2,
    desc: "رفع أو خفض الصوت بـ dB",
    group: "تأثيرات",
  },
  {
    value: "fade",
    label: "تلاشي الصوت",
    icon: Waves,
    desc: "fade in / fade out",
    group: "تأثيرات",
  },
  {
    value: "pitch",
    label: "تغيير النبرة",
    icon: Mic,
    desc: "ارفع أو اخفض النبرة",
    group: "تأثيرات",
  },
  {
    value: "speed",
    label: "تغيير السرعة",
    icon: AudioWaveform,
    desc: "أسرع أو أبطأ بدون تغيير النبرة",
    group: "تأثيرات",
  },
  { value: "echo", label: "تأثير الصدى", icon: Waves, desc: "إضافة صدى احترافي", group: "تأثيرات" },
  { value: "bass", label: "تعزيز الجهير", icon: Music, desc: "زيادة ترددات الباص", group: "EQ" },
  { value: "treble", label: "تعزيز الحدة", icon: Music, desc: "زيادة ترددات الحدة", group: "EQ" },
  {
    value: "eq3band",
    label: "EQ ثلاثي النطاق",
    icon: Settings2,
    desc: "تحكم في الجهير، الوسط، الحدة",
    group: "EQ",
  },
  {
    value: "stereo-mono",
    label: "ستيريو → مونو",
    icon: AudioWaveform,
    desc: "دمج القناتين في قناة واحدة",
    group: "EQ",
  },
];

function AudioPage() {
  const [file, setFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [outputName, setOutputName] = useState("output.mp4");
  const [mode, setMode] = useState<AudioMode>("extract");
  const [busy, setBusy] = useState(false);
  const [loadingFFmpeg, setLoadingFFmpeg] = useState(false);
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);
  const [processMode, setProcessMode] = useState<"local" | "cloud">("local");

  const [volumeDb, setVolumeDb] = useState(3);
  const [fadeInDur, setFadeInDur] = useState(2);
  const [fadeOutDur, setFadeOutDur] = useState(2);
  const [pitchSemitones, setPitchSemitones] = useState(0);
  const [audioSpeed, setAudioSpeed] = useState(1);
  const [denoiseStrength, setDenoiseStrength] = useState(25);
  const [bassGain, setBassGain] = useState(5);
  const [trebleGain, setTrebleGain] = useState(5);
  const [echoDelay, setEchoDelay] = useState(0.5);
  const [echoDecay, setEchoDecay] = useState(0.5);
  const [eqLow, setEqLow] = useState(0);
  const [eqMid, setEqMid] = useState(0);
  const [eqHigh, setEqHigh] = useState(0);
  const [silenceThreshold, setSilenceThreshold] = useState(-50);
  const [silenceDuration, setSilenceDuration] = useState(0.5);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(30);

  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const appendLog = useCallback((m: string) => setLog((p) => (p + "\n" + m).slice(-8000)), []);

  function showToast(msg: string, type: "ok" | "err") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  async function onProcess() {
    if (!file) return;
    if (mode === "replace" && !audioFile) {
      showToast("الرجاء رفع ملف الصوت البديل", "err");
      return;
    }
    setBusy(true);
    setLoadingFFmpeg(true);
    setProgress(0);
    setOutputUrl(null);
    setLog("");
    const logHandler = (m: string) => appendLog(m);

    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "mp4";
      const isAudio = ["mp3", "wav", "aac", "ogg", "flac", "m4a", "opus"].includes(ext);
      const inputName = `input.${ext}`;

      let outName = isAudio ? "output.mp3" : "output.mp4";
      let args: string[] = [];

      if (mode === "extract") {
        outName = "output.mp3";
        args = ["-i", inputName, "-vn", "-acodec", "libmp3lame", "-q:a", "2", outName];
      } else if (mode === "remove") {
        args = ["-i", inputName, "-c:v", "copy", "-an", outName];
      } else if (mode === "replace" && audioFile) {
        const aExt = audioFile.name.split(".").pop() || "mp3";
        args = [
          "-i",
          inputName,
          "-i",
          `music.${aExt}`,
          "-map",
          "0:v",
          "-map",
          "1:a",
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-shortest",
          outName,
        ];
      } else if (mode === "trim") {
        const dur = Math.max(0.1, trimEnd - trimStart);
        args = [
          "-ss",
          String(trimStart),
          "-i",
          inputName,
          "-t",
          String(dur),
          "-c",
          "copy",
          outName,
        ];
      } else if (mode === "normalize") {
        const af = "highpass=f=20,loudnorm=I=-14:TP=-1.5:LRA=9:linear=true";
        args = isAudio
          ? ["-i", inputName, "-af", af, "-c:a", "libmp3lame", "-q:a", "0", outName]
          : ["-i", inputName, "-af", af, "-c:v", "copy", outName];
      } else if (mode === "denoise") {
        const noiseFloor = Math.min(denoiseStrength + 5, 40);
        const af = `highpass=f=80,afftdn=nf=-${noiseFloor}:nt=w:om=o,acompressor=threshold=-18dB:ratio=2:attack=200:release=1000`;
        args = isAudio
          ? ["-i", inputName, "-af", af, "-c:a", "libmp3lame", "-q:a", "0", outName]
          : ["-i", inputName, "-af", af, "-c:v", "copy", outName];
      } else if (mode === "silence-remove") {
        const af = `silenceremove=start_periods=1:start_silence=${silenceDuration}:start_threshold=${silenceThreshold}dB:stop_periods=-1:stop_silence=${silenceDuration}:stop_threshold=${silenceThreshold}dB`;
        args = isAudio
          ? ["-i", inputName, "-af", af, "-c:a", "libmp3lame", "-q:a", "2", outName]
          : ["-i", inputName, "-af", af, "-c:v", "copy", outName];
      } else if (mode === "volume") {
        const af = `volume=${volumeDb}dB`;
        args = isAudio
          ? ["-i", inputName, "-af", af, "-c:a", "libmp3lame", "-q:a", "2", outName]
          : ["-i", inputName, "-af", af, "-c:v", "copy", outName];
      } else if (mode === "fade") {
        const af = `afade=in:st=0:d=${fadeInDur},afade=out:st=0:d=${fadeOutDur}:type=t`;
        args = isAudio
          ? ["-i", inputName, "-af", af, "-c:a", "libmp3lame", "-q:a", "2", outName]
          : ["-i", inputName, "-af", af, "-c:v", "copy", outName];
      } else if (mode === "pitch") {
        const rate = Math.pow(2, pitchSemitones / 12);
        const af = `asetrate=44100*${rate.toFixed(4)},aresample=44100`;
        args = isAudio
          ? ["-i", inputName, "-af", af, "-c:a", "libmp3lame", "-q:a", "2", outName]
          : ["-i", inputName, "-af", af, "-c:v", "copy", outName];
      } else if (mode === "speed") {
        const clamped = Math.max(0.5, Math.min(2, audioSpeed));
        const af = `atempo=${clamped}`;
        args = isAudio
          ? ["-i", inputName, "-af", af, "-c:a", "libmp3lame", "-q:a", "2", outName]
          : ["-i", inputName, "-af", af, "-c:v", "copy", outName];
      } else if (mode === "bass") {
        const af = `equalizer=f=60:t=o:w=100:g=${Math.round(bassGain * 0.5)},equalizer=f=120:t=o:w=180:g=${bassGain},equalizer=f=250:t=o:w=200:g=${Math.round(bassGain * 0.4)}`;
        args = isAudio
          ? ["-i", inputName, "-af", af, "-c:a", "libmp3lame", "-q:a", "0", outName]
          : ["-i", inputName, "-af", af, "-c:v", "copy", outName];
      } else if (mode === "treble") {
        const af = `equalizer=f=5000:t=o:w=3000:g=${Math.round(trebleGain * 0.5)},equalizer=f=10000:t=o:w=5000:g=${trebleGain},equalizer=f=16000:t=o:w=4000:g=${Math.round(trebleGain * 0.6)}`;
        args = isAudio
          ? ["-i", inputName, "-af", af, "-c:a", "libmp3lame", "-q:a", "0", outName]
          : ["-i", inputName, "-af", af, "-c:v", "copy", outName];
      } else if (mode === "eq3band") {
        const filters: string[] = [];
        if (eqLow !== 0) filters.push(`equalizer=f=80:t=o:w=160:g=${Math.round(eqLow * 0.6)},equalizer=f=160:t=o:w=200:g=${eqLow}`);
        if (eqMid !== 0) filters.push(`equalizer=f=800:t=o:w=800:g=${Math.round(eqMid * 0.7)},equalizer=f=2000:t=o:w=1500:g=${eqMid}`);
        if (eqHigh !== 0) filters.push(`equalizer=f=6000:t=o:w=3000:g=${Math.round(eqHigh * 0.6)},equalizer=f=12000:t=o:w=5000:g=${eqHigh}`);
        const af = filters.length > 0 ? filters.join(",") : "acopy";
        args = isAudio
          ? ["-i", inputName, "-af", af, "-c:a", "libmp3lame", "-q:a", "0", outName]
          : ["-i", inputName, "-af", af, "-c:v", "copy", outName];
      } else if (mode === "echo") {
        const d1 = Math.round(echoDelay * 1000);
        const d2 = Math.round(echoDelay * 1600);
        const d3 = Math.round(echoDelay * 2200);
        const af = `aecho=0.75:0.65:${d1}|${d2}|${d3}:${echoDecay}|${(echoDecay * 0.65).toFixed(2)}|${(echoDecay * 0.4).toFixed(2)}`;
        args = isAudio
          ? ["-i", inputName, "-af", af, "-c:a", "libmp3lame", "-q:a", "0", outName]
          : ["-i", inputName, "-af", af, "-c:v", "copy", outName];
      } else if (mode === "stereo-mono") {
        const af = "pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1";
        args = isAudio
          ? ["-i", inputName, "-af", af, "-c:a", "libmp3lame", "-q:a", "0", outName]
          : ["-i", inputName, "-af", af, "-c:v", "copy", outName];
      }

      if (processMode === "cloud" && mode !== "replace") {
        setProgress(20);
        const fd = new FormData();
        fd.append("file", file, inputName);
        fd.append("args", JSON.stringify(args));
        fd.append("outputName", outName);
        const cloudRes = await fetch("/api/cloud-exec", { method: "POST", body: fd });
        if (!cloudRes.ok) throw new Error("خطأ سحابي: " + (await cloudRes.text()).slice(0, 200));
        const resBlob = await cloudRes.blob();
        setProgress(100);
        const mime2 = outName.endsWith(".mp3") ? "audio/mpeg" : "video/mp4";
        setOutputName(outName);
        setOutputUrl(URL.createObjectURL(new Blob([resBlob], { type: mime2 })));
        showToast("✓ اكتملت المعالجة السحابية! ☁", "ok");
      } else {
        if (file.size > 200 * 1024 * 1024) {
          throw new Error("الملف أكبر من 200MB — استخدم وضع السحابة لتجنب امتلاء ذاكرة المتصفح");
        }
        const ffmpeg = await getFFmpeg(logHandler);
        setLoadingFFmpeg(false);
        ffmpeg.on("progress", ({ progress: p }) =>
          setProgress(Math.max(progress, Math.round(p * 100))),
        );
        await ffmpeg.writeFile(inputName, await fetchFile(file));
        if (mode === "replace" && audioFile) {
          const aExt = audioFile.name.split(".").pop() || "mp3";
          await ffmpeg.writeFile(`music.${aExt}`, await fetchFile(audioFile));
        }
        await ffmpeg.exec(args);
        setProgress(100);
        const data = (await ffmpeg.readFile(outName)) as Uint8Array;
        const mime = outName.endsWith(".mp3") ? "audio/mpeg" : "video/mp4";
        setOutputName(outName);
        setOutputUrl(URL.createObjectURL(new Blob([data], { type: mime })));
        showToast("✓ اكتملت المعالجة!", "ok");
        await ffmpeg.deleteFile(inputName).catch(() => {});
        await ffmpeg.deleteFile(outName).catch(() => {});
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e) || "حدث خطأ";
      appendLog("❌ خطأ: " + msg);
      showToast("فشلت العملية: " + msg.slice(0, 80), "err");
      setShowLog(true);
    } finally {
      removeLogHandler(logHandler);
      setBusy(false);
      setLoadingFFmpeg(false);
    }
  }

  const groups = [...new Set(AUDIO_MODES.map((m) => m.group))];
  const selectedMode = AUDIO_MODES.find((m) => m.value === mode);

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      {toast && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-medium shadow-2xl border ${toast.type === "ok" ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300" : "bg-red-500/20 border-red-500/40 text-red-300"}`}
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
          <div className="p-1.5 rounded-lg bg-emerald-500/15">
            <Music className="size-4 text-emerald-400" />
          </div>
          استوديو الصوت
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
            <button
              onClick={() => setProcessMode("local")}
              className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold transition ${processMode === "local" ? "bg-emerald-500/15 text-emerald-400" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Cpu className="size-3" /> محلي (WASM)
            </button>
            <button
              onClick={() => setProcessMode("cloud")}
              className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold transition ${processMode === "cloud" ? "bg-sky-500/15 text-sky-400" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Cloud className="size-3" /> سحابي ☁
            </button>
          </div>
          <span className="text-[10px] text-muted-foreground">
            {processMode === "cloud" ? "يُعالج على السيرفر — مناسب للملفات الكبيرة" : "معالجة في المتصفح — خصوصية تامة"}
          </span>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 py-5 grid gap-5 lg:grid-cols-[1fr_360px]">
        {/* Player */}
        <section className="space-y-4">
          <div className="rounded-2xl border border-border bg-card/50 p-6 flex flex-col items-center justify-center min-h-[220px] gap-4">
            {outputUrl ? (
              <div className="w-full space-y-4">
                {outputName.endsWith(".mp3") ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Music className="size-5 text-emerald-400" /> {outputName}
                    </div>
                    <audio src={outputUrl} controls className="w-full" />
                  </div>
                ) : (
                  <video src={outputUrl} controls className="w-full max-h-64 rounded-xl" />
                )}
                <a
                  href={outputUrl}
                  download={outputName}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 font-semibold text-white hover:opacity-90 transition shadow-lg shadow-emerald-600/20"
                >
                  <Download className="size-4" /> تنزيل الناتج
                </a>
              </div>
            ) : file ? (
              <div className="w-full space-y-3">
                {file.type.startsWith("audio/") ? (
                  <audio src={URL.createObjectURL(file)} controls className="w-full" />
                ) : (
                  <video
                    src={URL.createObjectURL(file)}
                    controls
                    className="w-full max-h-48 rounded-xl"
                  />
                )}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
                  </span>
                  <button
                    onClick={() => inputRef.current?.click()}
                    className="text-primary hover:underline"
                  >
                    تغيير
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => inputRef.current?.click()}
                className="flex flex-col items-center gap-3 text-muted-foreground hover:text-emerald-400 transition p-8 w-full group"
              >
                <div className="rounded-3xl border-2 border-dashed border-current p-7 w-full text-center group-hover:border-emerald-400 transition">
                  <Upload className="size-10 mx-auto mb-2" />
                  <span className="block text-base font-semibold">ارفع فيديو أو ملف صوتي</span>
                  <span className="block text-xs mt-1.5 opacity-60">
                    MP4, MOV, MP3, WAV, AAC, OGG, FLAC, M4A
                  </span>
                </div>
              </button>
            )}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept="video/*,audio/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setFile(f);
                setOutputUrl(null);
              }
            }}
          />

          {mode === "replace" && (
            <div className="rounded-xl border border-border bg-card/60 p-4 space-y-2">
              <p className="text-sm font-semibold flex items-center gap-2">
                <Music2 className="size-4 text-emerald-400" /> ملف الصوت البديل
              </p>
              {audioFile ? (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground truncate">{audioFile.name}</span>
                  <button
                    onClick={() => audioRef.current?.click()}
                    className="text-xs text-primary hover:underline shrink-0"
                  >
                    تغيير
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => audioRef.current?.click()}
                  className="flex items-center gap-2 text-sm text-emerald-400 hover:underline"
                >
                  <Upload className="size-4" /> رفع ملف صوت
                </button>
              )}
              <input
                ref={audioRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setAudioFile(f);
                }}
              />
            </div>
          )}

          {busy && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin text-emerald-400" />
                  <span>{loadingFFmpeg ? "جاري تحميل FFmpeg..." : "جاري المعالجة..."}</span>
                </div>
                <span className="font-mono text-emerald-400 font-bold">
                  {loadingFFmpeg ? "..." : `${progress}%`}
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500 rounded-full"
                  style={{ width: `${loadingFFmpeg ? 8 : Math.max(4, progress)}%` }}
                />
              </div>
            </div>
          )}

          {log && (
            <div className="rounded-xl border border-border bg-card/60">
              <button
                onClick={() => setShowLog(!showLog)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm text-muted-foreground"
              >
                <span className="flex items-center gap-2">
                  <Settings2 className="size-3.5" /> سجل FFmpeg
                </span>
                <ChevronRight
                  className={`size-4 transition-transform ${showLog ? "rotate-90" : ""}`}
                />
              </button>
              {showLog && (
                <pre className="px-4 pb-4 text-xs whitespace-pre-wrap text-muted-foreground max-h-40 overflow-auto font-mono border-t border-border/50 pt-3">
                  {log}
                </pre>
              )}
            </div>
          )}
        </section>

        {/* Controls */}
        <aside className="space-y-4">
          <div className="rounded-2xl border border-border bg-card/60 p-3 space-y-3">
            <h2 className="text-sm font-bold px-1">نوع المعالجة</h2>
            {groups.map((group) => (
              <div key={group}>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium px-1 mb-1">
                  {group}
                </p>
                <div className="space-y-1">
                  {AUDIO_MODES.filter((m) => m.group === group).map((m) => (
                    <button
                      key={m.value}
                      onClick={() => setMode(m.value)}
                      className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-medium transition text-right ${mode === m.value ? "bg-emerald-600/20 text-emerald-300 border border-emerald-500/30" : "bg-background/60 border border-border hover:bg-secondary text-muted-foreground"}`}
                    >
                      <m.icon className="size-3.5 shrink-0" />
                      <span className="flex-1 font-semibold">{m.label}</span>
                      <span className="opacity-50 text-[10px] truncate hidden sm:block">
                        {m.desc}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Mode Settings */}
          {mode === "volume" && (
            <Card title="مستوى الصوت">
              <Slider
                label={`رفع/خفض: ${volumeDb > 0 ? "+" : ""}${volumeDb} dB`}
                value={volumeDb}
                min={-30}
                max={30}
                step={1}
                onChange={setVolumeDb}
                display={(volumeDb > 0 ? "+" : "") + volumeDb + " dB"}
              />
              <div className="grid grid-cols-4 gap-1">
                {[-10, -6, 6, 10].map((v) => (
                  <button
                    key={v}
                    onClick={() => setVolumeDb(v)}
                    className="rounded-lg py-1 text-[10px] border border-border hover:bg-secondary text-muted-foreground"
                  >
                    {v > 0 ? "+" : ""}
                    {v}dB
                  </button>
                ))}
              </div>
            </Card>
          )}

          {mode === "fade" && (
            <Card title="إعدادات التلاشي">
              <Slider
                label={`Fade In: ${fadeInDur}ث`}
                value={fadeInDur}
                min={0}
                max={10}
                step={0.5}
                onChange={setFadeInDur}
                display={fadeInDur + "ث"}
              />
              <Slider
                label={`Fade Out: ${fadeOutDur}ث`}
                value={fadeOutDur}
                min={0}
                max={10}
                step={0.5}
                onChange={setFadeOutDur}
                display={fadeOutDur + "ث"}
              />
            </Card>
          )}

          {mode === "pitch" && (
            <Card title="طبقة الصوت">
              <Slider
                label={`النبرة: ${pitchSemitones > 0 ? "+" : ""}${pitchSemitones}`}
                value={pitchSemitones}
                min={-12}
                max={12}
                step={1}
                onChange={setPitchSemitones}
                display={(pitchSemitones > 0 ? "+" : "") + pitchSemitones + " نغمة"}
              />
              <p className="text-[11px] text-muted-foreground">
                +12 = أوكتاف أعلى · -12 = أوكتاف أخفض
              </p>
              <div className="grid grid-cols-5 gap-1">
                {[-12, -6, 0, 6, 12].map((v) => (
                  <button
                    key={v}
                    onClick={() => setPitchSemitones(v)}
                    className={`rounded-lg py-1 text-[10px] transition ${pitchSemitones === v ? "bg-emerald-600 text-white" : "border border-border hover:bg-secondary text-muted-foreground"}`}
                  >
                    {v > 0 ? "+" : ""}
                    {v}
                  </button>
                ))}
              </div>
            </Card>
          )}

          {mode === "speed" && (
            <Card title="سرعة الصوت">
              <Slider
                label={`السرعة: ${audioSpeed.toFixed(2)}x`}
                value={audioSpeed}
                min={0.5}
                max={2}
                step={0.05}
                onChange={setAudioSpeed}
                display={audioSpeed.toFixed(2) + "x"}
              />
              <div className="grid grid-cols-4 gap-1">
                {[0.5, 0.75, 1.5, 2].map((v) => (
                  <button
                    key={v}
                    onClick={() => setAudioSpeed(v)}
                    className={`rounded-lg py-1 text-[10px] transition ${audioSpeed === v ? "bg-emerald-600 text-white" : "border border-border hover:bg-secondary text-muted-foreground"}`}
                  >
                    {v}x
                  </button>
                ))}
              </div>
            </Card>
          )}

          {mode === "denoise" && (
            <Card title="إزالة الضوضاء">
              <Slider
                label={`قوة التصفية: -${denoiseStrength} dB`}
                value={denoiseStrength}
                min={10}
                max={50}
                step={5}
                onChange={setDenoiseStrength}
                display={"-" + denoiseStrength + " dB"}
              />
              <p className="text-[11px] text-muted-foreground">
                -25 dB = ضوضاء متوسطة. -40 dB فأكثر لضوضاء شديدة.
              </p>
            </Card>
          )}

          {mode === "bass" && (
            <Card title="تعزيز الجهير (Bass Boost)">
              <Slider
                label={`الجهير: +${bassGain} dB`}
                value={bassGain}
                min={0}
                max={20}
                step={1}
                onChange={setBassGain}
                display={"+" + bassGain + " dB"}
              />
            </Card>
          )}

          {mode === "treble" && (
            <Card title="تعزيز الحدة (Treble Boost)">
              <Slider
                label={`الحدة: +${trebleGain} dB`}
                value={trebleGain}
                min={0}
                max={20}
                step={1}
                onChange={setTrebleGain}
                display={"+" + trebleGain + " dB"}
              />
            </Card>
          )}

          {mode === "eq3band" && (
            <Card title="Equalizer ثلاثي النطاق">
              <Slider
                label={`جهير (100Hz): ${eqLow > 0 ? "+" : ""}${eqLow} dB`}
                value={eqLow}
                min={-15}
                max={15}
                step={1}
                onChange={setEqLow}
                display={(eqLow > 0 ? "+" : "") + eqLow + " dB"}
              />
              <Slider
                label={`وسط (1kHz): ${eqMid > 0 ? "+" : ""}${eqMid} dB`}
                value={eqMid}
                min={-15}
                max={15}
                step={1}
                onChange={setEqMid}
                display={(eqMid > 0 ? "+" : "") + eqMid + " dB"}
              />
              <Slider
                label={`حدة (8kHz): ${eqHigh > 0 ? "+" : ""}${eqHigh} dB`}
                value={eqHigh}
                min={-15}
                max={15}
                step={1}
                onChange={setEqHigh}
                display={(eqHigh > 0 ? "+" : "") + eqHigh + " dB"}
              />
              <button
                onClick={() => {
                  setEqLow(0);
                  setEqMid(0);
                  setEqHigh(0);
                }}
                className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <RefreshCw className="size-3" /> إعادة تعيين
              </button>
            </Card>
          )}

          {mode === "echo" && (
            <Card title="تأثير الصدى">
              <Slider
                label={`التأخير: ${echoDelay}ث`}
                value={echoDelay}
                min={0.1}
                max={1.5}
                step={0.1}
                onChange={setEchoDelay}
                display={echoDelay + "ث"}
              />
              <Slider
                label={`التلاشي: ${echoDecay}`}
                value={echoDecay}
                min={0.1}
                max={0.9}
                step={0.1}
                onChange={setEchoDecay}
                display={String(echoDecay)}
              />
            </Card>
          )}

          {mode === "silence-remove" && (
            <Card title="إزالة الصمت التلقائي">
              <Slider
                label={`حد الصمت: ${silenceThreshold} dB`}
                value={silenceThreshold}
                min={-70}
                max={-20}
                step={5}
                onChange={setSilenceThreshold}
                display={silenceThreshold + " dB"}
              />
              <Slider
                label={`مدة الصمت: ${silenceDuration}ث`}
                value={silenceDuration}
                min={0.1}
                max={2}
                step={0.1}
                onChange={setSilenceDuration}
                display={silenceDuration + "ث"}
              />
            </Card>
          )}

          {mode === "trim" && (
            <Card title="قص الصوت">
              <NumInput label="من (ثانية)" value={trimStart} onChange={setTrimStart} />
              <NumInput label="إلى (ثانية)" value={trimEnd} onChange={setTrimEnd} />
              <p className="text-[11px] text-muted-foreground">
                المدة: {Math.max(0, trimEnd - trimStart).toFixed(1)} ثانية
              </p>
            </Card>
          )}

          <button
            onClick={onProcess}
            disabled={!file || busy}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-3.5 font-bold text-white hover:opacity-90 transition disabled:opacity-40 shadow-lg shadow-emerald-600/20 text-sm"
          >
            {busy ? <Loader2 className="size-5 animate-spin" /> : <Music className="size-5" />}
            {busy
              ? loadingFFmpeg
                ? "جاري تحميل FFmpeg..."
                : `معالجة... ${progress}%`
              : `تطبيق: ${selectedMode?.label}`}
          </button>
        </aside>
      </main>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
      <h3 className="text-sm font-bold">{title}</h3>
      {children}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display: string;
}) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-foreground font-medium">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-emerald-500"
      />
    </div>
  );
}

function NumInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full mt-1 rounded-lg bg-input border border-border px-3 py-2 text-sm font-mono"
      />
    </label>
  );
}
