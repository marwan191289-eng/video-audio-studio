import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState, useCallback, useEffect } from "react";
import { fetchFile } from "@ffmpeg/util";
import { getFFmpeg, removeLogHandler, writeFileOptimized } from "@/lib/ffmpeg-client";
import {
  ArrowRight, Upload, Download, Save, Loader2, CheckCircle2, AlertCircle,
  Trophy, Target, Zap, Film, Scissors, Layers, Play, RefreshCw, Settings2,
  Clock, ListChecks, Eye, EyeOff, Plus, Trash2, Wand2, Shield, Eraser,
  Edit3, Check, X, ChevronRight, Sparkles, ScanSearch,
} from "lucide-react";
import { saveVideo } from "@/lib/api/library.functions";
import { useLocalSettings } from "@/hooks/useLocalSettings";

export const Route = createFileRoute("/football")({
  head: () => ({
    meta: [
      { title: "ملخصات كرة القدم — Video Enhancer Pro" },
      { name: "description", content: "استخراج الأهداف والهجمات الخطيرة تلقائياً" },
    ],
  }),
  component: FootballPage,
});

type ExtractionMode = "text" | "auto";

interface Clip {
  id: string;
  start: number;
  end: number;
  label: string;
  include: boolean;
}

interface PostOpts {
  autoEnhance: boolean;
  removeTopBar: boolean;
  removeBottomBar: boolean;
  removeWatermark: boolean;
  wmX: number;
  wmY: number;
  wmW: number;
  wmH: number;
  changeFingerprint: boolean;
}

function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function parseTextTimestamps(text: string, padding: number): Clip[] {
  const clips: Clip[] = [];
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    let seconds = -1;
    let label = "";

    const m1 = line.match(/^(\d+):(\d{2}):(\d{2})/);
    const m2 = line.match(/^(\d+):(\d{2})/);
    const m3 = line.match(/^(\d+)'\s*\+?\s*(\d+)?/);
    const m4 = line.match(/^(\d+)\s*دقيقة/);

    if (m1) {
      seconds = parseInt(m1[1]) * 3600 + parseInt(m1[2]) * 60 + parseInt(m1[3]);
      label = line.replace(m1[0], "").replace(/^[\s\-–:]+/, "").trim();
    } else if (m2) {
      seconds = parseInt(m2[1]) * 60 + parseInt(m2[2]);
      label = line.replace(m2[0], "").replace(/^[\s\-–:]+/, "").trim();
    } else if (m3) {
      const mins = parseInt(m3[1]);
      const added = parseInt(m3[2] || "0");
      seconds = (mins + added) * 60;
      label = line.replace(m3[0], "").replace(/^[\s\-–:]+/, "").trim();
    } else if (m4) {
      seconds = parseInt(m4[1]) * 60;
      label = line.replace(m4[0], "").replace(/^[\s\-–:]+/, "").trim();
    }

    if (seconds < 0) continue;
    if (!label) label = `لحظة عند ${fmtTime(seconds)}`;

    clips.push({
      id: crypto.randomUUID(),
      start: Math.max(0, seconds - padding),
      end: seconds + padding,
      label,
      include: true,
    });
  }
  return clips;
}

function buildFootballArgs(
  inputName: string,
  outputName: string,
  clips: Clip[],
  opts: PostOpts
): string[] {
  const included = clips.filter(c => c.include);
  if (included.length === 0) return [];

  const vParts: string[] = [];
  const aParts: string[] = [];
  const refs: string[] = [];

  included.forEach((c, i) => {
    let vf = `trim=start=${c.start.toFixed(2)}:end=${c.end.toFixed(2)},setpts=PTS-STARTPTS`;
    if (opts.autoEnhance) {
      vf += ",eq=contrast=1.05:saturation=1.2:brightness=0.01";
      vf += ",unsharp=3:3:0.5:3:3:0";
    }
    if (opts.removeTopBar) {
      vf += ",drawbox=x=0:y=0:w=iw:h=70:color=black@1:t=fill";
    }
    if (opts.removeBottomBar) {
      vf += ",drawbox=x=0:y=ih-80:w=iw:h=80:color=black@1:t=fill";
    }
    if (opts.removeWatermark) {
      vf += `,delogo=x=${opts.wmX}:y=${opts.wmY}:w=${opts.wmW}:h=${opts.wmH}`;
    }
    vParts.push(`[0:v]${vf}[v${i}]`);
    aParts.push(
      `[0:a]atrim=start=${c.start.toFixed(2)}:end=${c.end.toFixed(2)},asetpts=PTS-STARTPTS[a${i}]`
    );
    refs.push(`[v${i}][a${i}]`);
  });

  const n = included.length;
  const filterComplex = [
    ...vParts,
    ...aParts,
    `${refs.join("")}concat=n=${n}:v=1:a=1[outv][outa]`,
  ].join("; ");

  const args = [
    "-i", inputName,
    "-filter_complex", filterComplex,
    "-map", "[outv]",
    "-map", "[outa]",
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "23",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
  ];

  if (opts.changeFingerprint) {
    args.push("-map_metadata", "-1");
  }

  args.push(outputName);
  return args;
}

