import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { fetchFile } from "@ffmpeg/util";
import { getFFmpeg } from "@/lib/ffmpeg-client";
import { SNIPPETS } from "@/lib/snippets";
import { ArrowRight, Terminal as TerminalIcon, Upload, Download, Trash2, Copy } from "lucide-react";

export const Route = createFileRoute("/terminal")({
  head: () => ({
    meta: [
      { title: "تيرمنال FFmpeg — Video Enhancer Pro" },
      { name: "description", content: "نفّذ أوامر FFmpeg مباشرة في المتصفح مع مكتبة جاهزة من السكربتات." },
    ],
  }),
  component: TerminalPage,
});

type Line = { kind: "in" | "out" | "err" | "sys"; text: string };

function tokenize(cmd: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q: '"' | "'" | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) {
      if (c === q) q = null;
      else cur += c;
    } else if (c === '"' || c === "'") {
      q = c;
    } else if (c === " " || c === "\t") {
      if (cur) { out.push(cur); cur = ""; }
    } else {
      cur += c;
    }
  }
  if (cur) out.push(cur);
  return out;
}

const HELP = `الأوامر المتاحة:
  ffmpeg <args...>     تنفيذ أمر FFmpeg (مثال: ffmpeg -i input.mp4 -vf eq=brightness=0.1 out.mp4)
  upload [as <name>]   رفع ملف من جهازك (افتراضياً يحفظ كـ input.<ext>)
  ls                   عرض الملفات داخل بيئة FFmpeg
  download <name>      تنزيل ملف بعد المعالجة
  cat <name>           عرض حجم الملف
  rm <name>            حذف ملف
  clear                مسح الشاشة
  help                 عرض هذه القائمة

تلميح: اضغط على أى سكربت من اللوحة الجانبية ليُلصق فى السطر.`;

