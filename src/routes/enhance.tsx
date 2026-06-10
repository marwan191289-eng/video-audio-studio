import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { fetchFile } from "@ffmpeg/util";
import { getFFmpeg } from "@/lib/ffmpeg-client";
import { supabase } from "@/integrations/supabase/client";
import { ArrowRight, Upload, Wand2, Download, Save, Loader2 } from "lucide-react";

export const Route = createFileRoute("/enhance")({
  head: () => ({
    meta: [
      { title: "محرر الفيديو — Video Enhancer Pro" },
      { name: "description", content: "حسّن الفيديو، عدّل الصوت، واستخرج المقاطع مباشرة في المتصفح." },
    ],
  }),
  component: EnhancePage,
});

type Mode = "enhance" | "extract-audio" | "remove-audio" | "speed" | "trim";

function EnhancePage() {
  const [file, setFile] = useState<File | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null);
  const [outputName, setOutputName] = useState<string>("output.mp4");
  const [mode, setMode] = useState<Mode>("enhance");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // Enhance params
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(1);
  const [saturation, setSaturation] = useState(1);
  const [sharpness, setSharpness] = useState(0.5);
  const [denoise, setDenoise] = useState(false);

  // Speed / trim
  const [speed, setSpeed] = useState(1);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(10);

  const inputRef = useRef<HTMLInputElement>(null);

  async function onProcess() {
    if (!file) return;
    setBusy(true);
    setProgress(0);
    setOutputUrl(null);
    setOutputBlob(null);
    setLog("");

    try {
      const ffmpeg = await getFFmpeg((m) => setLog((p) => (p + "\n" + m).slice(-2000)));
      ffmpeg.on("progress", ({ progress }) => setProgress(Math.round(progress * 100)));

      const inputName = "input." + (file.name.split(".").pop() || "mp4");
      await ffmpeg.writeFile(inputName, await fetchFile(file));

      let outName = "output.mp4";
      let args: string[] = [];

      if (mode === "enhance") {
        const filters: string[] = [];
        filters.push(`eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}`);
        if (sharpness > 0) filters.push(`unsharp=5:5:${sharpness.toFixed(2)}`);
        if (denoise) filters.push("hqdn3d=4:3:6:4.5");
        args = ["-i", inputName, "-vf", filters.join(","), "-c:a", "copy", "-preset", "ultrafast", outName];
      } else if (mode === "extract-audio") {
        outName = "output.mp3";
        args = ["-i", inputName, "-vn", "-acodec", "libmp3lame", "-q:a", "2", outName];
      } else if (mode === "remove-audio") {
        args = ["-i", inputName, "-c", "copy", "-an", outName];
      } else if (mode === "speed") {
        // setpts for video, atempo for audio (atempo is 0.5-2.0; chain for extreme values)
        const atempo = Math.max(0.5, Math.min(2, speed));
        args = [
          "-i", inputName,
          "-filter_complex",
          `[0:v]setpts=${(1 / speed).toFixed(4)}*PTS[v];[0:a]atempo=${atempo}[a]`,
          "-map", "[v]", "-map", "[a]", "-preset", "ultrafast", outName,
        ];
      } else if (mode === "trim") {
        const dur = Math.max(0.1, trimEnd - trimStart);
        args = ["-ss", String(trimStart), "-i", inputName, "-t", String(dur), "-c", "copy", outName];
      }

      await ffmpeg.exec(args);
      const data = (await ffmpeg.readFile(outName)) as Uint8Array;
      const mime = outName.endsWith(".mp3") ? "audio/mpeg" : "video/mp4";
      const blob = new Blob([data.buffer as ArrayBuffer], { type: mime });
      setOutputBlob(blob);
      setOutputName(outName);
      setOutputUrl(URL.createObjectURL(blob));
    } catch (e) {
      console.error(e);
      setLog((p) => p + "\nERROR: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onSaveToCloud() {
    if (!outputBlob) return;
    setSaving(true);
    try {
      const id = crypto.randomUUID();
      const path = `${id}-${outputName}`;
      const { error: upErr } = await supabase.storage.from("videos").upload(path, outputBlob, {
        contentType: outputBlob.type,
        upsert: false,
      });
      if (upErr) throw upErr;
      const { error: dbErr } = await supabase.from("processed_videos").insert({
        name: outputName,
        storage_path: path,
        size_bytes: outputBlob.size,
        settings: { mode, brightness, contrast, saturation, sharpness, denoise, speed },
      });
      if (dbErr) throw dbErr;
      alert("تم الحفظ في مكتبتك ✓");
    } catch (e) {
      alert("فشل الحفظ: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 border-b border-border">
        <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowRight className="size-4" />
          الرئيسية
        </Link>
        <Link to="/library" className="text-sm hover:text-primary">مكتبتي</Link>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8 grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Preview */}
        <section className="space-y-4">
          <div className="rounded-xl border border-border bg-card overflow-hidden aspect-video flex items-center justify-center">
            {outputUrl ? (
              outputName.endsWith(".mp3") ? (
                <audio src={outputUrl} controls className="w-full" />
              ) : (
                <video src={outputUrl} controls className="w-full h-full" />
              )
            ) : file ? (
              <video src={URL.createObjectURL(file)} controls className="w-full h-full" />
            ) : (
              <button
                onClick={() => inputRef.current?.click()}
                className="flex flex-col items-center gap-3 text-muted-foreground hover:text-primary transition p-12"
              >
                <Upload className="size-12" />
                <span>اضغط لاختيار فيديو</span>
                <span className="text-xs">يفضّل أقل من 100MB للأداء الأفضل</span>
              </button>
            )}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setFile(f);
                setOutputUrl(null);
                setOutputBlob(null);
              }
            }}
          />

          {file && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground truncate">{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</span>
              <button onClick={() => inputRef.current?.click()} className="text-primary hover:underline">تغيير</button>
            </div>
          )}

          {busy && (
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-sm mb-2">
                <Loader2 className="size-4 animate-spin text-primary" />
                جاري المعالجة... {progress}%
              </div>
              <div className="h-2 bg-muted rounded overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {outputUrl && (
            <div className="flex gap-2">
              <a
                href={outputUrl}
                download={outputName}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground"
              >
                <Download className="size-4" />
                تنزيل
              </a>
              <button
                onClick={onSaveToCloud}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 font-semibold hover:bg-secondary disabled:opacity-50"
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                حفظ في مكتبتي
              </button>
            </div>
          )}

          {log && (
            <details className="rounded-lg border border-border bg-card p-3">
              <summary className="cursor-pointer text-sm text-muted-foreground">سجل FFmpeg</summary>
              <pre className="mt-2 text-xs whitespace-pre-wrap text-muted-foreground max-h-40 overflow-auto">{log}</pre>
            </details>
          )}
        </section>

        {/* Controls */}
        <aside className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <label className="text-sm font-semibold block mb-2">العملية</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
              className="w-full rounded-lg bg-input border border-border px-3 py-2 text-sm"
            >
              <option value="enhance">تحسين الجودة (سطوع/حدّة/ضوضاء)</option>
              <option value="extract-audio">استخراج الصوت (MP3)</option>
              <option value="remove-audio">إزالة الصوت</option>
              <option value="speed">تغيير السرعة</option>
              <option value="trim">قص مقطع</option>
            </select>
          </div>

          {mode === "enhance" && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <Slider label="السطوع" value={brightness} min={-1} max={1} step={0.05} onChange={setBrightness} />
              <Slider label="التباين" value={contrast} min={0} max={2} step={0.05} onChange={setContrast} />
              <Slider label="التشبع" value={saturation} min={0} max={3} step={0.1} onChange={setSaturation} />
              <Slider label="الحدّة" value={sharpness} min={0} max={2} step={0.1} onChange={setSharpness} />
              <label className="flex items-center gap-2 text-sm pt-2">
                <input type="checkbox" checked={denoise} onChange={(e) => setDenoise(e.target.checked)} />
                تقليل الضوضاء (hqdn3d)
              </label>
            </div>
          )}

          {mode === "speed" && (
            <div className="rounded-xl border border-border bg-card p-4">
              <Slider label={`السرعة (${speed.toFixed(2)}x)`} value={speed} min={0.5} max={2} step={0.05} onChange={setSpeed} />
            </div>
          )}

          {mode === "trim" && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <NumInput label="من (ثانية)" value={trimStart} onChange={setTrimStart} />
              <NumInput label="إلى (ثانية)" value={trimEnd} onChange={setTrimEnd} />
            </div>
          )}

          <button
            onClick={onProcess}
            disabled={!file || busy}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground hover:opacity-90 transition disabled:opacity-40"
          >
            <Wand2 className="size-5" />
            {busy ? "جاري المعالجة..." : "ابدأ المعالجة"}
          </button>

          <p className="text-xs text-muted-foreground text-center">
            تجري المعالجة محلياً في متصفحك باستخدام FFmpeg.wasm.
          </p>
        </aside>
      </main>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span>{label}</span>
        <span className="text-muted-foreground">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-[oklch(0.72_0.18_160)]"
      />
    </div>
  );
}

function NumInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full mt-1 rounded-lg bg-input border border-border px-3 py-2 text-sm"
      />
    </label>
  );
}