async function cloudRun(
  file: File,
  args: string[],
  outputName: string,
  onProgress: (p: number) => void
): Promise<{ blob: Blob; name: string }> {
  const fd = new FormData();
  fd.append("file", file, file.name);
  fd.append("args", JSON.stringify(args));
  fd.append("outputName", outputName);
  fd.append("inputName", file.name);

  const startRes = await fetch("/api/terminal-exec-async", { method: "POST", body: fd });
  if (!startRes.ok) throw new Error(await startRes.text());
  const { jobId } = (await startRes.json()) as { jobId: string };

  onProgress(15);
  let errors = 0;
  while (true) {
    await new Promise(r => setTimeout(r, 2000));
    let job: { status: string; progress?: number; error?: string };
    try {
      const r = await fetch(`/api/job/${jobId}`);
      if (!r.ok) { errors++; if (errors > 5) throw new Error("انقطع الاتصال"); continue; }
      job = await r.json();
      errors = 0;
    } catch (e) {
      errors++;
      if (errors > 5) throw e;
      continue;
    }
    if (job.status === "processing") {
      const p = job.progress ?? 0;
      if (p > 0) onProgress(15 + Math.round(p * 0.75));
    } else if (job.status === "done") break;
    else throw new Error(job.error ?? job.status);
  }

  onProgress(92);
  const dlRes = await fetch(`/api/job-result/${jobId}?dl=1`);
  if (!dlRes.ok) throw new Error("فشل تحميل الملف الناتج");
  const blob = await dlRes.blob();
  onProgress(100);
  return { blob, name: outputName };
}

