import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState, useCallback } from "react";
import { fetchFile } from "@ffmpeg/util";
import { getFFmpeg, removeLogHandler } from "@/lib/ffmpeg-client";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowRight, Upload, Wand2, Download, Save, Loader2, RotateCcw,
  Scissors, Zap, FlipHorizontal, Volume2, VolumeX, Film, RefreshCw,
} from "lucide-react";

export const Route = createFileRoute("/enhance")({
  head: () => ({
    meta: [
      { title: "محرر الفيديو — Video Enhancer Pro" },
      { name: "description", content: "محرر فيديو شامل: تحسين الجودة، قص، دمج، تسريع، إزالة ضوضاء." },
    ],
  }),
  component: EnhancePage,
});

type Mode =
  | "enhance"
  | "extract-audio"
  | "remove-audio"
  | "speed"
  | "trim"
  | "crop"
  | "rotate"
  | "flip"
  | "reverse"
  | "denoise"
  | "compress"
  | "upscale"
  | "fps"
  | "gif"
  | "thumbnail";

const MODES: { value: Mode; label: string; icon: React.ElementType }[] = [
  { value: "enhance", label: "تحسين الجودة", icon: Wand2 },
  { value: "denoise", label: "إزالة الضوضاء", icon: Zap },
  { value: "speed", label: "تغيير السرعة", icon: Zap },
  { value: "trim", label: "قص مقطع", icon: Scissors },
  { value: "crop", label: "اقتصاص", icon: Film },
  { value: "rotate", label: "تدوير/قلب", icon: RotateCcw },
  { value: "reverse", label: "عكس الفيديو", icon: RefreshCw },
  { value: "extract-audio", label: "استخراج الصوت", icon: Volume2 },
  { value: "remove-audio", label: "إزالة الصوت", icon: VolumeX },
  { value: "compress", label: "ضغط الفيديو", icon: Film },
  { value: "upscale", label: "ترقية الدقة", icon: Wand2 },
  { value: "fps", label: "تغيير FPS", icon: Film },
  { value: "gif", label: "تحويل إلى GIF", icon: Film },
  { value: "thumbnail", label: "التقاط صورة", icon: Film },
];

