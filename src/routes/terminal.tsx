import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { fetchFile } from "@ffmpeg/util";
import { getFFmpeg, removeLogHandler } from "@/lib/ffmpeg-client";
import { SNIPPETS } from "@/lib/snippets";
import {
  ArrowRight,
  Terminal as TerminalIcon,
  Upload,
  Download,
  Trash2,
  Copy,
  Search,
  Play,
  Cloud,
  Cpu,
  Loader2,
} from "lucide-react";

export const Route = createFileRoute("/terminal")({
  head: () => ({
    meta: [
      { title: "تيرمنال FFmpeg — Video Enhancer Pro" },
      { name: "description", content: "نفّذ أوامر FFmpeg ومعالجة الفيديو بلغات متعددة مباشرة في المتصفح أو عبر السحابة." },
    ],
  }),
  component: TerminalPage,
});

type Line = { kind: "in" | "out" | "err" | "sys" | "success" | "cloud"; text: string };

const ALL_LANGS = ["الكل", "ffmpeg", "python", "javascript", "bash", "powershell", "nodejs"];

function tokenize(cmd: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q: '"' | "'" | null = null;
  for (const c of cmd) {
    if (q) { if (c === q) q = null; else cur += c; }
    else if (c === '"' || c === "'") { q = c; }
    else if (c === " " || c === "\t") { if (cur) { out.push(cur); cur = ""; } }
    else { cur += c; }
  }
  if (cur) out.push(cur);
  return out;
}

const HELP = `╔══════════════════════════════════════════════════════╗
║       Video Enhancer Pro — FFmpeg Terminal           ║
╚══════════════════════════════════════════════════════╝

الأوامر المتاحة:
  ffmpeg <args>      تنفيذ FFmpeg (محلي wasm أو سحابي حسب الوضع)
  upload [as <name>] رفع ملف من جهازك
  ls                 عرض الملفات في بيئة FFmpeg (وضع محلي)
  download <name>    تنزيل ملف
  cat <name>         عرض حجم الملف
  rm <name>          حذف ملف
  clear              مسح الشاشة
  help               عرض هذه القائمة

أمثلة:
  upload
  ffmpeg -i input.mp4 -vf eq=brightness=0.1 out.mp4
  download out.mp4

🌐 الوضع السحابي:
  يرسل الملف والأمر للسيرفر لتنفيذ ffmpeg الحقيقي (بدون حدود الـ WASM).
  مناسب للفيديوهات الكبيرة والعمليات المعقدة.

التلميح: اضغط ↑ للتنقل في السجل، اضغط على أي سكربت للإلصاق.`;

// ── Cloud execution helper — async polling ────────────────────────────────────
async function runCloudCommand(
  args: string[],
  file: File | null,
  inputName: string,
  push: (l: Line) => void,
): Promise<string | null> {
  if (!file) {
    push({ kind: "err", text: "⚠ الوضع السحابي يتطلب رفع ملف أولاً (استخدم upload)" });
    return null;
  }
  const outputName = args[args.length - 1] || "output.mp4";
  const fd = new FormData();
  fd.append("file", file, inputName);
  fd.append("args", JSON.stringify(args));
  fd.append("outputName", outputName);
  fd.append("inputName", inputName);

  push({ kind: "cloud", text: `☁ جاري الإرسال للسيرفر (${(file.size / 1024 / 1024).toFixed(1)} MB)...` });

  // Start async job — returns immediately with jobId
  const startRes = await fetch("/api/terminal-exec-async", { method: "POST", body: fd });
  if (!startRes.ok) {
    const txt = await startRes.text().catch(() => startRes.statusText);
    throw new Error(`فشل بدء العملية: ${txt.slice(0, 300)}`);
  }
  const { jobId } = await startRes.json() as { jobId: string; outputName: string };
  push({ kind: "cloud", text: `☁ بدأ التنفيذ على السيرفر... (${jobId.slice(0, 8)})` });

  // Poll until done
  let lastPct = -1;
  let pollErrors = 0;
  while (true) {
    await new Promise(r => setTimeout(r, 2000));
    let job: { status: string; progress?: number; error?: string };
    try {
      const pollRes = await fetch(`/api/job/${jobId}`);
      if (!pollRes.ok) { pollErrors++; if (pollErrors > 5) throw new Error("فقدان الاتصال بالسيرفر"); continue; }
      job = await pollRes.json();
      pollErrors = 0;
    } catch (e) {
      pollErrors++;
      if (pollErrors > 5) throw e;
      continue;
    }

    if (job.status === "processing") {
      const pct = job.progress ?? 0;
      if (pct !== lastPct && pct > 0) {
        push({ kind: "cloud", text: `☁ معالجة: ${pct}%` });
        lastPct = pct;
      }
    } else if (job.status === "done") {
      break;
    } else if (job.status === "failed" || job.status === "cancelled") {
      throw new Error(`فشل التنفيذ: ${job.error || job.status}`);
    }
  }

  // Fetch result and trigger download
  push({ kind: "cloud", text: `☁ اكتملت المعالجة — جاري تنزيل النتيجة...` });
  const dlRes = await fetch(`/api/job-result/${jobId}?dl=1`);
  if (!dlRes.ok) throw new Error("فشل جلب الملف الناتج من السيرفر");
  const blob = await dlRes.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = outputName; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  push({ kind: "success", text: `✓ اكتمل! الناتج: ${outputName} (${(blob.size / 1024 / 1024).toFixed(2)} MB) — بدأ التنزيل` });
  return outputName;
}

