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
  ChevronDown,
} from "lucide-react";

export const Route = createFileRoute("/terminal")({
  head: () => ({
    meta: [
      { title: "تيرمنال FFmpeg — Video Enhancer Pro" },
      {
        name: "description",
        content: "نفّذ أوامر FFmpeg ومعالجة الفيديو بلغات متعددة مباشرة في المتصفح.",
      },
    ],
  }),
  component: TerminalPage,
});

type Line = { kind: "in" | "out" | "err" | "sys" | "success"; text: string };

const ALL_LANGS = ["الكل", "ffmpeg", "python", "javascript", "bash", "powershell", "nodejs"];

function tokenize(cmd: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q: '"' | "'" | null = null;
  for (const c of cmd) {
    if (q) {
      if (c === q) q = null;
      else cur += c;
    } else if (c === '"' || c === "'") {
      q = c;
    } else if (c === " " || c === "\t") {
      if (cur) {
        out.push(cur);
        cur = "";
      }
    } else {
      cur += c;
    }
  }
  if (cur) out.push(cur);
  return out;
}

const HELP = `╔══════════════════════════════════════════════════════╗
║       Video Enhancer Pro — FFmpeg Terminal (wasm)    ║
╚══════════════════════════════════════════════════════╝

الأوامر المتاحة:
  ffmpeg <args>      تنفيذ أمر FFmpeg مباشرة
  upload [as <name>] رفع ملف من جهازك
  ls                 عرض الملفات في بيئة FFmpeg
  download <name>    تنزيل ملف
  cat <name>         عرض حجم الملف
  rm <name>          حذف ملف
  clear              مسح الشاشة
  help               عرض هذه القائمة

أمثلة:
  upload
  ffmpeg -i input.mp4 -vf eq=brightness=0.1 out.mp4
  download out.mp4

التلميح: اضغط ↑ للتنقل في السجل، اضغط على أي سكربت للإلصاق.`;

