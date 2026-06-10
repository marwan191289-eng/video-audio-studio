import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState, useCallback } from "react";
import { fetchFile } from "@ffmpeg/util";
import { getFFmpeg, removeLogHandler } from "@/lib/ffmpeg-client";
import {
  ArrowRight, Upload, Download, Loader2, Music, Volume2, Mic,
  Waves, Music2, AudioWaveform,
} from "lucide-react";

export const Route = createFileRoute("/audio")({
  head: () => ({
    meta: [
      { title: "استوديو الصوت — Video Enhancer Pro" },
      { name: "description", content: "تحسين الصوت، إزالة الضوضاء، استخراج، استبدال، تطبيع، تغيير النبرة." },
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
  | "treble";

const AUDIO_MODES: { value: AudioMode; label: string; icon: React.ElementType; desc: string }[] = [
  { value: "extract", label: "استخراج الصوت", icon: Music, desc: "استخرج الصوت كـ MP3" },
  { value: "remove", label: "إزالة الصوت", icon: Volume2, desc: "احذف الصوت من الفيديو" },
  { value: "replace", label: "استبدال الصوت", icon: Music2, desc: "استبدل الصوت بملف آخر" },
  { value: "normalize", label: "تطبيع المستوى", icon: Waves, desc: "EBU R128 loudnorm" },
  { value: "denoise", label: "إزالة ضوضاء الصوت", icon: AudioWaveform, desc: "تنقية الصوت من الضوضاء" },
  { value: "volume", label: "رفع/خفض الصوت", icon: Volume2, desc: "تعديل مستوى الصوت" },
  { value: "fade", label: "تلاشي الصوت", icon: Waves, desc: "fade in / fade out" },
  { value: "pitch", label: "تغيير طبقة الصوت", icon: Mic, desc: "ارفع أو اخفض النبرة" },
  { value: "speed", label: "تغيير سرعة الصوت", icon: AudioWaveform, desc: "أسرع أو أبطأ بدون تغيير النبرة" },
  { value: "bass", label: "تعزيز الجهير (Bass)", icon: Music, desc: "زيادة ترددات الجهير" },
  { value: "treble", label: "تعزيز الحدة (Treble)", icon: Music, desc: "زيادة ترددات الحدة" },
  { value: "echo", label: "إضافة صدى (Echo)", icon: Waves, desc: "إضافة تأثير صدى للصوت" },
];

function AudioPage() {
  const [file, setFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null);
  const [outputName, setOutputName] = useState("output.mp4");
  const [mode, setMode] = useState<AudioMode>("extract");
  const [busy, setBusy] = useState(false);
  const [loadingFFmpeg, setLoadingFFmpeg] = useState(false);
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState("");

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

  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);

  const appendLog = useCallback((m: string) => setLog((p) => (p + "\n" + m).slice(-4000)), []);

  async function onProcess() {
    if (!file) return;
    if (mode === "replace" && !audioFile) {
      alert("الرجاء رفع ملف الصوت البديل أولاً");
      return;
    }
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
      ffmpeg.on("progress", ({ progress: p }) => setProgress(Math.round(p * 100)));

      const ext = file.name.split(".").pop() || "mp4";
      const isAudioOnly = ["mp3", "wav", "aac", "ogg", "flac", "m4a"].includes(ext.toLowerCase());
      const inputName = `input.${ext}`;
      await ffmpeg.writeFile(inputName, await fetchFile(file));

      if (audioFile) {
        const aExt = audioFile.name.split(".").pop() || "mp3";
        await ffmpeg.writeFile(`music.${aExt}`, await fetchFile(audioFile));
      }

      let outName = isAudioOnly ? "output.mp3" : "output.mp4";
      let args: string[] = [];

      if (mode === "extract") {
        outName = "output.mp3";
        args = ["-i", inputName, "-vn", "-acodec", "libmp3lame", "-q:a", "2", outName];
      } else if (mode === "remove") {
        args = ["-i", inputName, "-c", "copy", "-an", outName];
      } else if (mode === "replace" && audioFile) {
        const aExt = audioFile.name.split(".").pop() || "mp3";
        args = ["-i", inputName, "-i", `music.${aExt}`, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-shortest", outName];
      } else if (mode === "normalize") {
        const af = "loudnorm=I=-16:TP=-1.5:LRA=11";
        args = isAudioOnly
          ? ["-i", inputName, "-af", af, outName]
          : ["-i", inputName, "-af", af, "-c:v", "copy", outName];
      } else if (mode === "denoise") {
        const af = `afftdn=nf=-${denoiseStrength}`;
        args = isAudioOnly
          ? ["-i", inputName, "-af", af, outName]
          : ["-i", inputName, "-af", af, "-c:v", "copy", outName];
      } else if (mode === "volume") {
        const af = `volume=${volumeDb}dB`;
        args = isAudioOnly
          ? ["-i", inputName, "-af", af, outName]
          : ["-i", inputName, "-af", af, "-c:v", "copy", outName];
      } else if (mode === "fade") {
        const af = `afade=in:st=0:d=${fadeInDur},afade=out:st=0:d=${fadeOutDur}:type=t`;
        args = isAudioOnly
          ? ["-i", inputName, "-af", af, outName]
          : ["-i", inputName, "-af", af, "-c:v", "copy", outName];
      } else if (mode === "pitch") {
        const rate = Math.pow(2, pitchSemitones / 12);
        const af = `asetrate=44100*${rate.toFixed(4)},aresample=44100`;
        args = isAudioOnly
          ? ["-i", inputName, "-af", af, outName]
          : ["-i", inputName, "-af", af, "-c:v", "copy", outName];
      } else if (mode === "speed") {
        const clamped = Math.max(0.5, Math.min(2, audioSpeed));
        const af = `atempo=${clamped}`;
        args = isAudioOnly
          ? ["-i", inputName, "-af", af, outName]
          : ["-i", inputName, "-af", af, "-c:v", "copy", outName];
      } else if (mode === "bass") {
        const af = `equalizer=f=100:t=o:w=200:g=${bassGain}`;
        args = isAudioOnly
          ? ["-i", inputName, "-af", af, outName]
          : ["-i", inputName, "-af", af, "-c:v", "copy", outName];
      } else if (mode === "treble") {
        const af = `equalizer=f=8000:t=o:w=4000:g=${trebleGain}`;
        args = isAudioOnly
          ? ["-i", inputName, "-af", af, outName]
          : ["-i", inputName, "-af", af, "-c:v", "copy", outName];
      } else if (mode === "echo") {
        const af = `aecho=0.8:0.88:${Math.round(echoDelay * 1000)}:${echoDecay}`;
        args = isAudioOnly
          ? ["-i", inputName, "-af", af, outName]
          : ["-i", inputName, "-af", af, "-c:v", "copy", outName];
      }

      await ffmpeg.exec(args);
      const data = (await ffmpeg.readFile(outName)) as Uint8Array;
      const mime = outName.endsWith(".mp3") ? "audio/mpeg" : "video/mp4";
      const blob = new Blob([data.buffer as ArrayBuffer], { type: mime });
      setOutputBlob(blob);
      setOutputName(outName);
      setOutputUrl(URL.createObjectURL(blob));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e) || "حدث خطأ غير معروف";
      setLog((p) => p + "\n❌ خطأ: " + msg);
    } finally {
      removeLogHandler(logHandler);
      setBusy(false);
      setLoadingFFmpeg(false);
    }
  }

  const selectedMode = AUDIO_MODES.find((m) => m.value === mode);

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 border-b border-border sticky top-0 z-40 bg-background/90 backdrop-blur-sm">
        <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowRight className="size-4" /> الرئيسية
        </Link>
        <div className="flex items-center gap-2 font-semibold text-sm">
          <Music className="size-4 text-emerald-400" />
          استوديو الصوت
        </div>
        <Link to="/enhance" className="text-sm hover:text-primary">المحرر</Link>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Player */}
        <section className="space-y-4">
          <div className="rounded-2xl border border-border bg-card/60 p-8 flex flex-col items-center justify-center min-h-[260px] gap-4">
            {outputUrl ? (
              <div className="w-full space-y-4">
                {outputName.endsWith(".mp3") ? (
                  <audio src={outputUrl} controls className="w-full" />
                ) : (
                  <video src={outputUrl} controls className="w-full max-h-64 rounded-xl" />
                )}
                <div className="flex justify-center gap-3">
                  <a
                    href={outputUrl}
                    download={outputName}
                    className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-semibold text-primary-foreground hover:opacity-90 transition"
                  >
                    <Download className="size-4" /> تنزيل
                  </a>
                </div>
              </div>
            ) : file ? (
              <div className="w-full space-y-3">
                {file.type.startsWith("audio/") ? (
                  <audio src={URL.createObjectURL(file)} controls className="w-full" />
                ) : (
                  <video src={URL.createObjectURL(file)} controls className="w-full max-h-48 rounded-xl" />
                )}
                <p className="text-xs text-muted-foreground text-center">{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</p>
              </div>
            ) : (
              <button
                onClick={() => inputRef.current?.click()}
                className="flex flex-col items-center gap-3 text-muted-foreground hover:text-primary transition p-8 w-full"
              >
                <div className="rounded-2xl border-2 border-dashed border-current p-6 w-full">
                  <Upload className="size-10 mx-auto mb-2" />
                  <span className="block text-base font-medium text-center">ارفع فيديو أو ملف صوتي</span>
                  <span className="block text-xs mt-1 opacity-60 text-center">MP4, MOV, MP3, WAV, AAC, OGG, FLAC</span>
                </div>
              </button>
            )}
          </div>

          <input ref={inputRef} type="file" accept="video/*,audio/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setOutputUrl(null); } }} />

          {mode === "replace" && (
            <div className="rounded-xl border border-border bg-card/60 p-4 space-y-2">
              <p className="text-sm font-medium">ملف الصوت البديل</p>
              {audioFile ? (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{audioFile.name}</span>
                  <button onClick={() => audioRef.current?.click()} className="text-xs text-primary hover:underline">تغيير</button>
                </div>
              ) : (
                <button
                  onClick={() => audioRef.current?.click()}
                  className="flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <Upload className="size-4" /> رفع ملف صوت
                </button>
              )}
              <input ref={audioRef} type="file" accept="audio/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) setAudioFile(f); }} />
            </div>
          )}

          {busy && (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-sm mb-2">
                <Loader2 className="size-4 animate-spin text-emerald-400" />
                {loadingFFmpeg ? "جاري تحميل محرك FFmpeg..." : `جاري المعالجة... ${progress}%`}
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all rounded-full" style={{ width: `${loadingFFmpeg ? 5 : progress}%` }} />
              </div>
            </div>
          )}

          {log && (
            <details className="rounded-xl border border-border bg-card/60 p-3">
              <summary className="cursor-pointer text-sm text-muted-foreground">سجل FFmpeg</summary>
              <pre className="mt-2 text-xs whitespace-pre-wrap text-muted-foreground max-h-40 overflow-auto font-mono">{log}</pre>
            </details>
          )}
        </section>

        {/* Controls */}
        <aside className="space-y-4">
          <div className="rounded-2xl border border-border bg-card/60 p-4">
            <label className="text-sm font-semibold block mb-3">نوع المعالجة</label>
            <div className="grid grid-cols-1 gap-1.5">
              {AUDIO_MODES.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setMode(m.value)}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-medium transition text-right ${
                    mode === m.value
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : "bg-background/60 border border-border hover:bg-secondary text-muted-foreground"
                  }`}
                >
                  <m.icon className="size-3.5 shrink-0" />
                  <span className="flex-1">{m.label}</span>
                  <span className="text-[10px] opacity-60">{m.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {mode === "volume" && (
            <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
              <h3 className="text-sm font-semibold">مستوى الصوت</h3>
              <Slider label={`رفع/خفض الصوت: ${volumeDb > 0 ? "+" : ""}${volumeDb} dB`} value={volumeDb} min={-20} max={20} step={1} onChange={setVolumeDb} display={(volumeDb > 0 ? "+" : "") + volumeDb + " dB"} />
            </div>
          )}

          {mode === "fade" && (
            <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
              <h3 className="text-sm font-semibold">إعدادات التلاشي</h3>
              <Slider label={`Fade In: ${fadeInDur}ث`} value={fadeInDur} min={0} max={10} step={0.5} onChange={setFadeInDur} display={fadeInDur + "ث"} />
              <Slider label={`Fade Out: ${fadeOutDur}ث`} value={fadeOutDur} min={0} max={10} step={0.5} onChange={setFadeOutDur} display={fadeOutDur + "ث"} />
            </div>
          )}

          {mode === "pitch" && (
            <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
              <h3 className="text-sm font-semibold">طبقة الصوت</h3>
              <Slider label={`النبرة: ${pitchSemitones > 0 ? "+" : ""}${pitchSemitones} semitone`} value={pitchSemitones} min={-12} max={12} step={1} onChange={setPitchSemitones} display={(pitchSemitones > 0 ? "+" : "") + pitchSemitones} />
              <p className="text-xs text-muted-foreground">+12 = أعلى أوكتاف · -12 = أخفض أوكتاف</p>
            </div>
          )}

          {mode === "speed" && (
            <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
              <h3 className="text-sm font-semibold">سرعة الصوت</h3>
              <Slider label={`السرعة: ${audioSpeed.toFixed(2)}x`} value={audioSpeed} min={0.5} max={2} step={0.05} onChange={setAudioSpeed} display={audioSpeed.toFixed(2) + "x"} />
            </div>
          )}

          {mode === "denoise" && (
            <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
              <h3 className="text-sm font-semibold">قوة تنقية الصوت</h3>
              <Slider label={`مستوى التصفية: -${denoiseStrength} dB`} value={denoiseStrength} min={10} max={50} step={5} onChange={setDenoiseStrength} display={"-" + denoiseStrength + " dB"} />
              <p className="text-xs text-muted-foreground">-25 dB مناسب للضوضاء المعتدلة. كلما زاد الرقم زاد الحذف.</p>
            </div>
          )}

          {mode === "bass" && (
            <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
              <h3 className="text-sm font-semibold">تعزيز الجهير</h3>
              <Slider label={`الجهير: +${bassGain} dB`} value={bassGain} min={0} max={20} step={1} onChange={setBassGain} display={"+" + bassGain + " dB"} />
            </div>
          )}

          {mode === "treble" && (
            <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
              <h3 className="text-sm font-semibold">تعزيز الحدة</h3>
              <Slider label={`الحدة: +${trebleGain} dB`} value={trebleGain} min={0} max={20} step={1} onChange={setTrebleGain} display={"+" + trebleGain + " dB"} />
            </div>
          )}

          {mode === "echo" && (
            <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
              <h3 className="text-sm font-semibold">إعدادات الصدى</h3>
              <Slider label={`التأخير: ${echoDelay}ث`} value={echoDelay} min={0.1} max={1.5} step={0.1} onChange={setEchoDelay} display={echoDelay + "ث"} />
              <Slider label={`التلاشي: ${echoDecay}`} value={echoDecay} min={0.1} max={0.9} step={0.1} onChange={setEchoDecay} display={String(echoDecay)} />
            </div>
          )}

          <button
            onClick={onProcess}
            disabled={!file || busy}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-3.5 font-semibold text-white hover:opacity-90 transition disabled:opacity-40 shadow-lg shadow-emerald-600/20"
          >
            {busy ? <Loader2 className="size-5 animate-spin" /> : <Music className="size-5" />}
            {busy ? (loadingFFmpeg ? "جاري تحميل FFmpeg..." : "جاري المعالجة...") : selectedMode?.label}
          </button>

          <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-3">
            <p className="text-xs text-muted-foreground">
              <strong className="text-emerald-400">تيب:</strong> يمكنك رفع ملف صوتي مباشرة (MP3, WAV, AAC) أو فيديو للمعالجة الصوتية.
            </p>
          </div>
        </aside>
      </main>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, display }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; display: string;
}) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-foreground">{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-emerald-500" />
    </div>
  );
}