function TerminalPage() {
  const [lines, setLines] = useState<Line[]>([
    { kind: "sys", text: "╔══════════════════════════════════════════════════════╗" },
    { kind: "sys", text: "║   Video Enhancer Pro — FFmpeg Terminal   ✦           ║" },
    { kind: "sys", text: "╚══════════════════════════════════════════════════════╝" },
    { kind: "sys", text: '» اكتب "help" للمساعدة، أو "upload" لرفع فيديو.' },
    { kind: "sys", text: '» فعّل "الوضع السحابي ☁" لتنفيذ أوامر ffmpeg الحقيقية عبر السيرفر.' },
  ]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [hIdx, setHIdx] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [langFilter, setLangFilter] = useState("الكل");
  const [cloudMode, setCloudMode] = useState(false);
  const [cloudFile, setCloudFile] = useState<File | null>(null);
  const [cloudInputName, setCloudInputName] = useState("input.mp4");

  const fileRef = useRef<HTMLInputElement>(null);
  const uploadAsRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  function push(...ls: Line[]) { setLines(p => [...p, ...ls]); }

  async function run(raw: string) {
    const cmd = raw.trim();
    if (!cmd) return;
    push({ kind: "in", text: "$ " + cmd });
    setHistory(h => [cmd, ...h.slice(0, 99)]);
    setHIdx(null);

    const argv = tokenize(cmd);
    const head = argv[0]?.toLowerCase();

    if (head === "help") { push({ kind: "out", text: HELP }); return; }
    if (head === "clear") { setLines([]); return; }
    if (head === "upload") {
      const asIdx = argv.indexOf("as");
      uploadAsRef.current = asIdx >= 0 ? argv[asIdx + 1] || null : null;
      fileRef.current?.click();
      return;
    }

    setBusy(true);

    // ── Cloud mode: only handles ffmpeg commands ───────────────────────────
    if (cloudMode && head === "ffmpeg") {
      try {
        const args = argv.slice(1);
        if (!args.length) { push({ kind: "err", text: "مثال: ffmpeg -i input.mp4 -vf eq=brightness=0.1 out.mp4" }); return; }
        await runCloudCommand(args, cloudFile, cloudInputName, push);
      } catch (e) {
        push({ kind: "err", text: "❌ خطأ سحابي: " + (e instanceof Error ? e.message : String(e)) });
      } finally { setBusy(false); }
      return;
    }

    // ── Local WASM mode ────────────────────────────────────────────────────
    const logHandler = (m: string) => push({ kind: "out", text: m });
    try {
      const ffmpeg = await getFFmpeg(logHandler);
      if (head === "ls") {
        const items = await ffmpeg.listDir("/");
        const names = items.filter((i: any) => !i.isDir || i.name !== ".").map((i: any) => (i.isDir ? "📁 " : "📄 ") + i.name);
        push({ kind: "out", text: names.length ? names.join("\n") : "(بيئة FFmpeg فارغة — استخدم upload)" });
      } else if (head === "rm") {
        await ffmpeg.deleteFile(argv[1]);
        push({ kind: "success", text: "✓ حُذف: " + argv[1] });
      } else if (head === "cat") {
        const d = (await ffmpeg.readFile(argv[1])) as Uint8Array;
        push({ kind: "out", text: `${argv[1]} — ${(d.byteLength / 1024).toFixed(1)} KB (${d.byteLength.toLocaleString()} bytes)` });
      } else if (head === "download") {
        const name = argv[1];
        if (!name) { push({ kind: "err", text: "استخدام: download <اسم الملف>" }); return; }
        const d = (await ffmpeg.readFile(name)) as Uint8Array;
        const ext = name.split(".").pop()?.toLowerCase() || "";
        const mime = ext === "mp3" ? "audio/mpeg" : ext === "gif" ? "image/gif" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : "video/mp4";
        const url = URL.createObjectURL(new Blob([d], { type: mime }));
        const a = document.createElement("a");
        a.href = url; a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        push({ kind: "success", text: `✓ بدأ تنزيل: ${name} (${(d.byteLength / 1024 / 1024).toFixed(2)} MB)` });
      } else if (head === "ffmpeg") {
        const args = argv.slice(1);
        if (!args.length) { push({ kind: "err", text: "مثال: ffmpeg -i input.mp4 -vf eq=brightness=0.1 out.mp4" }); return; }
        const outName = args[args.length - 1];
        push({ kind: "sys", text: `⏳ جاري التنفيذ: ffmpeg ${args.join(" ")}` });
        await ffmpeg.exec(args);
        push({ kind: "success", text: `✓ اكتمل! الناتج: ${outName}` });
        push({ kind: "sys", text: `» استخدم: download ${outName}` });
      } else {
        push({ kind: "err", text: `أمر غير معروف: "${head}" — اكتب "help" للمساعدة` });
      }
    } catch (e) {
      push({ kind: "err", text: "❌ خطأ: " + (e instanceof Error ? e.message : String(e) || "خطأ غير معروف") });
    } finally {
      removeLogHandler(logHandler);
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const ext = f.name.split(".").pop() || "mp4";
    const name = uploadAsRef.current || "input." + ext;

    // In cloud mode, just store the file reference
    if (cloudMode) {
      setCloudFile(f);
      setCloudInputName(name);
      push({ kind: "success", text: `✓ تم تحميل: ${f.name} → ${name} (${(f.size / 1024 / 1024).toFixed(2)} MB) — جاهز للإرسال للسيرفر` });
      push({ kind: "sys", text: "» الآن نفّذ: ffmpeg -i " + name + " [خياراتك] output.mp4" });
      return;
    }

    // Local mode: write to WASM filesystem
    setBusy(true);
    const logHandler = (m: string) => push({ kind: "out", text: m });
    try {
      push({ kind: "sys", text: `⏳ جاري رفع: ${f.name} → ${name}` });
      const ffmpeg = await getFFmpeg(logHandler);
      await ffmpeg.writeFile(name, await fetchFile(f));
      push({ kind: "success", text: `✓ تم الرفع: ${name} (${(f.size / 1024 / 1024).toFixed(2)} MB)` });
      push({ kind: "sys", text: `» يمكنك الآن استخدام "${name}" في أوامر ffmpeg` });
    } catch (err) {
      push({ kind: "err", text: "❌ فشل الرفع: " + (err instanceof Error ? err.message : String(err)) });
    } finally {
      removeLogHandler(logHandler);
      setBusy(false);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !busy) { const v = input; setInput(""); run(v); }
    else if (e.key === "ArrowUp") {
      e.preventDefault();
      const idx = hIdx === null ? 0 : Math.min(history.length - 1, hIdx + 1);
      if (history[idx]) { setHIdx(idx); setInput(history[idx]); }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (hIdx === null) return;
      const idx = hIdx - 1;
      if (idx < 0) { setHIdx(null); setInput(""); } else { setHIdx(idx); setInput(history[idx]); }
    }
  }

  const filtered = SNIPPETS.filter(s => {
    const matchLang = langFilter === "الكل" || s.lang === langFilter;
    const matchText = !filter || s.title.toLowerCase().includes(filter.toLowerCase()) || s.code.toLowerCase().includes(filter.toLowerCase()) || s.desc.toLowerCase().includes(filter.toLowerCase());
    return matchLang && matchText;
  });

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 border-b border-border sticky top-0 z-40 bg-background/90 backdrop-blur-sm">
        <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition">
          <ArrowRight className="size-4" /> الرئيسية
        </Link>
        <div className="flex items-center gap-2 font-semibold text-sm">
          <TerminalIcon className="size-4 text-sky-400" />
          تيرمنال FFmpeg
        </div>

        {/* Cloud mode toggle */}
        <button
          onClick={() => {
            const next = !cloudMode;
            setCloudMode(next);
            if (next) setCloudFile(null);
            push({ kind: "sys", text: next ? "☁ تم تفعيل الوضع السحابي — أوامر ffmpeg ستُنفَّذ على السيرفر" : "💻 تم تفعيل الوضع المحلي (WASM)" });
          }}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold border transition ${cloudMode ? "bg-sky-500/15 border-sky-500/40 text-sky-400" : "bg-muted border-border text-muted-foreground hover:text-foreground"}`}
        >
          {cloudMode ? <Cloud className="size-3.5" /> : <Cpu className="size-3.5" />}
          {cloudMode ? "سحابي ☁" : "محلي 💻"}
        </button>
      </header>

      {/* Cloud mode banner */}
      {cloudMode && (
        <div className="bg-sky-500/10 border-b border-sky-500/20 px-6 py-2.5">
          <div className="max-w-7xl mx-auto flex items-center gap-3 text-xs text-sky-300">
            <Cloud className="size-3.5 shrink-0" />
            <span>
              <strong>الوضع السحابي مفعّل</strong> — أوامر <code className="font-mono bg-sky-500/20 px-1 rounded">ffmpeg</code> ستُنفَّذ على السيرفر باستخدام FFmpeg الكامل بدون حدود.
              {cloudFile ? <span className="text-sky-200 mr-2">· الملف: <strong>{cloudInputName}</strong></span> : <span className="text-sky-400/70 mr-2">· ارفع ملفاً أولاً بأمر <code className="font-mono">upload</code></span>}
            </span>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-6 py-5 grid gap-5 lg:grid-cols-[1fr_380px]" style={{ height: cloudMode ? "calc(100vh - 108px)" : "calc(100vh - 72px)" }}>
        {/* Terminal */}
        <section className="rounded-2xl border border-border bg-[#080c12] overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50 bg-[#0d1117]">
            <div className="flex items-center gap-1.5">
              <span className="size-3 rounded-full bg-red-500/80" />
              <span className="size-3 rounded-full bg-yellow-500/80" />
              <span className="size-3 rounded-full bg-green-500/80" />
            </div>
            <span className="text-xs text-muted-foreground font-mono">
              {cloudMode ? "ffmpeg@cloud:~ — Video Enhancer Pro" : "ffmpeg@wasm:~ — Video Enhancer Pro"}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { uploadAsRef.current = null; fileRef.current?.click(); }}
                disabled={busy}
                className="text-xs text-muted-foreground hover:text-sky-400 inline-flex items-center gap-1 transition disabled:opacity-40"
              >
                <Upload className="size-3.5" /> رفع
              </button>
              <button onClick={() => setLines([])} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition">
                <Trash2 className="size-3.5" /> مسح
              </button>
            </div>
          </div>

          <div ref={scrollRef} dir="ltr" className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed">
            {lines.map((l, i) => (
              <pre key={i} className={
                "whitespace-pre-wrap break-words mb-0.5 " +
                (l.kind === "in" ? "text-sky-400 font-semibold"
                  : l.kind === "err" ? "text-red-400"
                  : l.kind === "success" ? "text-emerald-400"
                  : l.kind === "cloud" ? "text-cyan-300"
                  : l.kind === "sys" ? "text-violet-300/80"
                  : "text-gray-400")
              }>{l.text}</pre>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-yellow-400 text-xs mt-1">
                <Loader2 className="size-3 animate-spin" />
                <span>{cloudMode ? "☁ جاري التنفيذ على السيرفر..." : "جاري التنفيذ..."}</span>
              </div>
            )}
          </div>

          <div dir="ltr" className="flex items-center gap-2 border-t border-border/50 px-4 py-3 bg-[#0d1117]">
            <span className={`font-mono font-bold text-sm ${cloudMode ? "text-cyan-400" : "text-sky-400"}`}>$</span>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKey}
              disabled={busy}
              placeholder={busy ? (cloudMode ? "☁ جاري التنفيذ السحابي..." : "⏳ جاري التنفيذ...") : "ffmpeg -i input.mp4 -vf eq=brightness=0.1 out.mp4"}
              className="flex-1 bg-transparent outline-none font-mono text-sm text-foreground placeholder:text-gray-600 caret-sky-400"
              autoFocus
            />
            <button
              onClick={() => { if (!busy && input.trim()) { const v = input; setInput(""); run(v); } }}
              disabled={busy || !input.trim()}
              className={`transition disabled:opacity-30 ${cloudMode ? "text-cyan-400 hover:text-cyan-300" : "text-sky-400 hover:text-sky-300"}`}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            </button>
          </div>
          <input ref={fileRef} type="file" className="hidden" onChange={onFile} accept="video/*,audio/*,image/*" />
        </section>

        {/* Snippets Sidebar */}
        <aside className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col">
          <div className="p-3 border-b border-border space-y-2">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Search className="size-3.5 text-muted-foreground" />
              مكتبة الأوامر والسكربتات
            </h2>
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="ابحث: حدّة، صوت، watermark..."
              className="w-full rounded-lg bg-input border border-border px-2.5 py-1.5 text-xs"
            />
            <div className="flex flex-wrap gap-1">
              {ALL_LANGS.map(l => (
                <button
                  key={l}
                  onClick={() => setLangFilter(l)}
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium transition ${langFilter === l ? "bg-primary text-primary-foreground" : "bg-background border border-border text-muted-foreground hover:border-primary/50"}`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-auto p-2 space-y-2">
            {filtered.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">لا توجد نتائج</p>}
            {filtered.map(s => (
              <div key={s.id} className="rounded-xl border border-border bg-background/40 p-2.5 hover:border-primary/30 transition">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs font-semibold truncate">{s.title}</span>
                  <span className={`text-[9px] uppercase border rounded px-1.5 py-0.5 shrink-0 font-mono ${s.lang === "ffmpeg" ? "border-sky-500/40 text-sky-400" : s.lang === "python" ? "border-yellow-500/40 text-yellow-400" : s.lang === "javascript" || s.lang === "nodejs" ? "border-amber-500/40 text-amber-400" : s.lang === "bash" ? "border-emerald-500/40 text-emerald-400" : s.lang === "powershell" ? "border-blue-500/40 text-blue-400" : "border-border text-muted-foreground"}`}>
                    {s.lang}
                  </span>
                </div>
                {s.desc && <p className="text-[10px] text-muted-foreground mb-1.5">{s.desc}</p>}
                <pre dir="ltr" className="text-[10px] font-mono whitespace-pre-wrap break-all text-gray-400 bg-[#080c12] rounded-lg p-2 max-h-28 overflow-auto border border-border/50">
                  {s.code}
                </pre>
                <div className="flex gap-2 mt-2">
                  {s.lang === "ffmpeg" && (
                    <>
                      <button onClick={() => { setInput(s.code); inputRef.current?.focus(); }} className="text-[10px] text-sky-400 hover:underline font-medium">إلصاق</button>
                      <button onClick={() => run(s.code)} disabled={busy} className="text-[10px] text-emerald-400 hover:underline font-medium disabled:opacity-40">
                        {cloudMode ? "☁ تنفيذ سحابي" : "▶ تنفيذ"}
                      </button>
                    </>
                  )}
                  <button onClick={() => navigator.clipboard.writeText(s.code)} className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mr-auto">
                    <Copy className="size-3" /> نسخ
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="p-3 border-t border-border bg-card/50">
            <p className="text-[10px] text-muted-foreground text-center">
              {filtered.length} سكربت متاح · {cloudMode ? "☁ وضع سحابي" : "💻 معالجة محلية 100%"}
            </p>
          </div>
        </aside>
      </main>
    </div>
  );
}
