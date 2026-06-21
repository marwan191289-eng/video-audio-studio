import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState, useCallback } from "react";
import { fetchFile } from "@ffmpeg/util";
import { getFFmpeg, removeLogHandler } from "@/lib/ffmpeg-client";
import {
  ArrowRight, Upload, Download, Loader2, Fingerprint,
  ShieldCheck, Cloud, Cpu, CheckCircle2,
} from "lucide-react";

export const Route = createFileRoute("/fingerprint")({
  head: () => ({
    meta: [
      { title: "تغيير البصمة الرقمية — Video Enhancer Pro" },
      { name: "description", content: "إعادة تشفير الفيديو وتغيير البصمة الرقمية وجميع البيانات الوصفية." },
    ],
  }),
  component: FingerprintPage,
});

type FpMethod = "full-reencode" | "strip-meta" | "noise-inject" | "all";
type ProcessMode = "local" | "cloud";

// ── Cloud processing helpers ──────────────────────────────────────────────────
async function processCloudFingerprint(
  file: File,
  settings: Record<string, unknown>,
  onProgress: (p: number) => void,
): Promise<{ url: string; blob: Blob }> {
  const jobFd = new FormData();
  jobFd.append("file", file);
  jobFd.append("mode", "fingerprint");
  jobFd.append("settings", JSON.stringify(settings));

  onProgress(5);
  const startRes = await fetch("/api/enhance-async", { method: "POST", body: jobFd });
  if (!startRes.ok) throw new Error(await startRes.text());
  const { jobId } = await startRes.json();

  // Poll until done
  for (let i = 0; i < 360; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const statusRes = await fetch(`/api/job/${jobId}`);
    const status = await statusRes.json();
    if (status.progress) onProgress(Math.max(10, Math.min(95, status.progress)));
    if (status.status === "done") break;
    if (status.status === "failed") throw new Error(status.error || "فشلت المعالجة السحابية");
    if (status.status === "cancelled") throw new Error("تم إلغاء المهمة");
  }

  onProgress(98);
  const resultRes = await fetch(`/api/job-result/${jobId}`);
  if (!resultRes.ok) throw new Error("فشل تحميل النتيجة");
  const blob = await resultRes.blob();
  onProgress(100);
  return { url: URL.createObjectURL(blob), blob };
}