function TerminalPage() {
  const [lines, setLines] = useState<Line[]>([
    { kind: "sys", text: "╔══════════════════════════════════════════════════════╗" },
    { kind: "sys", text: "║   Video Enhancer Pro — FFmpeg Terminal (wasm)   ✦   ║" },
    { kind: "sys", text: "╚══════════════════════════════════════════════════════╝" },
    { kind: "sys", text: '» اكتب "help" للمساعدة، أو "upload" لرفع فيديو.' },
    { kind: "sys", text: "» تحتاج اتصالاً بالإنترنت لتحميل FFmpeg.wasm في أول مرة." },
  ]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [hIdx, setHIdx] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [langFilter, setLangFilter] = useState("الكل");
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadAsRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  function push(...ls: Line[]) {
    setLines((p) => [...p, ...ls]);
  }

  async function run(raw: string) {
    const cmd = raw.trim();
    if (!cmd) return;
    push({ kind: "in", text: "$ " + cmd });
    setHistory((h) => [cmd, ...h.slice(0, 99)]);
    setHIdx(null);

    const argv = tokenize(cmd);
    const head = argv[0]?.toLowerCase();

    if (head === "help") {
      push({ kind: "out", text: HELP });
      return;
    }
    if (head === "clear") {
      setLines([]);
      return;
    }
    if (head === "upload") {
      const asIdx = argv.indexOf("as");
      uploadAsRef.current = asIdx >= 0 ? argv[asIdx + 1] || null : null;
      fileRef.current?.click();
      return;
    }

    setBusy(true);
    const logHandler = (m: string) => push({ kind: "out", text: m });
    try {
      const ffmpeg = await getFFmpeg(logHandler);

      if (head === "ls") {
        const items = await ffmpeg.listDir("/");
        const names = items
          .filter((i: any) => !i.isDir || i.name !== ".")
          .map((i: any) => (i.isDir ? "📁 " : "📄 ") + i.name);
        push({
          kind: "out",
          text: names.length ? names.join("\n") : "(بيئة FFmpeg فارغة — استخدم upload)",
        });
      } else if (head === "rm") {
        await ffmpeg.deleteFile(argv[1]);
        push({ kind: "success", text: "✓ حُذف: " + argv[1] });
      } else if (head === "cat") {
        const d = (await ffmpeg.readFile(argv[1])) as Uint8Array;
        push({
          kind: "out",
          text: `${argv[1]} — ${(d.byteLength / 1024).toFixed(1)} KB (${d.byteLength.toLocaleString()} bytes)`,
        });
      } else if (head === "download") {
        const name = argv[1];
        if (!name) {
          push({ kind: "err", text: "استخدام: download <اسم الملف>" });
          return;
        }
        const d = (await ffmpeg.readFile(name)) as Uint8Array;
        const ext = name.split(".").pop()?.toLowerCase() || "";
        const mime =
          ext === "mp3"
            ? "audio/mpeg"
            : ext === "gif"
              ? "image/gif"
              : ext === "jpg" || ext === "jpeg"
                ? "image/jpeg"
                : ext === "png"
                  ? "image/png"
                  : "video/mp4";
        const url = URL.createObjectURL(new Blob([d.buffer as ArrayBuffer], { type: mime }));
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        push({
          kind: "success",
          text: `✓ بدأ تنزيل: ${name} (${(d.byteLength / 1024 / 1024).toFixed(2)} MB)`,
        });
      } else if (head === "ffmpeg") {
        const args = argv.slice(1);
        if (!args.length) {
          push({ kind: "err", text: "مثال: ffmpeg -i input.mp4 -vf eq=brightness=0.1 out.mp4" });
          return;
        }
        const outName = args[args.length - 1];
        push({ kind: "sys", text: `⏳ جاري التنفيذ: ffmpeg ${args.join(" ")}` });
        await ffmpeg.exec(args);
        push({ kind: "success", text: `✓ اكتمل! الناتج: ${outName}` });
        push({ kind: "sys", text: `» استخدم: download ${outName}` });
      } else {
        push({ kind: "err", text: `أمر غير معروف: "${head}" — اكتب "help" للمساعدة` });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e) || "خطأ غير معروف";
      push({ kind: "err", text: "❌ خطأ: " + msg });
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
    setBusy(true);
    const logHandler = (m: string) => push({ kind: "out", text: m });
    try {
      push({ kind: "sys", text: `⏳ جاري رفع: ${f.name} → ${name}` });
      const ffmpeg = await getFFmpeg(logHandler);
      await ffmpeg.writeFile(name, await fetchFile(f));
      push({
        kind: "success",
        text: `✓ تم الرفع: ${name} (${(f.size / 1024 / 1024).toFixed(2)} MB)`,
      });
      push({ kind: "sys", text: `» يمكنك الآن استخدام "${name}" في أوامر ffmpeg` });
    } catch (err) {
      push({
        kind: "err",
        text: "❌ فشل الرفع: " + (err instanceof Error ? err.message : String(err)),
      });
    } finally {
      removeLogHandler(logHandler);
      setBusy(false);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !busy) {
      const v = input;
      setInput("");
      run(v);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const idx = hIdx === null ? 0 : Math.min(history.length - 1, hIdx + 1);
      if (history[idx]) {
        setHIdx(idx);
        setInput(history[idx]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (hIdx === null) return;
      const idx = hIdx - 1;
      if (idx < 0) {
        setHIdx(null);
        setInput("");
      } else {
        setHIdx(idx);
        setInput(history[idx]);
      }
    }
  }

  const filtered = SNIPPETS.filter((s) => {
    const matchLang = langFilter === "الكل" || s.lang === langFilter;
    const matchText =
      !filter ||
      s.title.toLowerCase().includes(filter.toLowerCase()) ||
      s.code.toLowerCase().includes(filter.toLowerCase()) ||
      s.desc.toLowerCase().includes(filter.toLowerCase());
    return matchLang && matchText;
  });

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 border-b border-border sticky top-0 z-40 bg-background/90 backdrop-blur-sm">
        <Link
          to="/"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowRight className="size-4" /> الرئيسية
        </Link>
        <div className="flex items-center gap-2 font-semibold text-sm">
          <TerminalIcon className="size-4 text-sky-400" />
          تيرمنال FFmpeg
        </div>
        <Link to="/library" className="text-sm hover:text-primary">
          مكتبتي
        </Link>
      </header>

      <main
        className="mx-auto max-w-7xl px-6 py-5 grid gap-5 lg:grid-cols-[1fr_380px]"
        style={{ height: "calc(100vh - 72px)" }}
      >
        {/* Terminal */}
        <section className="rounded-2xl border border-border bg-[#080c12] overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50 bg-[#0d1117]">
            <div className="flex items-center gap-1.5">
              <span className="size-3 rounded-full bg-red-500/80" />
              <span className="size-3 rounded-full bg-yellow-500/80" />
              <span className="size-3 rounded-full bg-green-500/80" />
            </div>
            <span className="text-xs text-muted-foreground font-mono">
              ffmpeg@wasm:~ — Video Enhancer Pro
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  uploadAsRef.current = null;
                  fileRef.current?.click();
                }}
                disabled={busy}
                className="text-xs text-muted-foreground hover:text-sky-400 inline-flex items-center gap-1 transition disabled:opacity-40"
                title="رفع ملف"
              >
                <Upload className="size-3.5" /> رفع
              </button>
              <button
                onClick={() => setLines([])}
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition"
              >
                <Trash2 className="size-3.5" /> مسح
              </button>
            </div>
          </div>

          <div
            ref={scrollRef}
            dir="ltr"
            className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed"
          >
            {lines.map((l, i) => (
              <pre
                key={i}
                className={
                  "whitespace-pre-wrap break-words mb-0.5 " +
                  (l.kind === "in"
                    ? "text-sky-400 font-semibold"
                    : l.kind === "err"
                      ? "text-red-400"
                      : l.kind === "success"
                        ? "text-emerald-400"
                        : l.kind === "sys"
                          ? "text-violet-300/80"
                          : "text-gray-400")
                }
              >
                {l.text}
              </pre>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-yellow-400 text-xs mt-1">
                <span className="animate-pulse">▌</span>
                <span>جاري التنفيذ...</span>
              </div>
            )}
          </div>

          <div
            dir="ltr"
            className="flex items-center gap-2 border-t border-border/50 px-4 py-3 bg-[#0d1117]"
          >
            <span className="text-sky-400 font-mono font-bold text-sm">$</span>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              disabled={busy}
              placeholder={
                busy ? "⏳ جاري التنفيذ..." : "ffmpeg -i input.mp4 -vf eq=brightness=0.1 out.mp4"
              }
              className="flex-1 bg-transparent outline-none font-mono text-sm text-foreground placeholder:text-gray-600 caret-sky-400"
              autoFocus
            />
            <button
              onClick={() => {
                if (!busy && input.trim()) {
                  const v = input;
                  setInput("");
                  run(v);
                }
              }}
              disabled={busy || !input.trim()}
              className="text-sky-400 hover:text-sky-300 disabled:opacity-30 transition"
              title="تنفيذ"
            >
              <Play className="size-4" />
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={onFile}
            accept="video/*,audio/*,image/*"
          />
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
              onChange={(e) => setFilter(e.target.value)}
              placeholder="ابحث: حدّة، صوت، watermark..."
              className="w-full rounded-lg bg-input border border-border px-2.5 py-1.5 text-xs"
            />
            <div className="flex flex-wrap gap-1">
              {ALL_LANGS.map((l) => (
                <button
                  key={l}
                  onClick={() => setLangFilter(l)}
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium transition ${
                    langFilter === l
                      ? "bg-primary text-primary-foreground"
                      : "bg-background border border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-auto p-2 space-y-2">
            {filtered.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">لا توجد نتائج</p>
            )}
            {filtered.map((s) => (
              <div
                key={s.id}
                className="rounded-xl border border-border bg-background/40 p-2.5 hover:border-primary/30 transition"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs font-semibold truncate">{s.title}</span>
                  <span
                    className={`text-[9px] uppercase border rounded px-1.5 py-0.5 shrink-0 font-mono ${
                      s.lang === "ffmpeg"
                        ? "border-sky-500/40 text-sky-400"
                        : s.lang === "python"
                          ? "border-yellow-500/40 text-yellow-400"
                          : s.lang === "javascript" || s.lang === "nodejs"
                            ? "border-amber-500/40 text-amber-400"
                            : s.lang === "bash"
                              ? "border-emerald-500/40 text-emerald-400"
                              : s.lang === "powershell"
                                ? "border-blue-500/40 text-blue-400"
                                : "border-border text-muted-foreground"
                    }`}
                  >
                    {s.lang}
                  </span>
                </div>
                {s.desc && <p className="text-[10px] text-muted-foreground mb-1.5">{s.desc}</p>}
                <pre
                  dir="ltr"
                  className="text-[10px] font-mono whitespace-pre-wrap break-all text-gray-400 bg-[#080c12] rounded-lg p-2 max-h-28 overflow-auto border border-border/50"
                >
                  {s.code}
                </pre>
                <div className="flex gap-2 mt-2">
                  {s.lang === "ffmpeg" && (
                    <>
                      <button
                        onClick={() => {
                          setInput(s.code);
                          inputRef.current?.focus();
                        }}
                        className="text-[10px] text-sky-400 hover:underline font-medium"
                      >
                        إلصاق
                      </button>
                      <button
                        onClick={() => run(s.code)}
                        disabled={busy}
                        className="text-[10px] text-emerald-400 hover:underline font-medium disabled:opacity-40"
                      >
                        ▶ تنفيذ
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => navigator.clipboard.writeText(s.code)}
                    className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mr-auto"
                  >
                    <Copy className="size-3" /> نسخ
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="p-3 border-t border-border bg-card/50">
            <p className="text-[10px] text-muted-foreground text-center">
              {filtered.length} سكربت متاح · كل المعالجة محلية 100%
            </p>
          </div>
        </aside>
      </main>
    </div>
  );
}
