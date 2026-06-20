import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
  ArrowRight, Upload, Sparkles, Loader2, CheckCircle2, AlertCircle,
  AlertTriangle, Info, ChevronRight, BarChart3, Cpu, Volume2,
  Film, Zap, Shield, Monitor, Play,
} from "lucide-react";

export const Route = createFileRoute("/analyze")({
  head: () => ({
    meta: [
      { title: "فحص الذكاء الاصطناعي — Video Enhancer Pro" },
      { name: "description", content: "فحص الفيديو بالذكاء الاصطناعي وتوصيات المعالجة للوصول لأعلى جودة." },
    ],
  }),
  component: AnalyzePage,
});

interface VideoInfo {
  width: number; height: number; codec: string; fps: number;
  bitrate: number; duration: number; pixFmt: string;
  audioCodec: string; audioBitrate: number; audioSampleRate: number;
}

interface Recommendation {
  priority: number; category: string; title: string;
  desc: string; impact: string; mode: string | null; color: string;
}

interface AnalysisResult {
  videoInfo: VideoInfo;
  qualityScore: number;
  recommendations: Recommendation[];
  suggestedMode: string | null;
}

const MODE_LABELS: Record<string, { label: string; href: string }> = {
  "upscale": { label: "رفع الدقة", href: "/enhance" },
  "compress": { label: "ضغط الفيديو", href: "/enhance" },
  "auto-enhance": { label: "تحسين تلقائي", href: "/enhance" },
  "denoise": { label: "إزالة الضوضاء", href: "/enhance" },
  "fps": { label: "تحسين معدل الإطارات", href: "/enhance" },
  "color-grade": { label: "تدرج الألوان", href: "/enhance" },
  "stabilize": { label: "تثبيت الصورة", href: "/enhance" },
};

function ScoreGauge({ score }: { score: number }) {
  const color = score >= 80 ? "#22c55e" : score >= 55 ? "#f59e0b" : "#ef4444";
  const label = score >= 80 ? "جودة عالية" : score >= 55 ? "جودة متوسطة" : "جودة منخفضة";
  const r = 54; const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-36 h-36">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 128 128">
          <circle cx="64" cy="64" r={r} fill="none" stroke="currentColor" strokeWidth="10" className="text-border" />
          <circle cx="64" cy="64" r={r} fill="none" stroke={color} strokeWidth="10"
            strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
            style={{ transition: "stroke-dasharray 1s ease" }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-black" style={{ color }}>{score}</span>
          <span className="text-[10px] text-muted-foreground font-medium">/100</span>
        </div>
      </div>
      <span className="text-sm font-semibold" style={{ color }}>{label}</span>
    </div>
  );
}

function ImpactBadge({ impact }: { impact: string }) {
  const cls =
    impact === "عالٍ جداً" ? "bg-red-500/15 text-red-400 border-red-500/30" :
    impact === "عالٍ" ? "bg-orange-500/15 text-orange-400 border-orange-500/30" :
    impact === "متوسط" ? "bg-amber-500/15 text-amber-400 border-amber-500/30" :
    "bg-blue-500/15 text-blue-400 border-blue-500/30";
  return <span className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}>{impact}</span>;
}

