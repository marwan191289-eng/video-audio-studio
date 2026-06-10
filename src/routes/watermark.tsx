import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState, useCallback } from "react";
import { fetchFile } from "@ffmpeg/util";
import { getFFmpeg, removeLogHandler } from "@/lib/ffmpeg-client";
import { ArrowRight, Upload, Download, Loader2, Droplets, Eye, EyeOff } from "lucide-react";

export const Route = createFileRoute("/watermark")({
  head: () => ({
    meta: [
      { title: "إزالة العلامات المائية — Video Enhancer Pro" },
      { name: "description", content: "إزالة العلامات المائية والشعارات من الفيديو باحترافية تامة." },
    ],
  }),
  component: WatermarkPage,
});

type RemoveMethod = "delogo" | "blur" | "fill";

function WatermarkPage() {
  const [file, setFile] = useState<File | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingFFmpeg, setLoadingFFmpeg] = useState(false);
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState("");

  const [method, setMethod] = useState<RemoveMethod>("delogo");
  const [logoX, setLogoX] = useState(10);
  const [logoY, setLogoY] = useState(10);
  const [logoW, setLogoW] = useState(150);
  const [logoH, setLogoH] = useState(50);
  const [blurStrength, setBlurStrength] = useState(20);
  const [showGuide, setShowGuide] = useState(false);

  // Multiple regions
  const [regions, setRegions] = useState<{ x: number; y: number; w: number; h: number }[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const appendLog = useCallback((m: string) => setLog((p) => (p + "\n" + m).slice(-4000)), []);

  function addRegion() {
    setRegions((prev) => [...prev, { x: logoX, y: logoY, w: logoW, h: logoH }]);
  }

  function removeRegion(i: number) {
    setRegions((prev) => prev.filter((_, idx) => idx !== i));
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
      ffmpeg.on("progress", ({ progress: p }) => setProgress(Math.round(p * 100)));

      const ext = file.name.split(".").pop() || "mp4";
      const inputName = `input.${ext}`;
      await ffmpeg.writeFile(inputName, await fetchFile(file));

      const allRegions = regions.length > 0 ? regions : [{ x: logoX, y: logoY, w: logoW, h: logoH }];

      let vf = "";
      if (method === "delogo") {
        vf = allRegions.map(r => `delogo=x=${r.x}:y=${r.y}:w=${r.w}:h=${r.h}`).join(",");
      } else if (method === "blur") {
        vf = allRegions
          .map(r => `[in]split[orig][blur];[blur]crop=${r.w}:${r.h}:${r.x}:${r.y},boxblur=${blurStrength}:${blurStrength}[blurred];[orig][blurred]overlay=${r.x}:${r.y}[out]`)
          .join(";");
        // Simplified single-region blur
        const r = allRegions[0];
        vf = `boxblur=enable='between(x\\,${r.x}\\,${r.x + r.w})*between(y\\,${r.y}\\,${r.y + r.h})':luma_radius=${blurStrength}:luma_power=2`;
      } else if (method === "fill") {
        vf = allRegions.map(r => `drawbox=x=${r.x}:y=${r.y}:w=${r.w}:h=${r.h}:color=black@1:t=fill`).join(",");
      }

      const outName = "output.mp4";
      const args = ["-i", inputName, "-vf", vf, "-c:a", "copy", "-preset", "ultrafast", outName];
      await ffmpeg.exec(args);

      const data = (await ffmpeg.readFile(outName)) as Uint8Array;
      const blob = new Blob([data.buffer as ArrayBuffer], { type: "video/mp4" });
      setOutputBlob(blob);
      setOutputUrl(URL.createObjectURL(blob));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e) || "حدث خطأ";
      setLog((p) => p + "\n❌ خطأ: " + msg);
    } finally {
      removeLogHandler(logHandler);
      setBusy(false);
      setLoadingFFmpeg(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 border-b border-border sticky top-0 z-40 bg-background/90 backdrop-blur-sm">
        <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowRight className="size-4" /> الرئيسية
        </Link>
        <div className="flex items-center gap-2 font-semibold text-sm">
          <Droplets className="size-4 text-rose-400" />
          إزالة العلامات المائية
        </div>
        <Link to="/enhance" className="text-sm hover:text-primary">المحرر</Link>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6 grid gap-6 lg:grid-cols-[1fr_400px]">
        {/* Preview */}
        <section className="space-y-4">
          <div className="rounded-2xl border border-border bg-card/60 overflow-hidden aspect-video flex items-center justify-center min-h-[260px]">
            {outputUrl ? (
              <video src={outputUrl} controls className="w-full h-full" />
            ) : file ? (
              <video src={URL.createObjectURL(file)} controls className="w-full h-full" />
            ) : (
              <button onClick={() => inputRef.current?.click()} className="flex flex-col items-center gap-4 text-muted-foreground hover:text-rose-400 transition p-12 w-full h-full">
                <div className="rounded-2xl border-2 border-dashed border-current p-6 w-full text-center">
                  <Upload className="size-10 mx-auto mb-2" />
                  <span className="block text-base font-medium">ارفع الفيديو الذي يحتوي على علامة مائية</span>
                  <span className="block text-xs mt-1 opacity-60">MP4, MOV, AVI, MKV</span>
                </div>
              </button>
            )}
          </div>

          <input ref={inputRef} type="file" accept="video/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setOutputUrl(null); } }} />

          {file && (
            <div className="flex items-center justify-between text-sm bg-card/60 rounded-xl px-4 py-2.5 border border-border">
              <span className="text-muted-foreground">{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</span>
              <button onClick={() => inputRef.current?.click()} className="text-primary hover:underline">تغيير</button>
            </div>
          )}

          {busy && (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-sm mb-2">
                <Loader2 className="size-4 animate-spin text-rose-400" />
                {loadingFFmpeg ? "جاري تحميل FFmpeg..." : `جاري المعالجة... ${progress}%`}
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-rose-500 transition-all rounded-full" style={{ width: `${loadingFFmpeg ? 5 : progress}%` }} />
              </div>
            </div>
          )}

          {outputUrl && (
            <div className="flex gap-3">
              <a href={outputUrl} download="output_clean.mp4"
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-semibold text-primary-foreground hover:opacity-90 transition">
                <Download className="size-4" /> تنزيل الفيديو النظيف
              </a>
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
          {/* Method */}
          <div className="rounded-2xl border border-border bg-card/60 p-4">
            <h3 className="text-sm font-semibold mb-3">طريقة الإزالة</h3>
            <div className="space-y-2">
              {([
                { value: "delogo", label: "delogo (الأفضل)", desc: "يملأ المنطقة بمحتوى مجاور — احترافي وبلا أثر" },
                { value: "blur", label: "طمس (Blur)", desc: "يطمس المنطقة بضبابية — بسيط وسريع" },
                { value: "fill", label: "ملء أسود", desc: "يغطي المنطقة باللون الأسود — مثالي للزوايا" },
              ] as const).map((m) => (
                <button
                  key={m.value}
                  onClick={() => setMethod(m.value)}
                  className={`w-full text-right rounded-xl px-4 py-3 border transition ${method === m.value ? "border-rose-500/50 bg-rose-500/10" : "border-border bg-background/60 hover:bg-secondary"}`}
                >
                  <div className="font-medium text-sm">{m.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Region */}
          <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">موضع العلامة المائية</h3>
              <button onClick={() => setShowGuide(!showGuide)} className="text-xs text-muted-foreground flex items-center gap-1">
                {showGuide ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                {showGuide ? "إخفاء" : "كيف أجد الإحداثيات؟"}
              </button>
            </div>

            {showGuide && (
              <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 text-xs text-muted-foreground leading-relaxed">
                <strong className="text-foreground">للعثور على إحداثيات العلامة:</strong>
                <ol className="list-decimal list-inside mt-1 space-y-1">
                  <li>افتح الفيديو في VLC أو أي مشغّل</li>
                  <li>خذ لقطة شاشة وافتحها في برنامج رسم</li>
                  <li>حرّك المؤشر إلى زاوية العلامة العلوية اليسرى — هذه هي X وY</li>
                  <li>قِس عرض وارتفاع العلامة — هذا هو W وH</li>
                </ol>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <NumInput label="X (من اليسار)" value={logoX} onChange={setLogoX} />
              <NumInput label="Y (من الأعلى)" value={logoY} onChange={setLogoY} />
              <NumInput label="العرض W" value={logoW} onChange={setLogoW} />
              <NumInput label="الارتفاع H" value={logoH} onChange={setLogoH} />
            </div>

            {method === "blur" && (
              <Slider label={`قوة الطمس: ${blurStrength}`} value={blurStrength} min={5} max={50} step={5} onChange={setBlurStrength} display={String(blurStrength)} />
            )}
          </div>

          {/* Multiple regions */}
          <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">مناطق متعددة</h3>
              <button onClick={addRegion} className="text-xs text-primary hover:underline">+ إضافة منطقة</button>
            </div>
            {regions.length === 0 ? (
              <p className="text-xs text-muted-foreground">يستخدم الإحداثيات أعلاه افتراضياً. أضف مناطق متعددة لإزالة علامات مائية من أماكن مختلفة.</p>
            ) : (
              <div className="space-y-2">
                {regions.map((r, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg bg-background/60 border border-border px-3 py-2 text-xs">
                    <span className="font-mono">x:{r.x} y:{r.y} w:{r.w} h:{r.h}</span>
                    <button onClick={() => removeRegion(i)} className="text-destructive hover:underline">حذف</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={onProcess}
            disabled={!file || busy}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-6 py-3.5 font-semibold text-white hover:opacity-90 transition disabled:opacity-40 shadow-lg shadow-rose-600/20"
          >
            {busy ? <Loader2 className="size-5 animate-spin" /> : <Droplets className="size-5" />}
            {busy ? (loadingFFmpeg ? "جاري تحميل FFmpeg..." : "جاري الإزالة...") : "إزالة العلامة المائية"}
          </button>

          <div className="rounded-xl bg-rose-500/5 border border-rose-500/20 p-3">
            <p className="text-xs text-muted-foreground">
              <strong className="text-rose-400">ملاحظة مهمة:</strong> طريقة <em>delogo</em> تعطي أفضل نتيجة — تملأ المنطقة باستخدام خوارزمية استيفاء من المحتوى المجاور.
            </p>
          </div>
        </aside>
      </main>
    </div>
  );
}

function NumInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input type="number" value={value} onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        className="w-full mt-1 rounded-lg bg-input border border-border px-3 py-2 text-sm font-mono" />
    </label>
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
        <span className="font-mono">{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-rose-500" />
    </div>
  );
}