function EnhancePage() {
  const [file, setFile] = useState<File | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null);
  const [outputName, setOutputName] = useState("output.mp4");
  const [mode, setMode] = useState<Mode>("enhance");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingFFmpeg, setLoadingFFmpeg] = useState(false);

  // Enhance params
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(1);
  const [saturation, setSaturation] = useState(1);
  const [sharpness, setSharpness] = useState(0);
  const [gamma, setGamma] = useState(1);
  const [denoise, setDenoise] = useState<"none" | "hqdn3d" | "nlmeans">("none");

  // Speed / trim
  const [speed, setSpeed] = useState(1);
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

  // Denoise strength
  const [denoiseStrength, setDenoiseStrength] = useState<"light" | "medium" | "strong">("medium");

  const inputRef = useRef<HTMLInputElement>(null);

  const appendLog = useCallback((m: string) => setLog((p) => (p + "\n" + m).slice(-4000)), []);

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
      ffmpeg.on("progress", ({ progress: p }) => setProgress(Math.round(p * 100)));

      const ext = file.name.split(".").pop() || "mp4";
      const inputName = `input.${ext}`;
      await ffmpeg.writeFile(inputName, await fetchFile(file));

      let outName = "output.mp4";
      let args: string[] = [];

      if (mode === "enhance") {
        const vf: string[] = [];
        vf.push(`eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}:gamma=${gamma}`);
        if (sharpness > 0) vf.push(`unsharp=5:5:${sharpness.toFixed(2)}`);
        if (denoise === "hqdn3d") vf.push("hqdn3d=4:3:6:4.5");
        if (denoise === "nlmeans") vf.push("nlmeans=10:7:5:3:3");
        args = ["-i", inputName, "-vf", vf.join(","), "-c:a", "copy", "-preset", "ultrafast", outName];
      } else if (mode === "denoise") {
        const map = { light: "hqdn3d=2:1:3:2.5", medium: "hqdn3d=4:3:6:4.5", strong: "nlmeans=10:7:5:3:3" };
        args = ["-i", inputName, "-vf", map[denoiseStrength], "-c:a", "copy", "-preset", "ultrafast", outName];
      } else if (mode === "extract-audio") {
        outName = "output.mp3";
        args = ["-i", inputName, "-vn", "-acodec", "libmp3lame", "-q:a", "2", outName];
      } else if (mode === "remove-audio") {
        args = ["-i", inputName, "-c", "copy", "-an", outName];
      } else if (mode === "speed") {
        const clampedAtempo = Math.max(0.5, Math.min(2, speed));
        args = [
          "-i", inputName,
          "-filter_complex",
          `[0:v]setpts=${(1 / speed).toFixed(4)}*PTS[v];[0:a]atempo=${clampedAtempo}[a]`,
          "-map", "[v]", "-map", "[a]", "-preset", "ultrafast", outName,
        ];
      } else if (mode === "trim") {
        const dur = Math.max(0.1, trimEnd - trimStart);
        args = ["-ss", String(trimStart), "-i", inputName, "-t", String(dur), "-c", "copy", outName];
      } else if (mode === "crop") {
        args = ["-i", inputName, "-vf", `crop=${cropW}:${cropH}:${cropX}:${cropY}`, "-c:a", "copy", "-preset", "ultrafast", outName];
      } else if (mode === "rotate") {
        const filterMap: Record<string, string> = {
          "90cw": "transpose=1",
          "90ccw": "transpose=2",
          "180": "transpose=2,transpose=2",
          "fliph": "hflip",
          "flipv": "vflip",
        };
        args = ["-i", inputName, "-vf", filterMap[rotateDir], "-c:a", "copy", "-preset", "ultrafast", outName];
      } else if (mode === "reverse") {
        args = ["-i", inputName, "-vf", "reverse", "-af", "areverse", "-preset", "ultrafast", outName];
      } else if (mode === "compress") {
        args = ["-i", inputName, "-c:v", "libx264", "-crf", String(crf), "-preset", "veryfast", "-c:a", "aac", "-b:a", "128k", outName];
      } else if (mode === "upscale") {
        const [w, h] = upscaleRes.split("x");
        args = ["-i", inputName, "-vf", `scale=${w}:${h}:flags=lanczos`, "-c:a", "copy", "-preset", "ultrafast", outName];
      } else if (mode === "fps") {
        args = ["-i", inputName, "-filter:v", `fps=${targetFps}`, "-c:a", "copy", "-preset", "ultrafast", outName];
      } else if (mode === "gif") {
        outName = "output.gif";
        args = ["-i", inputName, "-vf", `fps=${gifFps},scale=${gifWidth}:-1:flags=lanczos`, outName];
      } else if (mode === "thumbnail") {
        outName = "thumb.jpg";
        args = ["-ss", String(thumbAt), "-i", inputName, "-frames:v", "1", outName];
      }

      await ffmpeg.exec(args);
      const data = (await ffmpeg.readFile(outName)) as Uint8Array;
      const mime = outName.endsWith(".mp3")
        ? "audio/mpeg"
        : outName.endsWith(".gif")
          ? "image/gif"
          : outName.endsWith(".jpg")
            ? "image/jpeg"
            : "video/mp4";
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

  async function onSaveToCloud() {
    if (!outputBlob) return;
    setSaving(true);
    try {
      const id = crypto.randomUUID();
      const path = `${id}-${outputName}`;
      const { error: upErr } = await supabase.storage.from("videos").upload(path, outputBlob, {
        contentType: outputBlob.type,
      });
      if (upErr) throw upErr;
      await supabase.from("processed_videos").insert({
        name: outputName,
        storage_path: path,
        size_bytes: outputBlob.size,
        settings: { mode },
      });
      alert("✓ تم الحفظ في مكتبتك");
    } catch (e) {
      alert("فشل الحفظ: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  }

  const selectedMode = MODES.find((m) => m.value === mode);

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 border-b border-border sticky top-0 z-40 bg-background/90 backdrop-blur-sm">
        <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowRight className="size-4" />
          الرئيسية
        </Link>
        <div className="flex items-center gap-2 font-semibold text-sm">
          <Wand2 className="size-4 text-primary" />
          محرر الفيديو
        </div>
        <Link to="/library" className="text-sm hover:text-primary">مكتبتي</Link>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Preview */}
        <section className="space-y-4">
          <div className="rounded-2xl border border-border bg-card/60 overflow-hidden aspect-video flex items-center justify-center min-h-[260px]">
            {outputUrl ? (
              outputName.endsWith(".mp3") ? (
                <audio src={outputUrl} controls className="w-full mx-6" />
              ) : outputName.endsWith(".gif") || outputName.endsWith(".jpg") ? (
                <img src={outputUrl} alt="output" className="max-w-full max-h-full object-contain" />
              ) : (
                <video src={outputUrl} controls className="w-full h-full" />
              )
            ) : file ? (
              <video src={URL.createObjectURL(file)} controls className="w-full h-full" />
            ) : (
              <button
                onClick={() => inputRef.current?.click()}
                className="flex flex-col items-center gap-4 text-muted-foreground hover:text-primary transition p-12 w-full h-full"
              >
                <div className="rounded-2xl border-2 border-dashed border-current p-6">
                  <Upload className="size-10 mx-auto mb-2" />
                  <span className="block text-base font-medium">اضغط لاختيار فيديو</span>
                  <span className="block text-xs mt-1 opacity-60">MP4, MOV, AVI, MKV — يُفضّل أقل من 200MB</span>
                </div>
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
              if (f) { setFile(f); setOutputUrl(null); setOutputBlob(null); }
            }}
          />

          {file && (
            <div className="flex items-center justify-between text-sm bg-card/60 rounded-xl px-4 py-2.5 border border-border">
              <span className="text-muted-foreground truncate">{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</span>
              <button onClick={() => inputRef.current?.click()} className="text-primary hover:underline shrink-0">تغيير</button>
            </div>
          )}

          {busy && (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-sm mb-2">
                <Loader2 className="size-4 animate-spin text-primary" />
                {loadingFFmpeg ? "جاري تحميل محرك FFmpeg..." : `جاري المعالجة... ${progress}%`}
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary transition-all duration-300 rounded-full" style={{ width: `${loadingFFmpeg ? 5 : progress}%` }} />
              </div>
            </div>
          )}

          {outputUrl && (
            <div className="flex flex-wrap gap-2">
              <a
                href={outputUrl}
                download={outputName}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-semibold text-primary-foreground hover:opacity-90 transition"
              >
                <Download className="size-4" /> تنزيل ({outputName})
              </a>
              <button
                onClick={onSaveToCloud}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 font-semibold hover:bg-secondary disabled:opacity-50 transition"
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                حفظ في مكتبتي
              </button>
            </div>
          )}

          {log && (
            <details className="rounded-xl border border-border bg-card/60 p-3">
              <summary className="cursor-pointer text-sm text-muted-foreground select-none">سجل FFmpeg</summary>
              <pre className="mt-2 text-xs whitespace-pre-wrap text-muted-foreground max-h-48 overflow-auto font-mono leading-relaxed">{log}</pre>
            </details>
          )}
        </section>

        {/* Controls */}
        <aside className="space-y-4">
          <div className="rounded-2xl border border-border bg-card/60 p-4">
            <label className="text-sm font-semibold block mb-3">اختر العملية</label>
            <div className="grid grid-cols-2 gap-2">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setMode(m.value)}
                  className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-medium transition text-right ${
                    mode === m.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-background/60 border border-border hover:bg-secondary text-muted-foreground"
                  }`}
                >
                  <m.icon className="size-3.5 shrink-0" />
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {mode === "enhance" && (
            <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
              <h3 className="text-sm font-semibold">إعدادات التحسين</h3>
              <Slider label="السطوع" value={brightness} min={-1} max={1} step={0.05} onChange={setBrightness} display={brightness.toFixed(2)} />
              <Slider label="التباين" value={contrast} min={0.5} max={2} step={0.05} onChange={setContrast} display={contrast.toFixed(2)} />
              <Slider label="التشبع" value={saturation} min={0} max={3} step={0.1} onChange={setSaturation} display={saturation.toFixed(1)} />
              <Slider label="الحدّة" value={sharpness} min={0} max={2} step={0.1} onChange={setSharpness} display={sharpness.toFixed(1)} />
              <Slider label="جاما" value={gamma} min={0.5} max={2} step={0.05} onChange={setGamma} display={gamma.toFixed(2)} />
              <div>
                <label className="text-xs text-muted-foreground block mb-1">إزالة الضوضاء</label>
                <select
                  value={denoise}
                  onChange={(e) => setDenoise(e.target.value as any)}
                  className="w-full rounded-lg bg-input border border-border px-3 py-2 text-xs"
                >
                  <option value="none">بدون إزالة ضوضاء</option>
                  <option value="hqdn3d">hqdn3d — سريع</option>
                  <option value="nlmeans">nlmeans — جودة أعلى (أبطأ)</option>
                </select>
              </div>
            </div>
          )}

          {mode === "denoise" && (
            <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
              <h3 className="text-sm font-semibold">قوة إزالة الضوضاء</h3>
              <div className="grid grid-cols-3 gap-2">
                {(["light", "medium", "strong"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setDenoiseStrength(s)}
                    className={`rounded-lg py-2 text-xs font-medium transition ${denoiseStrength === s ? "bg-primary text-primary-foreground" : "bg-background border border-border hover:bg-secondary"}`}
                  >
                    {s === "light" ? "خفيف" : s === "medium" ? "متوسط" : "قوي"}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {denoiseStrength === "light" ? "hqdn3d خفيف — سريع وخفيف على الوقت" : denoiseStrength === "medium" ? "hqdn3d متوسط — الأنسب لمعظم الحالات" : "nlmeans — جودة ممتازة لكن يستغرق وقتاً أطول"}
              </p>
            </div>
          )}

          {mode === "speed" && (
            <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
              <h3 className="text-sm font-semibold">السرعة</h3>
              <Slider label={`السرعة: ${speed.toFixed(2)}x`} value={speed} min={0.5} max={2} step={0.05} onChange={setSpeed} display={speed.toFixed(2) + "x"} />
              <p className="text-xs text-muted-foreground">ملاحظة: أقصى قيمة للصوت هي 2x (atempo).</p>
            </div>
          )}

          {mode === "trim" && (
            <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
              <h3 className="text-sm font-semibold">قص مقطع</h3>
              <NumInput label="من (ثانية)" value={trimStart} onChange={setTrimStart} />
              <NumInput label="إلى (ثانية)" value={trimEnd} onChange={setTrimEnd} />
              <p className="text-xs text-muted-foreground">المدة: {Math.max(0, trimEnd - trimStart).toFixed(1)} ثانية</p>
            </div>
          )}

          {mode === "crop" && (
            <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
              <h3 className="text-sm font-semibold">اقتصاص</h3>
              <div className="grid grid-cols-2 gap-2">
                <NumInput label="العرض (px)" value={cropW} onChange={setCropW} />
                <NumInput label="الارتفاع (px)" value={cropH} onChange={setCropH} />
                <NumInput label="من يسار (x)" value={cropX} onChange={setCropX} />
                <NumInput label="من أعلى (y)" value={cropY} onChange={setCropY} />
              </div>
            </div>
          )}

          {mode === "rotate" && (
            <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
              <h3 className="text-sm font-semibold">تدوير / قلب</h3>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { value: "90cw", label: "90° يمين" },
                  { value: "90ccw", label: "90° يسار" },
                  { value: "180", label: "180°" },
                  { value: "fliph", label: "قلب أفقي" },
                  { value: "flipv", label: "قلب رأسي" },
                ] as const).map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setRotateDir(r.value)}
                    className={`rounded-lg py-2 text-xs font-medium transition ${rotateDir === r.value ? "bg-primary text-primary-foreground" : "bg-background border border-border hover:bg-secondary"}`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mode === "compress" && (
            <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
              <h3 className="text-sm font-semibold">ضغط الفيديو</h3>
              <Slider label={`جودة CRF: ${crf} (أقل = جودة أعلى)`} value={crf} min={15} max={35} step={1} onChange={setCrf} display={String(crf)} />
              <p className="text-xs text-muted-foreground">
                CRF 18 = جودة بصرية ممتازة · CRF 23 = متوازن · CRF 28+ = حجم أصغر
              </p>
            </div>
          )}

          {mode === "upscale" && (
            <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
              <h3 className="text-sm font-semibold">ترقية الدقة</h3>
              <div className="grid grid-cols-1 gap-2">
                {(["1280x720", "1920x1080", "3840x2160"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setUpscaleRes(r)}
                    className={`rounded-lg py-2 text-sm font-medium transition ${upscaleRes === r ? "bg-primary text-primary-foreground" : "bg-background border border-border hover:bg-secondary"}`}
                  >
                    {r === "1280x720" ? "720p HD" : r === "1920x1080" ? "1080p Full HD" : "4K Ultra HD"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mode === "fps" && (
            <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
              <h3 className="text-sm font-semibold">معدل الإطارات (FPS)</h3>
              <div className="grid grid-cols-3 gap-2">
                {[24, 30, 60].map((f) => (
                  <button
                    key={f}
                    onClick={() => setTargetFps(f)}
                    className={`rounded-lg py-2 text-sm font-medium transition ${targetFps === f ? "bg-primary text-primary-foreground" : "bg-background border border-border hover:bg-secondary"}`}
                  >
                    {f} fps
                  </button>
                ))}
              </div>
              <NumInput label="FPS مخصص" value={targetFps} onChange={setTargetFps} />
            </div>
          )}

          {mode === "gif" && (
            <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
              <h3 className="text-sm font-semibold">إعدادات GIF</h3>
              <NumInput label="معدل الإطارات (fps)" value={gifFps} onChange={setGifFps} />
              <NumInput label="عرض الناتج (px)" value={gifWidth} onChange={setGifWidth} />
            </div>
          )}

          {mode === "thumbnail" && (
            <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
              <h3 className="text-sm font-semibold">التقاط صورة</h3>
              <NumInput label="الوقت (ثانية)" value={thumbAt} onChange={setThumbAt} />
              <p className="text-xs text-muted-foreground">سيُلتقط إطار عند الثانية المحددة ويُحفظ كـ JPG.</p>
            </div>
          )}

          {(mode === "extract-audio" || mode === "remove-audio" || mode === "reverse") && (
            <div className="rounded-2xl border border-border bg-card/60 p-4">
              <p className="text-sm text-muted-foreground">
                {mode === "extract-audio" && "سيستخرج الصوت من الفيديو ويحفظه كملف MP3 بأعلى جودة."}
                {mode === "remove-audio" && "سيحذف الصوت من الفيديو ويحتفظ بالصورة فقط."}
                {mode === "reverse" && "سيعكس الفيديو والصوت معاً من النهاية إلى البداية."}
              </p>
            </div>
          )}

          <button
            onClick={onProcess}
            disabled={!file || busy}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 font-semibold text-primary-foreground hover:opacity-90 transition disabled:opacity-40 shadow-lg shadow-primary/20"
          >
            {busy ? <Loader2 className="size-5 animate-spin" /> : <Wand2 className="size-5" />}
            {busy ? (loadingFFmpeg ? "جاري تحميل FFmpeg..." : "جاري المعالجة...") : `بدء — ${selectedMode?.label}`}
          </button>

          <p className="text-xs text-muted-foreground text-center px-2">
            تجري المعالجة محلياً في متصفحك باستخدام FFmpeg.wasm — لا يُرفع أي ملف لخوادم خارجية.
          </p>
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
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );
}

function NumInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type="number" value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full mt-1 rounded-lg bg-input border border-border px-3 py-2 text-sm"
      />
    </label>
  );
}