function TerminalPage() {
  const [lines, setLines] = useState<Line[]>([
    { kind: "sys", text: "Video Enhancer Pro — FFmpeg Terminal (wasm)" },
    { kind: "sys", text: 'اكتب "help" للمساعدة، أو "upload" لرفع فيديو.' },
  ]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [hIdx, setHIdx] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadAsRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  function push(...ls: Line[]) {
    setLines((p) => [...p, ...ls]);
  }

  async function run(raw: string) {
    const cmd = raw.trim();
    push({ kind: "in", text: "$ " + cmd });
    if (!cmd) return;
    setHistory((h) => [...h, cmd]);
    setHIdx(null);

    const argv = tokenize(cmd);
    const head = argv[0]?.toLowerCase();

    if (head === "help") return push({ kind: "out", text: HELP });
    if (head === "clear") return setLines([]);

    if (head === "upload") {
      const asIdx = argv.indexOf("as");
      uploadAsRef.current = asIdx >= 0 ? argv[asIdx + 1] || null : null;
      fileRef.current?.click();
      return;
    }

    setBusy(true);
    try {
      const ffmpeg = await getFFmpeg((m) => push({ kind: "out", text: m }));

      if (head === "ls") {
        const items = await ffmpeg.listDir("/");
        const txt = items.map((i: any) => (i.isDir ? "d " : "- ") + i.name).join("\n");
        push({ kind: "out", text: txt || "(فارغ)" });
      } else if (head === "rm") {
        await ffmpeg.deleteFile(argv[1]);
        push({ kind: "out", text: "حُذف: " + argv[1] });
      } else if (head === "cat") {
        const d = (await ffmpeg.readFile(argv[1])) as Uint8Array;
        push({ kind: "out", text: `${argv[1]} — ${(d.byteLength / 1024).toFixed(1)} KB` });
      } else if (head === "download") {
        const name = argv[1];
        const d = (await ffmpeg.readFile(name)) as Uint8Array;
        const mime = name.endsWith(".mp3") ? "audio/mpeg" : name.endsWith(".gif") ? "image/gif" : name.endsWith(".jpg") ? "image/jpeg" : "video/mp4";
        const url = URL.createObjectURL(new Blob([d.buffer as ArrayBuffer], { type: mime }));
        const a = document.createElement("a");
        a.href = url; a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        push({ kind: "out", text: "بدأ التنزيل: " + name });
      } else if (head === "ffmpeg") {
        const args = argv.slice(1);
        const outName = args[args.length - 1];
        await ffmpeg.exec(args);
        push({ kind: "out", text: "✓ اكتمل. الناتج: " + outName });
        push({ kind: "out", text: 'استخدم: download ' + outName });
      } else {
        push({ kind: "err", text: "أمر غير معروف: " + head });
      }
    } catch (e) {
      push({ kind: "err", text: "خطأ: " + (e as Error).message });
    } finally {
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
    try {
      const ffmpeg = await getFFmpeg();
      await ffmpeg.writeFile(name, await fetchFile(f));
      push({ kind: "out", text: `تم الرفع: ${name} (${(f.size / 1024 / 1024).toFixed(2)} MB)` });
    } catch (err) {
      push({ kind: "err", text: "فشل الرفع: " + (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !busy) {
      const v = input; setInput(""); run(v);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!history.length) return;
      const idx = hIdx === null ? history.length - 1 : Math.max(0, hIdx - 1);
      setHIdx(idx); setInput(history[idx]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (hIdx === null) return;
      const idx = hIdx + 1;
      if (idx >= history.length) { setHIdx(null); setInput(""); }
      else { setHIdx(idx); setInput(history[idx]); }
    }
  }

  const filtered = SNIPPETS.filter(s =>
    !filter || s.title.includes(filter) || s.code.toLowerCase().includes(filter.toLowerCase()) || s.lang.includes(filter.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 border-b border-border">
        <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowRight className="size-4" /> الرئيسية
        </Link>
        <div className="flex items-center gap-2 font-semibold">
          <TerminalIcon className="size-4 text-primary" /> تيرمنال FFmpeg
        </div>
        <Link to="/library" className="text-sm hover:text-primary">مكتبتي</Link>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="rounded-xl border border-border bg-[#0a0e14] overflow-hidden flex flex-col" style={{ height: "70vh" }}>
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card/50">
            <div className="flex items-center gap-1.5">
              <span className="size-3 rounded-full bg-red-500/70" />
              <span className="size-3 rounded-full bg-yellow-500/70" />
              <span className="size-3 rounded-full bg-green-500/70" />
            </div>
            <span className="text-xs text-muted-foreground font-mono">ffmpeg@wasm:~</span>
            <button onClick={() => setLines([])} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              <Trash2 className="size-3" /> مسح
            </button>
          </div>
          <div ref={scrollRef} dir="ltr" className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed">
            {lines.map((l, i) => (
              <pre
                key={i}
                className={
                  "whitespace-pre-wrap break-words " +
                  (l.kind === "in" ? "text-primary" :
                    l.kind === "err" ? "text-red-400" :
                    l.kind === "sys" ? "text-accent-foreground/80" : "text-muted-foreground")
                }
              >{l.text}</pre>
            ))}
          </div>
          <div dir="ltr" className="flex items-center gap-2 border-t border-border px-3 py-2 bg-card/50">
            <span className="text-primary font-mono text-sm">$</span>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              disabled={busy}
              placeholder={busy ? "جاري التنفيذ..." : "ffmpeg -i input.mp4 -vf eq=brightness=0.1 out.mp4"}
              className="flex-1 bg-transparent outline-none font-mono text-sm text-foreground placeholder:text-muted-foreground/60"
              autoFocus
            />
            <button
              onClick={() => { uploadAsRef.current = null; fileRef.current?.click(); }}
              className="text-muted-foreground hover:text-primary"
              title="رفع ملف"
            >
              <Upload className="size-4" />
            </button>
          </div>
          <input ref={fileRef} type="file" className="hidden" onChange={onFile} />
        </section>

        <aside className="rounded-xl border border-border bg-card overflow-hidden flex flex-col" style={{ height: "70vh" }}>
          <div className="p-3 border-b border-border">
            <h2 className="text-sm font-semibold mb-2">مكتبة السكربتات</h2>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="ابحث: حدّة، صوت، ffmpeg، python..."
              className="w-full rounded-md bg-input border border-border px-2 py-1.5 text-xs"
            />
          </div>
          <div className="flex-1 overflow-auto p-2 space-y-2">
            {filtered.map((s) => (
              <div key={s.id} className="rounded-lg border border-border bg-background/40 p-2">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-semibold truncate">{s.title}</span>
                  <span className="text-[10px] uppercase text-muted-foreground border border-border rounded px-1">{s.lang}</span>
                </div>
                <pre dir="ltr" className="text-[10px] font-mono whitespace-pre-wrap break-all text-muted-foreground bg-[#0a0e14] rounded p-1.5 max-h-24 overflow-auto">{s.code}</pre>
                <div className="flex gap-2 mt-1.5">
                  {s.lang === "ffmpeg" && (
                    <button
                      onClick={() => { setInput(s.code); inputRef.current?.focus(); }}
                      className="text-[10px] text-primary hover:underline"
                    >إلصاق فى السطر</button>
                  )}
                  <button
                    onClick={() => navigator.clipboard.writeText(s.code)}
                    className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                  ><Copy className="size-3" /> نسخ</button>
                  {s.lang === "ffmpeg" && (
                    <button
                      onClick={() => run(s.code)}
                      disabled={busy}
                      className="text-[10px] text-accent hover:underline mr-auto"
                    >تنفيذ ▶</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </aside>
      </main>

      <p className="text-center text-xs text-muted-foreground pb-6">
        كل المعالجة تجرى محلياً عبر FFmpeg.wasm. ارفع ملفاً ثم استخدم اسمه (مثلاً input.mp4) فى الأمر.
      </p>
    </div>
  );
}