function FingerprintPage() {
  const [file, setFile] = useState<File | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingFFmpeg, setLoadingFFmpeg] = useState(false);
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState("");
  const [processMode, setProcessMode] = useState<ProcessMode>("local");

  const [method, setMethod] = useState<FpMethod>("all");
  const [crfVariance, setCrfVariance] = useState(22);
  const [noiseLevel, setNoiseLevel] = useState(1);
  const [newTitle, setNewTitle] = useState("");
  const [newArtist, setNewArtist] = useState("");
  const [newComment, setNewComment] = useState("Processed");
  const [changeTimestamp, setChangeTimestamp] = useState(true);
  const [addSubtle, setAddSubtle] = useState(true);

  const inputRef = useRef<HTMLInputElement>(null);
  const appendLog = useCallback((m: string) => setLog(p => (p + "\n" + m).slice(-4000)), []);

  async function onProcess() {
    if (!file) return;
    setBusy(true); setLoadingFFmpeg(false); setProgress(0);
    setOutputUrl(null); setLog("");

    const settings = { method, crfVariance, noiseLevel, newTitle, newArtist, newComment, changeTimestamp, addSubtle };

    // ── Cloud mode ─────────────────────────────────────────────────────────
    if (processMode === "cloud") {
      appendLog("☁ جاري الإرسال للسيرفر للمعالجة السحابية...");
      try {
        const { url } = await processCloudFingerprint(file, settings, p => setProgress(p));
        setOutputUrl(url);
        appendLog("✓ تم تغيير البصمة الرقمية عبر السيرفر بنجاح");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setLog(p => p + "\n❌ خطأ سحابي: " + msg);
      } finally { setBusy(false); }
      return;
    }

    // ── Local WASM mode ────────────────────────────────────────────────────
    setLoadingFFmpeg(true);
    const logHandler = (m: string) => appendLog(m);
    try {
      const ffmpeg = await getFFmpeg(logHandler);
      setLoadingFFmpeg(false);
      ffmpeg.on("progress", ({ progress: p }: { progress: number }) => setProgress(Math.round(p * 100)));

      const ext = file.name.split(".").pop() || "mp4";
      const inputName = `input.${ext}`;
      await ffmpeg.writeFile(inputName, await fetchFile(file));
      const outName = "output_fp.mp4";

      const args: string[] = ["-i", inputName, "-map_metadata", "-1"];
      if (newTitle) args.push("-metadata", `title=${newTitle}`);
      if (newArtist) args.push("-metadata", `artist=${newArtist}`);
      if (newComment) args.push("-metadata", `comment=${newComment}`);
      if (changeTimestamp) {
        const now = new Date().toISOString().replace("T", " ").replace(/\.\d+Z/, "");
        args.push("-metadata", `creation_time=${now}`);
      }
      const vf: string[] = [];
      if (method !== "strip-meta" && (addSubtle || method === "noise-inject")) {
        vf.push(`noise=alls=${Math.max(1, Math.min(5, noiseLevel))}:allf=t+u`);
      }
      if ([...new Set(vf)].length > 0) args.push("-vf", [...new Set(vf)].join(","));
      if (method === "strip-meta") {
        args.push("-c", "copy");
      } else {
        args.push("-c:v", "libx264", "-crf", String(crfVariance), "-preset", "veryfast");
        args.push("-c:a", "aac", "-b:a", "128k");
      }
      args.push("-movflags", "+faststart", outName);

      await ffmpeg.exec(args);
      const data = (await ffmpeg.readFile(outName)) as Uint8Array;
      setOutputUrl(URL.createObjectURL(new Blob([data], { type: "video/mp4" })));
      appendLog("✓ تم تغيير البصمة الرقمية بنجاح");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e) || "حدث خطأ";
      setLog(p => p + "\n❌ خطأ: " + msg);
    } finally {
      removeLogHandler(logHandler);
      setBusy(false); setLoadingFFmpeg(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 border-b border-border sticky top-0 z-40 bg-background/90 backdrop-blur-sm">
        <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition">
          <ArrowRight className="size-4" /> الرئيسية
        </Link>
        <div className="flex items-center gap-2 font-semibold text-sm">
          <Fingerprint className="size-4 text-amber-400" />
          تغيير البصمة الرقمية
        </div>
        <Link to="/enhance" className="text-sm hover:text-primary transition">المحرر</Link>
      </header>

      {/* Processing mode switcher */}
      <div className="border-b border-border bg-card/40">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-3">
          <span className="text-xs text-muted-foreground font-medium">وضع المعالجة:</span>
          <div className="flex rounded-xl border border-border overflow-hidden bg-background">
            <button
              onClick={() => setProcessMode("local")}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition ${processMode === "local" ? "bg-amber-500/15 text-amber-400 border-l border-border" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Cpu className="size-3.5" /> محلي (WASM)
            </button>
            <button
              onClick={() => setProcessMode("cloud")}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition ${processMode === "cloud" ? "bg-sky-500/15 text-sky-400" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Cloud className="size-3.5" /> سحابي ☁
            </button>
          </div>
          <span className="text-[10px] text-muted-foreground">
            {processMode === "cloud"
              ? "يُعالج الفيديو على السيرفر — مناسب للملفات الكبيرة وبدون حدود WASM"
              : "يُعالج الفيديو محلياً في المتصفح — خصوصية تامة"}
          </span>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-6 py-6 grid gap-6 lg:grid-cols-[1fr_400px]">
        {/* Preview */}
        <section className="space-y-4">
          <div className="rounded-2xl border border-border bg-card/60 overflow-hidden aspect-video flex items-center justify-center min-h-[260px]">
            {outputUrl ? (
              <video src={outputUrl} controls className="w-full h-full" />
            ) : file ? (
              <video src={URL.createObjectURL(file)} controls className="w-full h-full" />
            ) : (
              <button onClick={() => inputRef.current?.click()} className="flex flex-col items-center gap-4 text-muted-foreground hover:text-amber-400 transition p-12 w-full h-full">
                <div className="rounded-2xl border-2 border-dashed border-current p-6 w-full text-center">
                  <Upload className="size-10 mx-auto mb-2" />
                  <span className="block text-base font-medium">ارفع الفيديو</span>
                  <span className="block text-xs mt-1 opacity-60">MP4, MOV, AVI, MKV</span>
                </div>
              </button>
            )}
          </div>

          <input ref={inputRef} type="file" accept="video/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) { setFile(f); setOutputUrl(null); } }} />

          {busy && (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-sm mb-2">
                <Loader2 className="size-4 animate-spin text-amber-400" />
                {processMode === "cloud"
                  ? progress < 10 ? "☁ جاري الإرسال للسيرفر..." : `☁ معالجة سحابية... ${progress}%`
                  : loadingFFmpeg ? "جاري تحميل FFmpeg..." : `جاري المعالجة... ${progress}%`}
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all rounded-full ${processMode === "cloud" ? "bg-sky-500" : "bg-amber-500"}`}
                  style={{ width: `${loadingFFmpeg ? 5 : progress}%` }}
                />
              </div>
            </div>
          )}

          {outputUrl && (
            <div className="flex gap-3 flex-wrap">
              <a
                href={outputUrl}
                download="output_new_fingerprint.mp4"
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-semibold text-primary-foreground hover:opacity-90 transition"
              >
                <Download className="size-4" /> تنزيل — بصمة رقمية جديدة
              </a>
              {processMode === "cloud" && (
                <div className="inline-flex items-center gap-1.5 text-xs text-sky-400 border border-sky-500/30 bg-sky-500/10 rounded-xl px-3 py-2.5">
                  <CheckCircle2 className="size-3.5" /> معالجة سحابية مكتملة
                </div>
              )}
            </div>
          )}

          {log && (
            <details className="rounded-xl border border-border bg-card/60 p-3" open>
              <summary className="cursor-pointer text-sm text-muted-foreground">سجل العملية</summary>
              <pre className="mt-2 text-xs whitespace-pre-wrap text-muted-foreground max-h-48 overflow-auto font-mono">{log}</pre>
            </details>
          )}

          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-sm text-amber-400">
              <ShieldCheck className="size-4" />
              ما الذي يتغير في البصمة الرقمية؟
            </div>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>حذف جميع البيانات الوصفية (metadata) الأصلية</li>
              <li>إعادة تشفير كامل بمعاملات مختلفة</li>
              <li>حقن ضوضاء مرئية دقيقة لا تُرى بالعين</li>
              <li>تغيير بيانات encoder وcreation_time</li>
              <li>إنتاج hash جديد كلياً للملف</li>
            </ul>
          </div>
        </section>

        {/* Controls */}
        <aside className="space-y-4">
          <div className="rounded-2xl border border-border bg-card/60 p-4">
            <h3 className="text-sm font-semibold mb-3">أسلوب تغيير البصمة</h3>
            <div className="space-y-2">
              {(
                [
                  { value: "all", label: "شامل (موصى به)", desc: "إعادة تشفير + إزالة metadata + حقن ضوضاء" },
                  { value: "full-reencode", label: "إعادة تشفير فقط", desc: "تغيير كامل لبنية الملف" },
                  { value: "strip-meta", label: "إزالة Metadata فقط", desc: "سريع جداً — يحذف EXIF والبيانات" },
                  { value: "noise-inject", label: "حقن ضوضاء دقيقة", desc: "يغير hash الملف بدون تغيير مرئي" },
                ] as const
              ).map(m => (
                <button
                  key={m.value}
                  onClick={() => setMethod(m.value)}
                  className={`w-full text-right rounded-xl px-4 py-3 border transition ${method === m.value ? "border-amber-500/50 bg-amber-500/10" : "border-border bg-background/60 hover:bg-secondary"}`}
                >
                  <div className="font-medium text-sm">{m.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {(method === "full-reencode" || method === "all") && (
            <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
              <h3 className="text-sm font-semibold">إعدادات إعادة التشفير</h3>
              <Slider label={`CRF: ${crfVariance}`} value={crfVariance} min={18} max={32} step={1} onChange={setCrfVariance} display={String(crfVariance)} />
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={addSubtle} onChange={e => setAddSubtle(e.target.checked)} className="accent-amber-500" />
                إضافة ضوضاء دقيقة (يغير الـ hash)
              </label>
              {addSubtle && (
                <Slider label={`مستوى الضوضاء: ${noiseLevel}`} value={noiseLevel} min={1} max={5} step={1} onChange={setNoiseLevel} display={String(noiseLevel)} />
              )}
            </div>
          )}

          {method === "noise-inject" && (
            <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
              <h3 className="text-sm font-semibold">مستوى الضوضاء الدقيقة</h3>
              <Slider label={`الضوضاء: ${noiseLevel}/5`} value={noiseLevel} min={1} max={5} step={1} onChange={setNoiseLevel} display={String(noiseLevel)} />
              <p className="text-xs text-muted-foreground">مستوى 1-2 لا يُلاحظ بالعين. مستوى 3+ قد يكون مرئياً في الضوء القوي.</p>
            </div>
          )}

          <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
            <h3 className="text-sm font-semibold">البيانات الوصفية الجديدة</h3>
            <TextInput label="العنوان (title)" value={newTitle} onChange={setNewTitle} placeholder="أتركه فارغاً للحذف" />
            <TextInput label="الفنان (artist)" value={newArtist} onChange={setNewArtist} placeholder="أتركه فارغاً للحذف" />
            <TextInput label="التعليق (comment)" value={newComment} onChange={setNewComment} placeholder="Processed" />
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={changeTimestamp} onChange={e => setChangeTimestamp(e.target.checked)} className="accent-amber-500" />
              تغيير تاريخ الإنشاء إلى الوقت الحالي
            </label>
          </div>

          <button
            onClick={onProcess}
            disabled={!file || busy}
            className={`w-full inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 font-semibold text-white hover:opacity-90 transition disabled:opacity-40 shadow-lg
              ${processMode === "cloud"
                ? "bg-sky-600 shadow-sky-600/20"
                : "bg-amber-600 shadow-amber-600/20"}`}
          >
            {busy ? (
              <Loader2 className="size-5 animate-spin" />
            ) : processMode === "cloud" ? (
              <Cloud className="size-5" />
            ) : (
              <Fingerprint className="size-5" />
            )}
            {busy
              ? processMode === "cloud" ? "☁ جاري المعالجة السحابية..." : loadingFFmpeg ? "جاري تحميل FFmpeg..." : "جاري تغيير البصمة..."
              : processMode === "cloud" ? "☁ تغيير البصمة عبر السحابة" : "تغيير البصمة الرقمية"}
          </button>
        </aside>
      </main>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, display }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; display: string;
}) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} className="w-full accent-amber-500" />
    </div>
  );
}

function TextInput({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="w-full mt-1 rounded-lg bg-input border border-border px-3 py-2 text-sm" />
    </label>
  );
}