function RecIcon({ color }: { color: string }) {
  if (color === "red") return <AlertCircle className="size-4 text-red-400 shrink-0 mt-0.5" />;
  if (color === "orange") return <AlertTriangle className="size-4 text-orange-400 shrink-0 mt-0.5" />;
  if (color === "green") return <CheckCircle2 className="size-4 text-emerald-400 shrink-0 mt-0.5" />;
  return <Info className="size-4 text-blue-400 shrink-0 mt-0.5" />;
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function AnalyzePage() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onAnalyze() {
    if (!file) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/analyze", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      setResult(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  const vi = result?.videoInfo;

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      {/* Background */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-violet-600/8 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-96 h-96 rounded-full bg-emerald-600/6 blur-3xl" />
      </div>

      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 border-b border-border sticky top-0 z-40 bg-background/90 backdrop-blur-sm">
        <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition">
          <ArrowRight className="size-4" /> الرئيسية
        </Link>
        <div className="flex items-center gap-2 font-bold text-sm">
          <div className="p-1 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600">
            <Sparkles className="size-3.5 text-white" />
          </div>
          فحص الذكاء الاصطناعي
        </div>
        <Link to="/enhance" className="text-sm hover:text-primary transition">المحرر</Link>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {/* Upload Zone */}
        <section className="mb-8">
          <div
            onClick={() => !busy && inputRef.current?.click()}
            className={`relative rounded-2xl border-2 border-dashed transition cursor-pointer
              ${file ? "border-violet-500/50 bg-violet-500/5" : "border-border hover:border-violet-500/40 hover:bg-violet-500/3"}
              ${busy ? "pointer-events-none opacity-60" : ""}
            `}
          >
            <div className="flex flex-col items-center gap-4 py-12 text-center px-4">
              {file ? (
                <>
                  <div className="p-4 rounded-2xl bg-violet-500/15 border border-violet-500/30">
                    <Film className="size-10 text-violet-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-base">{file.name}</p>
                    <p className="text-sm text-muted-foreground mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB — انقر لتغيير الملف</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="p-4 rounded-2xl bg-muted border border-border">
                    <Upload className="size-10 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-semibold text-lg">ارفع الفيديو للفحص</p>
                    <p className="text-sm text-muted-foreground mt-1">MP4، MOV، AVI، MKV، WebM — الفيديو يُرسل للسيرفر للتحليل</p>
                  </div>
                </>
              )}
            </div>
          </div>
          <input ref={inputRef} type="file" accept="video/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) { setFile(f); setResult(null); setError(null); } }} />

          {file && !result && (
            <button
              onClick={onAnalyze}
              disabled={busy}
              className="mt-4 w-full inline-flex items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-violet-600 to-purple-600 py-4 text-base font-bold text-white hover:opacity-90 transition disabled:opacity-50 shadow-xl shadow-violet-500/25"
            >
              {busy ? <Loader2 className="size-5 animate-spin" /> : <Sparkles className="size-5" />}
              {busy ? "جاري فحص الفيديو بالذكاء الاصطناعي..." : "فحص الفيديو الآن"}
            </button>
          )}
        </section>

        {error && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 mb-8 flex items-start gap-3">
            <AlertCircle className="size-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm text-red-400">فشل الفحص</p>
              <p className="text-xs text-muted-foreground mt-1">{error}</p>
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-6">
            {/* Score + Summary Row */}
            <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-6">
              {/* Score */}
              <div className="rounded-2xl border border-border bg-card/60 p-6 flex flex-col items-center justify-center min-w-[200px]">
                <p className="text-xs font-semibold text-muted-foreground mb-4 tracking-wide uppercase">تقييم الجودة الحالية</p>
                <ScoreGauge score={result.qualityScore} />
                {result.recommendations.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-4 text-center">
                    {result.recommendations.filter(r => r.color === "red").length} مشكلة حرجة ·{" "}
                    {result.recommendations.filter(r => r.color === "orange").length} تحسين مهم
                  </p>
                )}
              </div>

              {/* Tech Info */}
              {vi && (
                <div className="rounded-2xl border border-border bg-card/60 p-6">
                  <h3 className="text-sm font-bold mb-4 flex items-center gap-2">
                    <BarChart3 className="size-4 text-muted-foreground" /> بيانات الفيديو التقنية
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[
                      { icon: Monitor, label: "الدقة", value: vi.width && vi.height ? `${vi.width}×${vi.height}` : "—" },
                      { icon: Cpu, label: "الكوديك", value: vi.codec ? vi.codec.toUpperCase() : "—" },
                      { icon: Film, label: "معدل الإطارات", value: vi.fps ? `${vi.fps} fps` : "—" },
                      { icon: Zap, label: "معدل البيانات", value: vi.bitrate ? `${vi.bitrate >= 1000 ? (vi.bitrate / 1000).toFixed(1) + " Mbps" : vi.bitrate + " kbps"}` : "—" },
                      { icon: Play, label: "المدة", value: vi.duration ? formatDuration(vi.duration) : "—" },
                      { icon: Volume2, label: "الصوت", value: vi.audioCodec && vi.audioCodec !== "none" ? `${vi.audioCodec.toUpperCase()} · ${vi.audioBitrate}k` : "بدون صوت" },
                    ].map(({ icon: Icon, label, value }) => (
                      <div key={label} className="rounded-xl bg-background border border-border p-3">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Icon className="size-3 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground">{label}</span>
                        </div>
                        <span className="text-sm font-semibold">{value}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 pt-3 border-t border-border">
                    <span className="text-[10px] text-muted-foreground">
                      صيغة البكسل: <span className="font-mono text-foreground/70">{vi.pixFmt || "—"}</span>
                      {vi.audioSampleRate > 0 && ` · معدل الأخذ: ${vi.audioSampleRate} Hz`}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Recommendations */}
            <div className="rounded-2xl border border-border bg-card/60 overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-4 border-b border-border bg-card">
                <Shield className="size-4 text-violet-400" />
                <h3 className="font-bold text-sm">توصيات الذكاء الاصطناعي للوصول لأعلى جودة</h3>
                <span className="mr-auto text-xs text-muted-foreground">{result.recommendations.length} توصية</span>
              </div>
              <div className="divide-y divide-border">
                {result.recommendations.map((rec, i) => {
                  const dest = rec.mode ? MODE_LABELS[rec.mode] : null;
                  return (
                    <div key={i} className={`flex items-start gap-4 px-5 py-4 transition
                      ${rec.color === "red" ? "bg-red-500/4 hover:bg-red-500/8" :
                        rec.color === "orange" ? "bg-orange-500/4 hover:bg-orange-500/8" :
                        rec.color === "green" ? "bg-emerald-500/4 hover:bg-emerald-500/8" :
                        "hover:bg-muted/40"}`}>
                      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-muted border border-border shrink-0 mt-0.5">
                        <span className="text-[10px] font-bold text-muted-foreground">{i + 1}</span>
                      </div>
                      <RecIcon color={rec.color} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-[9px] uppercase font-semibold tracking-wide text-muted-foreground border border-border rounded px-1.5 py-0.5">{rec.category}</span>
                          <ImpactBadge impact={rec.impact} />
                        </div>
                        <p className="font-semibold text-sm leading-snug">{rec.title}</p>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{rec.desc}</p>
                      </div>
                      {dest && (
                        <Link
                          to={dest.href as any}
                          className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-violet-400 hover:text-violet-300 transition whitespace-nowrap"
                        >
                          {dest.label} <ChevronRight className="size-3" />
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/8 to-purple-500/5 p-5">
              <p className="text-sm font-bold mb-3">الخطوة التالية الموصى بها</p>
              <div className="flex flex-wrap gap-3">
                {result.suggestedMode && MODE_LABELS[result.suggestedMode] && (
                  <Link
                    to={MODE_LABELS[result.suggestedMode].href as any}
                    className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 transition shadow-lg shadow-violet-500/20"
                  >
                    <Sparkles className="size-4" />
                    {MODE_LABELS[result.suggestedMode].label}
                    <ChevronRight className="size-4" />
                  </Link>
                )}
                <Link to="/enhance" className="inline-flex items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-semibold hover:bg-muted transition">
                  فتح المحرر الكامل <ChevronRight className="size-4" />
                </Link>
                <button
                  onClick={() => { setResult(null); setFile(null); setError(null); }}
                  className="inline-flex items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition"
                >
                  فحص فيديو آخر
                </button>
              </div>
            </div>
          </div>
        )}

        {!file && !result && (
          <div className="text-center py-8 space-y-8">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
              {[
                { icon: BarChart3, color: "text-violet-400", bg: "bg-violet-500/10", title: "تحليل تقني شامل", desc: "يفحص الدقة، الكوديك، معدل البيانات، الإطارات، الصوت وصيغة البكسل" },
                { icon: Sparkles, color: "text-amber-400", bg: "bg-amber-500/10", title: "توصيات ذكية", desc: "يرتّب المشكلات حسب أثرها ويقترح أفضل خطوات المعالجة بالترتيب الصحيح" },
                { icon: ChevronRight, color: "text-emerald-400", bg: "bg-emerald-500/10", title: "روابط مباشرة", desc: "كل توصية تأخذك مباشرة لأداة المعالجة المناسبة بنقرة واحدة" },
              ].map(({ icon: Icon, color, bg, title, desc }) => (
                <div key={title} className="rounded-2xl border border-border bg-card/40 p-5 text-center">
                  <div className={`inline-flex p-3 rounded-xl ${bg} mb-3`}>
                    <Icon className={`size-6 ${color}`} />
                  </div>
                  <p className="font-semibold text-sm mb-1">{title}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