function FootballPage() {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [extractMode, setExtractMode] = useLocalSettings<ExtractionMode>("vep-fb-extractMode", "text");
  const [processMode, setProcessMode] = useLocalSettings<"local" | "cloud">("vep-fb-processMode", "cloud");
  const [padding, setPadding] = useLocalSettings<number>("vep-fb-padding", 30);
  const [timestampText, setTimestampText] = useState(
    "0:45 - هدف الفريق الأول\n12:30 - هجوم خطير\n45:00 - نهاية الشوط الأول"
  );
  const [autoThreshold, setAutoThreshold] = useLocalSettings<number>("vep-fb-threshold", 12);
  const [clips, setClips] = useState<Clip[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  const [postOpts, setPostOpts] = useLocalSettings<PostOpts>("vep-fb-postOpts", {
    autoEnhance: true,
    removeTopBar: true,
    removeBottomBar: true,
    removeWatermark: false,
    wmX: 10,
    wmY: 10,
    wmW: 150,
    wmH: 50,
    changeFingerprint: true,
  });

  const [detecting, setDetecting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [outputName, setOutputName] = useState("football_highlights.mp4");
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    if (!f.type.startsWith("video/") && !f.name.match(/\.(mp4|mkv|avi|mov|webm|ts|m4v)$/i)) return;
    setFile(f);
    setClips([]);
    setOutputUrl(null);
    setError(null);
  };

  const handleParse = () => {
    const parsed = parseTextTimestamps(timestampText, padding);
    setClips(parsed);
    setError(parsed.length === 0 ? "لم يتم العثور على طوابع زمنية. تأكد من الصيغة (مثال: 1:30 - هدف)" : null);
  };

  const handleAutoDetect = async () => {
    if (!file) return;
    setDetecting(true);
    setError(null);
    setClips([]);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      fd.append("threshold", String(autoThreshold));
      const res = await fetch("/api/football-detect", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      const { timestamps } = (await res.json()) as { timestamps: number[] };
      if (timestamps.length === 0) {
        setError("لم يتم اكتشاف لقطات بارزة. جرب تقليل حساسية الكشف أو استخدم وضع النص.");
        return;
      }
      const detected: Clip[] = timestamps.map((t, i) => ({
        id: crypto.randomUUID(),
        start: Math.max(0, t - padding),
        end: t + padding,
        label: `لقطة بارزة ${i + 1} (${fmtTime(t)})`,
        include: true,
      }));
      setClips(detected);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetecting(false);
    }
  };

  const handleProcess = async () => {
    if (!file || clips.filter(c => c.include).length === 0) return;
    setProcessing(true);
    setProgress(0);
    setError(null);
    setOutputUrl(null);
    setSaved(false);

    const ext = file.name.split(".").pop() || "mp4";
    const outName = `highlights_${Date.now()}.mp4`;
    const inputName = `input.${ext}`;

    const args = buildFootballArgs(inputName, outName, clips, postOpts);
    if (args.length === 0) {
      setError("لا توجد لقطات مختارة للمعالجة");
      setProcessing(false);
      return;
    }

    try {
      if (processMode === "cloud") {
        const renamedFile = new File([file], inputName, { type: file.type });
        const { blob } = await cloudRun(renamedFile, args, outName, p => setProgress(p));
        setOutputUrl(URL.createObjectURL(new Blob([await blob.arrayBuffer()], { type: "video/mp4" })));
        setOutputName(outName);
      } else {
        const logLines: string[] = [];
        const logHandler = (msg: string) => { logLines.push(msg); setLog(logLines.slice(-8).join("\n")); };
        const ff = await getFFmpeg(logHandler);

        setProgress(5);
        await writeFileOptimized(ff, inputName, file);
        setProgress(15);

        ff.on("progress", ({ ratio }: { ratio: number }) => setProgress(15 + Math.round((ratio ?? 0) * 80)));

        await ff.exec(args);
        setProgress(97);

        const data = await ff.readFile(outName) as Uint8Array;
        setOutputUrl(URL.createObjectURL(new Blob([data], { type: "video/mp4" })));
        setOutputName(outName);
        removeLogHandler(logHandler);
      }
      setProgress(100);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
    }
  };

  const handleSave = async () => {
    if (!outputUrl) return;
    try {
      const res = await fetch(outputUrl);
      const blob = await res.blob();
      await saveVideo(blob, outputName);
      setSaved(true);
    } catch { /* ignore */ }
  };

  const patchPost = (patch: Partial<PostOpts>) => setPostOpts(p => ({ ...p, ...patch }));
  const totalDuration = clips.filter(c => c.include).reduce((s, c) => s + (c.end - c.start), 0);
  const includedCount = clips.filter(c => c.include).length;

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-emerald-600/8 blur-3xl" />
        <div className="absolute top-1/2 -left-40 w-80 h-80 rounded-full bg-violet-600/6 blur-3xl" />
      </div>

      {/* Header */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-sm sticky top-0 z-40 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <Link to="/" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition">
            <ArrowRight className="size-4" /> الرئيسية
          </Link>
          <ChevronRight className="size-3.5 text-muted-foreground/40" />
          <div className="flex items-center gap-2 font-bold text-sm">
            <div className="p-1.5 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/30">
              <Trophy className="size-4 text-white" />
            </div>
            ملخصات كرة القدم
          </div>
          <div className="mr-auto flex items-center gap-1.5 text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full px-2.5 py-1">
            <Sparkles className="size-3" /> جديد
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 grid lg:grid-cols-[1fr_360px] gap-5">
        {/* ── Left: Main area ── */}
        <div className="space-y-5">

          {/* Upload */}
          <div
            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => fileRef.current?.click()}
            className={`rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-all ${dragOver ? "border-emerald-500 bg-emerald-500/5" : file ? "border-emerald-500/40 bg-emerald-500/5" : "border-border hover:border-emerald-500/40 hover:bg-secondary/30"}`}
          >
            <input ref={fileRef} type="file" accept="video/*,.mkv,.ts" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            {file ? (
              <div className="flex items-center justify-center gap-3">
                <Film className="size-8 text-emerald-400" />
                <div className="text-right">
                  <p className="font-bold text-sm">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                </div>
                <button onClick={e => { e.stopPropagation(); setFile(null); setClips([]); setOutputUrl(null); }}
                  className="mr-auto text-muted-foreground hover:text-destructive transition p-1 rounded-lg hover:bg-destructive/10">
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <div>
                <Upload className="size-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm font-medium">ارفع فيديو المباراة</p>
                <p className="text-xs text-muted-foreground mt-1">MP4، MKV، AVI، MOV، TS — بدون حد للحجم في وضع السحابة</p>
              </div>
            )}
          </div>

          {/* Extraction Mode Tabs */}
          <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold flex items-center gap-2">
                <Scissors className="size-4 text-emerald-400" /> طريقة الاستخراج
              </h2>
              <div className="flex rounded-xl border border-border overflow-hidden">
                {(["text", "auto"] as ExtractionMode[]).map(m => (
                  <button key={m} onClick={() => setExtractMode(m)}
                    className={`px-3 py-1.5 text-xs font-semibold transition ${extractMode === m ? "bg-emerald-600 text-white" : "text-muted-foreground hover:bg-secondary"}`}>
                    {m === "text" ? "📝 نص شارح" : "🔍 كشف تلقائي"}
                  </button>
                ))}
              </div>
            </div>

            {extractMode === "text" ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  أدخل الطوابع الزمنية للأهداف والهجمات. يقبل الصيغ: <span className="font-mono text-foreground">1:30</span> أو <span className="font-mono text-foreground">45'</span> أو <span className="font-mono text-foreground">1:23:45</span>
                </p>
                <textarea
                  value={timestampText}
                  onChange={e => setTimestampText(e.target.value)}
                  dir="rtl"
                  rows={8}
                  placeholder={"0:45 - هدف الفريق الأول\n12:30 - هجوم خطير\n45:00 - ركلة حرة\n67:15 - هدف ثاني\n90' - نهاية المباراة"}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-mono focus:border-emerald-500 outline-none resize-none leading-relaxed"
                />
                <button
                  onClick={handleParse}
                  disabled={!timestampText.trim()}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:opacity-90 transition disabled:opacity-40"
                >
                  <ListChecks className="size-4" /> تحليل النص وإنشاء القائمة
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  يقوم بمسح الفيديو تلقائياً بحثاً عن التغييرات المشهدية المفاجئة (الأهداف والمواقف المثيرة). يعمل في وضع السحابة فقط.
                </p>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">حساسية الكشف</span>
                    <span className="font-mono">{autoThreshold}</span>
                  </div>
                  <input type="range" min={5} max={30} step={1} value={autoThreshold}
                    onChange={e => setAutoThreshold(+e.target.value)}
                    className="w-full accent-emerald-500" />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>حساس جداً (لقطات كثيرة)</span>
                    <span>صارم (لقطات أقل)</span>
                  </div>
                </div>
                <button
                  onClick={handleAutoDetect}
                  disabled={!file || detecting || processMode === "local"}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:opacity-90 transition disabled:opacity-40"
                >
                  {detecting ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" />}
                  {detecting ? "جاري المسح..." : "مسح الفيديو تلقائياً"}
                </button>
                {processMode === "local" && (
                  <p className="text-xs text-amber-400/90 flex items-center gap-1.5">
                    <AlertCircle className="size-3.5 flex-shrink-0" /> الكشف التلقائي يتطلب وضع السحابة — غيّر الوضع من الإعدادات
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Clips List */}
          {clips.length > 0 && (
            <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold flex items-center gap-2">
                  <Film className="size-4 text-emerald-400" /> اللقطات المكتشفة
                  <span className="bg-emerald-500/20 text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {includedCount}/{clips.length}
                  </span>
                </h2>
                <div className="flex items-center gap-2">
                  <button onClick={() => setClips(p => p.map(c => ({ ...c, include: true })))}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition px-2 py-1 rounded-lg hover:bg-secondary">
                    تحديد الكل
                  </button>
                  <button onClick={() => setClips(p => p.map(c => ({ ...c, include: false })))}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition px-2 py-1 rounded-lg hover:bg-secondary">
                    إلغاء الكل
                  </button>
                  <button onClick={() => setClips([])}
                    className="text-[10px] text-muted-foreground hover:text-destructive transition p-1 rounded-lg hover:bg-destructive/10">
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>

              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {clips.map((clip, i) => (
                  <div key={clip.id}
                    className={`flex items-center gap-3 p-3 rounded-xl border transition ${clip.include ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-card/30 opacity-60"}`}>
                    <button onClick={() => setClips(p => p.map(c => c.id === clip.id ? { ...c, include: !c.include } : c))}
                      className={`size-5 rounded-full border-2 flex items-center justify-center transition flex-shrink-0 ${clip.include ? "border-emerald-500 bg-emerald-500" : "border-border"}`}>
                      {clip.include && <Check className="size-3 text-white" />}
                    </button>

                    <div className="flex-1 min-w-0">
                      {editingId === clip.id ? (
                        <div className="flex items-center gap-2">
                          <input value={editLabel} onChange={e => setEditLabel(e.target.value)}
                            autoFocus onKeyDown={e => { if (e.key === "Enter") { setClips(p => p.map(c => c.id === clip.id ? { ...c, label: editLabel } : c)); setEditingId(null); } if (e.key === "Escape") setEditingId(null); }}
                            className="flex-1 bg-background border border-border rounded-lg px-2 py-1 text-xs outline-none focus:border-emerald-500" />
                          <button onClick={() => { setClips(p => p.map(c => c.id === clip.id ? { ...c, label: editLabel } : c)); setEditingId(null); }}
                            className="text-emerald-400 hover:opacity-80 transition"><Check className="size-3.5" /></button>
                          <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground transition"><X className="size-3.5" /></button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium truncate">{clip.label}</span>
                          <button onClick={() => { setEditingId(clip.id); setEditLabel(clip.label); }}
                            className="text-muted-foreground/40 hover:text-muted-foreground transition flex-shrink-0">
                            <Edit3 className="size-3" />
                          </button>
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground font-mono">
                        <Clock className="size-3" />
                        <span>{fmtTime(clip.start)} ← {fmtTime(Math.floor((clip.start + clip.end) / 2))} → {fmtTime(clip.end)}</span>
                        <span className="text-emerald-400">{(clip.end - clip.start).toFixed(0)}ث</span>
                      </div>
                    </div>

                    <button onClick={() => setClips(p => p.filter(c => c.id !== clip.id))}
                      className="text-muted-foreground/40 hover:text-destructive transition flex-shrink-0">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {includedCount > 0 && (
                <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border/40 pt-3">
                  <span>مدة الملخص الإجمالية</span>
                  <span className="font-mono font-bold text-emerald-400">{fmtTime(totalDuration)}</span>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertCircle className="size-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Progress */}
          {processing && (
            <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Loader2 className="size-4 animate-spin text-emerald-400" />
                <span className="text-sm font-medium">جاري استخراج الملخص...</span>
                <span className="mr-auto font-mono text-xs text-emerald-400">{progress}%</span>
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-300 rounded-full"
                  style={{ width: `${progress}%` }} />
              </div>
              {log && <pre className="text-[10px] text-muted-foreground font-mono bg-black/20 rounded-lg p-2 max-h-20 overflow-auto leading-relaxed">{log}</pre>}
            </div>
          )}

          {/* Output */}
          {outputUrl && !processing && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                <CheckCircle2 className="size-4" /> تم إنشاء الملخص بنجاح!
              </div>
              <video src={outputUrl} controls className="w-full rounded-xl max-h-72 bg-black" />
              <div className="flex gap-2 flex-wrap">
                <a href={outputUrl} download={outputName}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:opacity-90 transition">
                  <Download className="size-4" /> تحميل الملخص
                </a>
                <button onClick={handleSave} disabled={saved}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-sm font-bold hover:bg-secondary transition disabled:opacity-60">
                  {saved ? <CheckCircle2 className="size-4 text-emerald-400" /> : <Save className="size-4" />}
                  {saved ? "تم الحفظ" : "حفظ في المكتبة"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Right: Settings sidebar ── */}
        <div className="space-y-4">

          {/* Process Mode */}
          <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <Zap className="size-4 text-amber-400" /> وضع المعالجة
            </h3>
            <div className="flex rounded-xl border border-border overflow-hidden">
              {(["cloud", "local"] as const).map(m => (
                <button key={m} onClick={() => setProcessMode(m)}
                  className={`flex-1 py-2 text-xs font-semibold transition ${processMode === m ? (m === "cloud" ? "bg-sky-600 text-white" : "bg-amber-600 text-white") : "text-muted-foreground hover:bg-secondary"}`}>
                  {m === "cloud" ? "☁ سحابة" : "💻 محلي"}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              {processMode === "cloud" ? "معالجة على السيرفر — مناسب لمباريات كاملة، بدون حد للحجم" : "معالجة في المتصفح — أسرع للمقاطع الصغيرة، قد يكون بطيئاً للمباريات الكاملة"}
            </p>
          </div>

          {/* Clip Padding */}
          <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <Clock className="size-4 text-sky-400" /> هامش الوقت
            </h3>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">ثوانٍ قبل وبعد كل لحظة</span>
                <span className="font-mono font-bold">{padding}ث</span>
              </div>
              <input type="range" min={5} max={90} step={5} value={padding}
                onChange={e => setPadding(+e.target.value)}
                className="w-full accent-sky-500" />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>5ث</span>
                <span>90ث</span>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">كل لقطة = الهامش قبل اللحظة + اللحظة + الهامش بعدها</p>
          </div>

          {/* Post Processing */}
          <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-4">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <Settings2 className="size-4 text-violet-400" /> معالجة تلقائية
            </h3>

            <div className="space-y-2">
              {[
                { key: "autoEnhance" as const, label: "تحسين الألوان والحدة", icon: Wand2, color: "text-violet-400" },
                { key: "removeTopBar" as const, label: "إزالة شريط النتيجة (أعلى)", icon: Eraser, color: "text-rose-400" },
                { key: "removeBottomBar" as const, label: "إزالة أسماء اللاعبين (أسفل)", icon: Eraser, color: "text-rose-400" },
                { key: "changeFingerprint" as const, label: "تغيير البصمة الرقمية", icon: Shield, color: "text-amber-400" },
              ].map(({ key, label, icon: Icon, color }) => (
                <label key={key} className="flex items-center gap-3 cursor-pointer group">
                  <div className={`size-5 rounded-lg border-2 flex items-center justify-center transition ${postOpts[key] ? "border-violet-500 bg-violet-500" : "border-border group-hover:border-violet-500/50"}`}
                    onClick={() => patchPost({ [key]: !postOpts[key] })}>
                    {postOpts[key] && <Check className="size-3 text-white" />}
                  </div>
                  <span className="text-xs flex items-center gap-1.5">
                    <Icon className={`size-3.5 ${color}`} />
                    {label}
                  </span>
                </label>
              ))}
            </div>

            {/* Watermark Removal */}
            <div className="border-t border-border/40 pt-3 space-y-3">
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className={`size-5 rounded-lg border-2 flex items-center justify-center transition ${postOpts.removeWatermark ? "border-violet-500 bg-violet-500" : "border-border group-hover:border-violet-500/50"}`}
                  onClick={() => patchPost({ removeWatermark: !postOpts.removeWatermark })}>
                  {postOpts.removeWatermark && <Check className="size-3 text-white" />}
                </div>
                <span className="text-xs flex items-center gap-1.5">
                  <Eraser className="size-3.5 text-rose-400" /> إزالة شعار القناة
                </span>
              </label>

              {postOpts.removeWatermark && (
                <div className="grid grid-cols-2 gap-2 pl-8">
                  {(["wmX", "wmY", "wmW", "wmH"] as const).map(k => (
                    <div key={k} className="space-y-1">
                      <label className="text-[10px] text-muted-foreground">{k === "wmX" ? "X" : k === "wmY" ? "Y" : k === "wmW" ? "عرض" : "ارتفاع"}</label>
                      <input type="number" value={postOpts[k]} min={0} max={1920}
                        onChange={e => patchPost({ [k]: +e.target.value })}
                        className="w-full rounded-lg border border-border bg-background px-2 py-1 text-xs font-mono focus:border-violet-500 outline-none" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Process Button */}
          <button
            onClick={handleProcess}
            disabled={!file || includedCount === 0 || processing || detecting}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-black text-sm hover:opacity-90 transition shadow-xl shadow-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {processing ? (
              <><Loader2 className="size-4 animate-spin" /> جاري المعالجة...</>
            ) : (
              <><Trophy className="size-4" /> إنشاء الملخص ({includedCount} لقطة)</>
            )}
          </button>

          {(!file || includedCount === 0) && !processing && (
            <p className="text-center text-xs text-muted-foreground">
              {!file ? "ارفع فيديو المباراة أولاً" : "أنشئ قائمة اللقطات أولاً"}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
