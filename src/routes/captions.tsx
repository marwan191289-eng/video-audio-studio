import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState, useCallback } from "react";
import { fetchFile } from "@ffmpeg/util";
import { getFFmpeg, removeLogHandler, fastEncodeArgs } from "@/lib/ffmpeg-client";
import {
  ArrowRight, Upload, Download, Loader2, CheckCircle2, AlertCircle,
  RefreshCw, X, Cloud, Cpu, Plus, Trash2, Edit3, FileText, Mic,
  Flame, Layers, Languages, Bold, Italic, AlignCenter, Copy, Check,
  Film, ChevronDown, ChevronRight, Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/captions")({
  head: () => ({
    meta: [
      { title: "الترجمات والكابشن — Video Enhancer Pro" },
      { name: "description", content: "حرق الترجمات، إضافة ترجمات ناعمة، استخراج، تحويل صيغ SRT/VTT/ASS، ومحرر ترجمات كامل." },
    ],
  }),
  component: CaptionsPage,
});

type CaptionTab = "burn" | "soft" | "extract" | "convert" | "editor" | "transcribe";

interface BurnStyle {
  fontName: string;
  fontSize: number;
  textColor: string;
  outlineColor: string;
  alignment: number;
  marginV: number;
  bold: boolean;
  italic: boolean;
  outline: number;
  shadow: number;
  backgroundBox: boolean;
}

interface SrtEntry {
  id: number;
  start: string;
  end: string;
  text: string;
}

const TABS: { id: CaptionTab; label: string; icon: React.ElementType; desc: string; color: string }[] = [
  { id: "burn",      label: "حرق الترجمات",    icon: Flame,       desc: "ادمج الكابشن بشكل دائم في الفيديو",     color: "from-orange-500 to-red-500" },
  { id: "soft",      label: "ترجمات ناعمة",    icon: Layers,      desc: "أضف مسار ترجمة قابل للتشغيل/الإيقاف",   color: "from-blue-500 to-cyan-500" },
  { id: "extract",   label: "استخراج الترجمات", icon: FileText,    desc: "استخرج الترجمات المضمّنة من الفيديو",    color: "from-emerald-500 to-teal-500" },
  { id: "convert",   label: "تحويل الصيغة",    icon: RefreshCw,   desc: "SRT ↔ VTT ↔ ASS بدون ملف فيديو",        color: "from-violet-500 to-purple-500" },
  { id: "editor",    label: "محرر SRT",         icon: Edit3,       desc: "أنشئ وحرّر ترجمات من الصفر",            color: "from-fuchsia-500 to-pink-500" },
  { id: "transcribe",label: "نسخ الصوت",        icon: Mic,         desc: "تحويل الصوت إلى نص مكتوب (AI)",         color: "from-amber-500 to-orange-500" },
];

const FONTS = ["Arial", "Cairo", "Noto Sans Arabic", "Times New Roman", "Georgia", "Courier New", "Verdana", "Tahoma"];
const POSITIONS = [
  { label: "أسفل وسط (افتراضي)", value: 2, marginV: 30 },
  { label: "أسفل يسار",          value: 1, marginV: 30 },
  { label: "أسفل يمين",         value: 3, marginV: 30 },
  { label: "وسط الشاشة",        value: 5, marginV: 0  },
  { label: "أعلى وسط",          value: 8, marginV: 30 },
  { label: "أعلى يسار",         value: 7, marginV: 30 },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function hexToAssColor(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `&H00${b.toString(16).padStart(2, "0").toUpperCase()}${g.toString(16).padStart(2, "0").toUpperCase()}${r.toString(16).padStart(2, "0").toUpperCase()}`;
}

function buildForceStyle(s: BurnStyle): string {
  return [
    `FontName=${s.fontName}`,
    `FontSize=${s.fontSize}`,
    `PrimaryColour=${hexToAssColor(s.textColor)}`,
    `OutlineColour=${hexToAssColor(s.outlineColor)}`,
    `BackColour=&H80000000`,
    `Bold=${s.bold ? 1 : 0}`,
    `Italic=${s.italic ? 1 : 0}`,
    `BorderStyle=${s.backgroundBox ? 4 : 1}`,
    `Outline=${s.outline}`,
    `Shadow=${s.shadow}`,
    `Alignment=${s.alignment}`,
    `MarginV=${s.marginV}`,
    `MarginL=15`,
    `MarginR=15`,
  ].join(",");
}

function parseSrt(raw: string): SrtEntry[] {
  const blocks = raw.trim().split(/\n\s*\n/);
  const entries: SrtEntry[] = [];
  let id = 1;
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;
    const timeLine = lines.find(l => l.includes("-->"));
    if (!timeLine) continue;
    const m = timeLine.match(/(\d{1,2}:\d{2}:\d{2}[,\.]\d{2,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,\.]\d{2,3})/);
    if (!m) continue;
    const text = lines.slice(lines.indexOf(timeLine) + 1).join("\n").trim();
    entries.push({ id: id++, start: m[1].replace(".", ","), end: m[2].replace(".", ","), text });
  }
  return entries;
}

function formatSrt(entries: SrtEntry[]): string {
  return entries.map((e, i) => `${i + 1}\n${e.start} --> ${e.end}\n${e.text}`).join("\n\n");
}

function srtToVtt(srt: string): string {
  const entries = parseSrt(srt);
  if (!entries.length) return "WEBVTT\n\n";
  const body = entries
    .map((e, i) => `${i + 1}\n${e.start.replace(",", ".")} --> ${e.end.replace(",", ".")}\n${e.text}`)
    .join("\n\n");
  return `WEBVTT\n\n${body}`;
}

function vttToSrt(vtt: string): string {
  const cleaned = vtt.replace(/^WEBVTT[^\n]*\n/, "").replace(/^NOTE[^\n]*\n[^\n]*\n/gm, "");
  return parseSrt(cleaned.replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, "$1,$2")).length
    ? formatSrt(parseSrt(cleaned.replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, "$1,$2")))
    : "";
}

function srtTimeToAss(t: string): string {
  const [hms, ms = "0"] = t.split(",");
  const parts = hms.split(":");
  const cs = Math.round(parseInt(ms.padEnd(3, "0").slice(0, 3)) / 10).toString().padStart(2, "0");
  return `${parseInt(parts[0])}:${parts[1]}:${parts[2]}.${cs}`;
}

function srtToAss(srt: string): string {
  const entries = parseSrt(srt);
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,30,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const events = entries.map(e => `Dialogue: 0,${srtTimeToAss(e.start)},${srtTimeToAss(e.end)},Default,,0,0,0,,${e.text.replace(/\n/g, "\\N")}`).join("\n");
  return header + events;
}

function assToSrt(ass: string): string {
  const lines = ass.split("\n").filter(l => l.startsWith("Dialogue:"));
  const entries: SrtEntry[] = lines.map((line, i) => {
    const parts = line.split(",");
    const start = parts[1] || "0:00:00.00";
    const end = parts[2] || "0:00:00.00";
    const text = parts.slice(9).join(",").replace(/\\N/gi, "\n").replace(/\{[^}]+\}/g, "").trim();
    const toSrtTime = (t: string) => {
      const m = t.match(/(\d+):(\d{2}):(\d{2})\.(\d{2})/);
      if (!m) return "00:00:00,000";
      const ms = (parseInt(m[4]) * 10).toString().padEnd(3, "0");
      return `${m[1].padStart(2, "0")}:${m[2]}:${m[3]},${ms}`;
    };
    return { id: i + 1, start: toSrtTime(start), end: toSrtTime(end), text };
  });
  return formatSrt(entries);
}

function newEntryAfter(entries: SrtEntry[]): SrtEntry {
  const last = entries[entries.length - 1];
  if (!last) return { id: Date.now(), start: "00:00:01,000", end: "00:00:04,000", text: "" };
  const toMs = (t: string) => {
    const [hms, ms = "0"] = t.split(",");
    const [h, m, s] = hms.split(":").map(Number);
    return h * 3600000 + m * 60000 + s * 1000 + parseInt(ms);
  };
  const fromMs = (ms: number) => {
    const h = Math.floor(ms / 3600000); ms %= 3600000;
    const m = Math.floor(ms / 60000); ms %= 60000;
    const s = Math.floor(ms / 1000); const f = ms % 1000;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(f).padStart(3, "0")}`;
  };
  const endMs = toMs(last.end) + 500;
  return { id: Date.now(), start: fromMs(endMs), end: fromMs(endMs + 3000), text: "" };
}

// ── SRT Editor Panel ─────────────────────────────────────────────────────────

function SrtEditorPanel({ entries, setEntries }: { entries: SrtEntry[]; setEntries: (e: SrtEntry[]) => void }) {
  const [editId, setEditId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const addEntry = () => {
    const e = newEntryAfter(entries);
    setEntries([...entries, e]);
    setEditId(e.id);
  };

  const deleteEntry = (id: number) => {
    setEntries(entries.filter(e => e.id !== id));
    if (editId === id) setEditId(null);
  };

  const updateEntry = (id: number, patch: Partial<SrtEntry>) => {
    setEntries(entries.map(e => e.id === id ? { ...e, ...patch } : e));
  };

  const importFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = ev => {
      const txt = ev.target?.result as string;
      if (file.name.endsWith(".vtt")) setEntries(parseSrt(vttToSrt(txt)));
      else if (file.name.endsWith(".ass") || file.name.endsWith(".ssa")) setEntries(parseSrt(assToSrt(txt)));
      else setEntries(parseSrt(txt));
    };
    reader.readAsText(file);
  };

  const exportSrt = () => {
    const blob = new Blob([formatSrt(entries)], { type: "text/plain" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "captions.srt"; a.click();
  };

  const exportVtt = () => {
    const blob = new Blob([srtToVtt(formatSrt(entries))], { type: "text/vtt" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "captions.vtt"; a.click();
  };

  const copyAll = () => {
    navigator.clipboard.writeText(formatSrt(entries));
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={addEntry} className="flex items-center gap-1.5 rounded-lg bg-fuchsia-600 px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 transition">
          <Plus className="size-3.5" /> إضافة سطر
        </button>
        <label className="flex items-center gap-1.5 rounded-lg bg-secondary border border-border px-3 py-1.5 text-xs font-medium cursor-pointer hover:bg-muted transition">
          <Upload className="size-3.5" /> استيراد SRT/VTT
          <input type="file" accept=".srt,.vtt,.ass,.ssa" className="hidden" onChange={e => e.target.files?.[0] && importFile(e.target.files[0])} />
        </label>
        <div className="flex-1" />
        <button onClick={copyAll} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary transition">
          {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
          {copied ? "تم النسخ" : "نسخ الكل"}
        </button>
        <button onClick={exportVtt} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary transition">
          <Download className="size-3.5" /> VTT
        </button>
        <button onClick={exportSrt} className="flex items-center gap-1.5 rounded-lg bg-fuchsia-600/20 border border-fuchsia-500/40 text-fuchsia-300 px-3 py-1.5 text-xs font-bold hover:bg-fuchsia-600/30 transition">
          <Download className="size-3.5" /> تصدير SRT
        </button>
      </div>

      {entries.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-border/60 py-12 text-center text-muted-foreground">
          <Edit3 className="size-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm">لا توجد إدخالات — انقر "إضافة سطر" أو استورد ملف</p>
        </div>
      )}

      <div className="space-y-2 max-h-[480px] overflow-y-auto pl-1">
        {entries.map((e, i) => (
          <div key={e.id} className={`rounded-xl border ${editId === e.id ? "border-fuchsia-500/50 bg-fuchsia-500/5" : "border-border bg-card/40"} transition`}>
            <div className="flex items-center gap-3 px-3 py-2">
              <span className="text-xs font-mono text-muted-foreground w-6 text-center">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                  <span>{e.start}</span>
                  <span>→</span>
                  <span>{e.end}</span>
                </div>
                {editId !== e.id && (
                  <p className="text-sm mt-0.5 truncate">{e.text || <span className="text-muted-foreground italic">فارغ</span>}</p>
                )}
              </div>
              <button onClick={() => setEditId(editId === e.id ? null : e.id)} className="p-1.5 rounded-lg hover:bg-secondary transition text-muted-foreground hover:text-foreground">
                <Edit3 className="size-3.5" />
              </button>
              <button onClick={() => deleteEntry(e.id)} className="p-1.5 rounded-lg hover:bg-red-500/15 hover:text-red-400 transition text-muted-foreground">
                <Trash2 className="size-3.5" />
              </button>
            </div>
            {editId === e.id && (
              <div className="px-3 pb-3 space-y-2 border-t border-border/60 pt-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">بداية (HH:MM:SS,mmm)</label>
                    <input value={e.start} onChange={ev => updateEntry(e.id, { start: ev.target.value })}
                      className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-mono focus:border-fuchsia-500 outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">نهاية (HH:MM:SS,mmm)</label>
                    <input value={e.end} onChange={ev => updateEntry(e.id, { end: ev.target.value })}
                      className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-mono focus:border-fuchsia-500 outline-none" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">النص</label>
                  <textarea value={e.text} onChange={ev => updateEntry(e.id, { text: ev.target.value })} rows={2}
                    className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm resize-none focus:border-fuchsia-500 outline-none" />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {entries.length > 0 && (
        <div className="rounded-xl border border-border bg-card/30 p-3">
          <p className="text-[10px] text-muted-foreground mb-1.5 font-mono">معاينة SRT</p>
          <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap max-h-32 overflow-y-auto leading-relaxed">
            {formatSrt(entries.slice(0, 3))}{entries.length > 3 ? `\n\n... +${entries.length - 3} مزيد` : ""}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

const DEFAULT_STYLE: BurnStyle = {
  fontName: "Arial", fontSize: 28, textColor: "#FFFFFF", outlineColor: "#000000",
  alignment: 2, marginV: 30, bold: false, italic: false, outline: 2, shadow: 1, backgroundBox: false,
};

function CaptionsPage() {
  const [tab, setTab] = useState<CaptionTab>("burn");
  const [processMode, setProcessMode] = useState<"local" | "cloud">("cloud");

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [subtitleFile, setSubtitleFile] = useState<File | null>(null);

  const [burnStyle, setBurnStyle] = useState<BurnStyle>(DEFAULT_STYLE);
  const [softFormat, setSoftFormat] = useState<"mp4" | "mkv">("mp4");
  const [softLang, setSoftLang] = useState("ara");
  const [extractTrack, setExtractTrack] = useState(0);
  const [extractFormat, setExtractFormat] = useState<"srt" | "vtt" | "ass">("srt");

  const [convertInput, setConvertInput] = useState("");
  const [convertFrom, setConvertFrom] = useState<"srt" | "vtt" | "ass">("srt");
  const [convertTo, setConvertTo] = useState<"srt" | "vtt" | "ass">("vtt");
  const [convertOutput, setConvertOutput] = useState("");

  const [srtEntries, setSrtEntries] = useState<SrtEntry[]>([]);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [outputText, setOutputText] = useState<string | null>(null);
  const [outputName, setOutputName] = useState("output.mp4");
  const [textCopied, setTextCopied] = useState(false);

  const logRef = useRef<HTMLPreElement | null>(null);
  const videoDrop = useRef<HTMLDivElement | null>(null);
  const subDrop = useRef<HTMLDivElement | null>(null);

  const resetOutput = () => {
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    setOutputUrl(null); setOutputText(null); setError(null); setLog(""); setProgress(0);
  };

  // ── File handling ──────────────────────────────────────────────────────────

  const pickVideo = (f: File) => { resetOutput(); setVideoFile(f); };
  const pickSubtitle = (f: File) => { resetOutput(); setSubtitleFile(f); };

  const onDrop = useCallback((e: React.DragEvent, setter: (f: File) => void) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0]; if (f) setter(f);
  }, []);

  // ── Cloud execution ────────────────────────────────────────────────────────

  async function runCloud() {
    if (!videoFile && tab !== "convert" && tab !== "editor") return;
    resetOutput(); setBusy(true); setProgress(10);

    try {
      const fd = new FormData();
      let outName = "output.mp4";
      let args: string[] = [];

      if (tab === "burn") {
        if (!subtitleFile) throw new Error("يرجى رفع ملف الترجمة (SRT/ASS)");
        outName = `burnt_${videoFile!.name}`;
        const fs = buildForceStyle(burnStyle);
        args = ["-i", videoFile!.name, "-vf", `subtitles=subs.srt:force_style='${fs}'`,
          "-c:v", "libx264", "-crf", "19", "-preset", "medium", "-tune", "film",
          "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", outName];
        fd.append("file", videoFile!, videoFile!.name);
        fd.append("subtitle", subtitleFile, "subs.srt");
        fd.append("subtitleName", "subs.srt");

      } else if (tab === "soft") {
        if (!subtitleFile) throw new Error("يرجى رفع ملف الترجمة");
        const ext = softFormat;
        outName = `subbed_${videoFile!.name.replace(/\.[^.]+$/, `.${ext}`)}`;
        if (ext === "mkv") {
          args = ["-i", videoFile!.name, "-i", "subs.srt", "-c", "copy", "-c:s", "srt", outName];
        } else {
          args = ["-i", videoFile!.name, "-i", "subs.srt", "-c", "copy", "-c:s", "mov_text",
            `-metadata:s:s:0`, `language=${softLang}`, outName];
        }
        fd.append("file", videoFile!, videoFile!.name);
        fd.append("subtitle", subtitleFile, "subs.srt");
        fd.append("subtitleName", "subs.srt");

      } else if (tab === "extract") {
        outName = `subtitles_${videoFile!.name.replace(/\.[^.]+$/, `.${extractFormat}`)}`;
        args = ["-i", videoFile!.name, "-map", `0:s:${extractTrack}`, outName];
        fd.append("file", videoFile!, videoFile!.name);

      } else {
        throw new Error("هذا التبويب لا يحتاج معالجة سحابية");
      }

      fd.append("args", JSON.stringify(args));
      fd.append("outputName", outName);
      fd.append("inputName", videoFile?.name ?? "input.mp4");

      setProgress(30);
      const res = await fetch("/api/captions-exec", { method: "POST", body: fd });
      setProgress(90);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || "فشل تنفيذ العملية");
      }

      const isText = ["srt", "vtt", "ass", "ssa"].some(ext => outName.endsWith(`.${ext}`));
      if (isText) {
        const text = await res.text();
        setOutputText(text);
        setOutputUrl(URL.createObjectURL(new Blob([text], { type: "text/plain" })));
      } else {
        const blob = await res.blob();
        setOutputUrl(URL.createObjectURL(blob));
      }
      setOutputName(outName);
      setProgress(100);

    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // ── Local WASM execution ───────────────────────────────────────────────────

  async function runLocal() {
    if (!videoFile) return;
    resetOutput(); setBusy(true);
    const onLog = (msg: string) => {
      setLog(prev => (prev + "\n" + msg).slice(-3000));
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
      const m = msg.match(/time=(\d{2}:\d{2}:\d{2})/);
      if (m) setProgress(Math.min(90, progress + 5));
    };
    try {
      setProgress(5);
      const ffmpeg = await getFFmpeg(onLog);
      setProgress(20);

      if (tab === "burn") {
        if (!subtitleFile) throw new Error("يرجى رفع ملف الترجمة");
        await ffmpeg.writeFile("input.mp4", await fetchFile(videoFile));
        await ffmpeg.writeFile("subs.srt", await fetchFile(subtitleFile));
        const fs = buildForceStyle(burnStyle);
        const outName = `burnt_${videoFile.name}`;
        await ffmpeg.exec(["-i", "input.mp4", "-vf", `subtitles=subs.srt:force_style='${fs}'`,
          ...fastEncodeArgs({ crf: 19, hasAudio: true, outName, tune: "film" })]);
        const data = await ffmpeg.readFile(outName) as Uint8Array;
        setOutputUrl(URL.createObjectURL(new Blob([data], { type: "video/mp4" })));
        setOutputName(outName);

      } else if (tab === "extract") {
        await ffmpeg.writeFile("input.mp4", await fetchFile(videoFile));
        const outName = `subs_${videoFile.name.replace(/\.[^.]+$/, `.${extractFormat}`)}`;
        await ffmpeg.exec(["-i", "input.mp4", "-map", `0:s:${extractTrack}`, outName]);
        const data = await ffmpeg.readFile(outName) as Uint8Array;
        const text = new TextDecoder().decode(data);
        setOutputText(text);
        setOutputUrl(URL.createObjectURL(new Blob([text], { type: "text/plain" })));
        setOutputName(outName);

      } else {
        throw new Error("هذا التبويب يتطلب الوضع السحابي");
      }

      setProgress(100);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      removeLogHandler(onLog);
    }
  }

  // ── Convert (client-side) ──────────────────────────────────────────────────

  function runConvert() {
    if (!convertInput.trim()) return;
    try {
      let out = "";
      const toSrt = convertFrom === "vtt" ? vttToSrt : convertFrom === "ass" ? assToSrt : convertInput;
      if (convertTo === "srt") out = typeof toSrt === "string" ? toSrt : formatSrt(parseSrt(toSrt));
      else if (convertTo === "vtt") out = srtToVtt(typeof toSrt === "string" ? toSrt : formatSrt(parseSrt(toSrt)));
      else out = srtToAss(typeof toSrt === "string" ? toSrt : formatSrt(parseSrt(toSrt)));
      setConvertOutput(out);
    } catch {
      setConvertOutput("⚠ فشل التحويل — تأكد من صحة صيغة الملف");
    }
  }

  const handleRun = () => {
    if (tab === "convert") { runConvert(); return; }
    if (tab === "editor" || tab === "transcribe") return;
    if (processMode === "cloud") runCloud(); else runLocal();
  };

  const needsVideo = tab !== "convert" && tab !== "editor" && tab !== "transcribe";
  const needsSub   = tab === "burn" || tab === "soft";
  const canRun = (tab === "convert" && convertInput.trim()) ||
    (tab === "editor") || (tab === "transcribe") ||
    (needsVideo && videoFile && (needsSub ? subtitleFile : true));

  const activeTab = TABS.find(t => t.id === tab)!;

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition">
              <ArrowRight className="size-4" /> الرئيسية
            </Link>
            <span className="text-border">/</span>
            <div className="flex items-center gap-2 font-bold">
              <div className="p-1.5 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 shadow-lg">
                <Languages className="size-4 text-white" />
              </div>
              الترجمات والكابشن
            </div>
          </div>
          <div className="hidden md:flex items-center gap-4 text-sm text-muted-foreground">
            <Link to="/enhance" className="hover:text-foreground transition">المحرر</Link>
            <Link to="/audio" className="hover:text-foreground transition">الصوت</Link>
            <Link to="/terminal" className="hover:text-foreground transition">التيرمنال</Link>
          </div>
        </div>

        {/* Cloud/Local Toggle */}
        <div className="border-t border-border/40 bg-card/40 px-6 py-2">
          <div className="mx-auto max-w-7xl flex items-center gap-3">
            <span className="text-xs text-muted-foreground font-medium">طريقة المعالجة</span>
            <div className="flex items-center rounded-lg border border-border overflow-hidden">
              <button onClick={() => setProcessMode("local")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition ${processMode === "local" ? "bg-amber-500 text-white" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}>
                <Cpu className="size-3.5" /> محلي
              </button>
              <button onClick={() => setProcessMode("cloud")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition ${processMode === "cloud" ? "bg-sky-500 text-white" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}>
                <Cloud className="size-3.5" /> سحابي
              </button>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {processMode === "cloud" ? "☁ جميع العمليات عبر السيرفر — FFmpeg نيتيف، دعم كامل لـ libass" : "💻 معالجة في المتصفح — حرق الترجمات واستخراجها فقط"}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6 grid gap-6 lg:grid-cols-[380px_1fr]">

        {/* ── Left Panel ── */}
        <aside className="space-y-4">
          {/* File Upload — Video */}
          {needsVideo && (
            <div ref={videoDrop}
              onDragOver={e => e.preventDefault()} onDrop={e => onDrop(e, pickVideo)}
              className="rounded-2xl border-2 border-dashed border-border/60 bg-card/30 p-4 hover:border-amber-500/40 transition">
              {videoFile ? (
                <div className="flex items-center gap-3">
                  <Film className="size-8 text-amber-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{videoFile.name}</p>
                    <p className="text-xs text-muted-foreground">{(videoFile.size / 1024 / 1024).toFixed(1)} MB</p>
                  </div>
                  <button onClick={() => { resetOutput(); setVideoFile(null); }} className="p-1.5 rounded-lg hover:bg-secondary transition text-muted-foreground"><X className="size-4" /></button>
                </div>
              ) : (
                <label className="flex flex-col items-center gap-2 cursor-pointer py-3">
                  <Upload className="size-7 text-muted-foreground" />
                  <span className="text-sm font-medium">ملف الفيديو</span>
                  <span className="text-xs text-muted-foreground">MP4, MOV, MKV, AVI</span>
                  <input type="file" accept="video/*" className="hidden" onChange={e => e.target.files?.[0] && pickVideo(e.target.files[0])} />
                </label>
              )}
            </div>
          )}

          {/* File Upload — Subtitle */}
          {needsSub && (
            <div ref={subDrop}
              onDragOver={e => e.preventDefault()} onDrop={e => onDrop(e, pickSubtitle)}
              className="rounded-2xl border-2 border-dashed border-border/60 bg-card/30 p-4 hover:border-fuchsia-500/40 transition">
              {subtitleFile ? (
                <div className="flex items-center gap-3">
                  <FileText className="size-8 text-fuchsia-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{subtitleFile.name}</p>
                    <p className="text-xs text-muted-foreground">{(subtitleFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <button onClick={() => { resetOutput(); setSubtitleFile(null); }} className="p-1.5 rounded-lg hover:bg-secondary transition text-muted-foreground"><X className="size-4" /></button>
                </div>
              ) : (
                <label className="flex flex-col items-center gap-2 cursor-pointer py-3">
                  <FileText className="size-7 text-muted-foreground" />
                  <span className="text-sm font-medium">ملف الترجمة</span>
                  <span className="text-xs text-muted-foreground">SRT, VTT, ASS</span>
                  <input type="file" accept=".srt,.vtt,.ass,.ssa,.sbv" className="hidden" onChange={e => e.target.files?.[0] && pickSubtitle(e.target.files[0])} />
                </label>
              )}
            </div>
          )}

          {/* Tab Navigation */}
          <div className="rounded-2xl border border-border bg-card/30 overflow-hidden">
            <p className="px-4 py-2.5 text-xs font-bold text-muted-foreground border-b border-border/60">اختر العملية</p>
            {TABS.map(t => (
              <button key={t.id} onClick={() => { setTab(t.id); resetOutput(); }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-right transition border-b border-border/40 last:border-0 ${tab === t.id ? "bg-card/80" : "hover:bg-secondary/50"}`}>
                <div className={`p-1.5 rounded-lg bg-gradient-to-br ${t.color} shrink-0`}>
                  <t.icon className="size-3.5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${tab === t.id ? "text-foreground" : "text-muted-foreground"}`}>{t.label}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{t.desc}</p>
                </div>
                {tab === t.id && <ChevronRight className="size-3.5 text-muted-foreground" />}
              </button>
            ))}
          </div>
        </aside>

        {/* ── Right Panel ── */}
        <section className="space-y-5">
          {/* Tab Header */}
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-2xl bg-gradient-to-br ${activeTab.color} shadow-lg`}>
              <activeTab.icon className="size-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-black">{activeTab.label}</h1>
              <p className="text-sm text-muted-foreground">{activeTab.desc}</p>
            </div>
          </div>

          {/* ── Burn Tab ── */}
          {tab === "burn" && (
            <div className="rounded-2xl border border-border bg-card/30 p-5 space-y-5">
              <h3 className="font-bold flex items-center gap-2"><Flame className="size-4 text-orange-400" /> خيارات تنسيق الكابشن</h3>
              <div className="grid grid-cols-2 gap-4">
                {/* Font */}
                <div>
                  <label className="text-xs text-muted-foreground block mb-1.5">الخط</label>
                  <select value={burnStyle.fontName} onChange={e => setBurnStyle(s => ({ ...s, fontName: e.target.value }))}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:border-orange-500 outline-none">
                    {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                {/* Size */}
                <div>
                  <label className="text-xs text-muted-foreground block mb-1.5">حجم الخط ({burnStyle.fontSize}px)</label>
                  <input type="range" min={16} max={72} value={burnStyle.fontSize}
                    onChange={e => setBurnStyle(s => ({ ...s, fontSize: Number(e.target.value) }))}
                    className="w-full accent-orange-500" />
                </div>
                {/* Text color */}
                <div>
                  <label className="text-xs text-muted-foreground block mb-1.5">لون النص</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={burnStyle.textColor} onChange={e => setBurnStyle(s => ({ ...s, textColor: e.target.value }))}
                      className="size-9 rounded-lg border border-border cursor-pointer bg-background p-0.5" />
                    <input value={burnStyle.textColor} onChange={e => setBurnStyle(s => ({ ...s, textColor: e.target.value }))}
                      className="flex-1 rounded-xl border border-border bg-background px-2.5 py-2 text-xs font-mono focus:border-orange-500 outline-none" />
                  </div>
                </div>
                {/* Outline color */}
                <div>
                  <label className="text-xs text-muted-foreground block mb-1.5">لون الإطار</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={burnStyle.outlineColor} onChange={e => setBurnStyle(s => ({ ...s, outlineColor: e.target.value }))}
                      className="size-9 rounded-lg border border-border cursor-pointer bg-background p-0.5" />
                    <input value={burnStyle.outlineColor} onChange={e => setBurnStyle(s => ({ ...s, outlineColor: e.target.value }))}
                      className="flex-1 rounded-xl border border-border bg-background px-2.5 py-2 text-xs font-mono focus:border-orange-500 outline-none" />
                  </div>
                </div>
                {/* Position */}
                <div className="col-span-2">
                  <label className="text-xs text-muted-foreground block mb-1.5"><AlignCenter className="inline size-3.5 mr-1" />موضع الكابشن</label>
                  <div className="grid grid-cols-3 gap-2">
                    {POSITIONS.map(p => (
                      <button key={p.value} onClick={() => setBurnStyle(s => ({ ...s, alignment: p.value, marginV: p.marginV }))}
                        className={`py-2 rounded-xl text-xs font-medium border transition ${burnStyle.alignment === p.value ? "border-orange-500 bg-orange-500/15 text-orange-300" : "border-border hover:border-orange-500/40"}`}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Options row */}
                <div className="col-span-2 flex flex-wrap gap-3">
                  {[
                    { key: "bold",   label: "عريض",        icon: Bold },
                    { key: "italic", label: "مائل",         icon: Italic },
                    { key: "backgroundBox", label: "خلفية مربعة", icon: AlignCenter },
                  ].map(opt => (
                    <button key={opt.key} onClick={() => setBurnStyle(s => ({ ...s, [opt.key]: !s[opt.key as keyof BurnStyle] }))}
                      className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium border transition ${(burnStyle as any)[opt.key] ? "border-orange-500 bg-orange-500/15 text-orange-300" : "border-border hover:border-orange-500/40"}`}>
                      <opt.icon className="size-3.5" /> {opt.label}
                    </button>
                  ))}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">سماكة الإطار</span>
                    <select value={burnStyle.outline} onChange={e => setBurnStyle(s => ({ ...s, outline: Number(e.target.value) }))}
                      className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs focus:border-orange-500 outline-none">
                      {[0, 1, 2, 3, 4].map(v => <option key={v} value={v}>{v}px</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">ظل</span>
                    <select value={burnStyle.shadow} onChange={e => setBurnStyle(s => ({ ...s, shadow: Number(e.target.value) }))}
                      className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs focus:border-orange-500 outline-none">
                      {[0, 1, 2, 3].map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              {/* Preview */}
              <div className="rounded-xl border border-border bg-black aspect-video flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-b from-zinc-800 to-zinc-900 opacity-60" />
                <div
                  className="absolute text-center px-4"
                  style={{
                    bottom: burnStyle.alignment <= 3 ? burnStyle.marginV : "auto",
                    top: burnStyle.alignment >= 7 ? burnStyle.marginV : "auto",
                    color: burnStyle.textColor,
                    fontFamily: burnStyle.fontName,
                    fontSize: Math.max(14, burnStyle.fontSize * 0.5),
                    fontWeight: burnStyle.bold ? "bold" : "normal",
                    fontStyle: burnStyle.italic ? "italic" : "normal",
                    textShadow: burnStyle.shadow > 0 ? `${burnStyle.shadow}px ${burnStyle.shadow}px 2px ${burnStyle.outlineColor}` : "none",
                    WebkitTextStroke: burnStyle.outline > 0 ? `${burnStyle.outline * 0.5}px ${burnStyle.outlineColor}` : "none",
                    background: burnStyle.backgroundBox ? "rgba(0,0,0,0.6)" : "none",
                    padding: burnStyle.backgroundBox ? "4px 10px" : "0",
                    borderRadius: burnStyle.backgroundBox ? "4px" : "0",
                  }}>
                  مرحباً بك في عالم الترجمات
                </div>
                <p className="relative text-xs text-zinc-500">معاينة تقريبية</p>
              </div>
            </div>
          )}

          {/* ── Soft Subs Tab ── */}
          {tab === "soft" && (
            <div className="rounded-2xl border border-border bg-card/30 p-5 space-y-4">
              <h3 className="font-bold flex items-center gap-2"><Layers className="size-4 text-blue-400" /> إعدادات الترجمة الناعمة</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1.5">صيغة الملف الناتج</label>
                  <div className="flex gap-2">
                    {(["mp4", "mkv"] as const).map(f => (
                      <button key={f} onClick={() => setSoftFormat(f)}
                        className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition ${softFormat === f ? "border-blue-500 bg-blue-500/15 text-blue-300" : "border-border hover:border-blue-500/40"}`}>
                        {f.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    {softFormat === "mp4" ? "MP4 يستخدم mov_text — متوافق مع معظم المشغلات" : "MKV يدعم مسارات SRT متعددة ولغات مختلفة"}
                  </p>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1.5">رمز اللغة (ISO 639-2)</label>
                  <select value={softLang} onChange={e => setSoftLang(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:border-blue-500 outline-none">
                    {[["ara", "العربية"], ["eng", "الإنجليزية"], ["fra", "الفرنسية"], ["spa", "الإسبانية"],
                      ["deu", "الألمانية"], ["jpn", "اليابانية"], ["kor", "الكورية"], ["zho", "الصينية"]].map(([v, l]) => (
                      <option key={v} value={v}>{l} ({v})</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-3.5 flex items-start gap-3">
                <Cloud className="size-4 text-blue-400 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-300 leading-relaxed">
                  الترجمات الناعمة تحتاج الوضع السحابي لضمان دعم كامل. الترجمة تبقى منفصلة يمكن تشغيلها أو إيقافها في المشغل.
                </p>
              </div>
            </div>
          )}

          {/* ── Extract Tab ── */}
          {tab === "extract" && (
            <div className="rounded-2xl border border-border bg-card/30 p-5 space-y-4">
              <h3 className="font-bold flex items-center gap-2"><FileText className="size-4 text-emerald-400" /> استخراج مسار الترجمة</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1.5">رقم المسار</label>
                  <select value={extractTrack} onChange={e => setExtractTrack(Number(e.target.value))}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:border-emerald-500 outline-none">
                    {[0, 1, 2, 3].map(i => <option key={i} value={i}>مسار {i} {i === 0 ? "(الافتراضي)" : ""}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1.5">صيغة الترجمة المُستخرَجة</label>
                  <div className="flex gap-2">
                    {(["srt", "vtt", "ass"] as const).map(f => (
                      <button key={f} onClick={() => setExtractFormat(f)}
                        className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition ${extractFormat === f ? "border-emerald-500 bg-emerald-500/15 text-emerald-300" : "border-border hover:border-emerald-500/40"}`}>
                        {f.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-300">
                ⚠ يعمل فقط إذا كان الفيديو يحتوي على مسارات ترجمة مضمّنة (مثل MKV). MP4 عادةً لا يحتوي عليها.
              </div>
            </div>
          )}

          {/* ── Convert Tab ── */}
          {tab === "convert" && (
            <div className="rounded-2xl border border-border bg-card/30 p-5 space-y-4">
              <h3 className="font-bold flex items-center gap-2"><RefreshCw className="size-4 text-violet-400" /> تحويل صيغة الترجمة</h3>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground block mb-1.5">من صيغة</label>
                  <div className="flex gap-2">
                    {(["srt", "vtt", "ass"] as const).map(f => (
                      <button key={f} onClick={() => setConvertFrom(f)}
                        className={`flex-1 py-2 rounded-xl text-sm font-bold border transition ${convertFrom === f ? "border-violet-500 bg-violet-500/15 text-violet-300" : "border-border hover:border-violet-500/40"}`}>
                        {f.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <RefreshCw className="size-5 text-muted-foreground shrink-0 mt-4" />
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground block mb-1.5">إلى صيغة</label>
                  <div className="flex gap-2">
                    {(["srt", "vtt", "ass"] as const).map(f => (
                      <button key={f} onClick={() => setConvertTo(f)}
                        className={`flex-1 py-2 rounded-xl text-sm font-bold border transition ${convertTo === f ? "border-violet-500 bg-violet-500/15 text-violet-300" : "border-border hover:border-violet-500/40"}`}>
                        {f.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs text-muted-foreground">الإدخال ({convertFrom.toUpperCase()})</label>
                    <label className="text-[11px] text-violet-400 cursor-pointer hover:underline">
                      استيراد ملف
                      <input type="file" accept=".srt,.vtt,.ass,.ssa" className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = ev => setConvertInput(ev.target?.result as string); r.readAsText(f); }}} />
                    </label>
                  </div>
                  <textarea value={convertInput} onChange={e => setConvertInput(e.target.value)} rows={12}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-xs font-mono resize-none focus:border-violet-500 outline-none"
                    placeholder={`الصق محتوى ملف ${convertFrom.toUpperCase()} هنا...`} />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs text-muted-foreground">الناتج ({convertTo.toUpperCase()})</label>
                    {convertOutput && (
                      <button onClick={() => { const blob = new Blob([convertOutput], { type: "text/plain" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `converted.${convertTo}`; a.click(); }}
                        className="text-[11px] text-violet-400 hover:underline flex items-center gap-1"><Download className="size-3" /> تنزيل</button>
                    )}
                  </div>
                  <textarea value={convertOutput} readOnly rows={12}
                    className="w-full rounded-xl border border-border bg-card/50 px-3 py-2.5 text-xs font-mono resize-none text-muted-foreground"
                    placeholder="النتيجة ستظهر هنا..." />
                </div>
              </div>
              <button onClick={runConvert} disabled={!convertInput.trim()}
                className="w-full py-3 rounded-xl bg-violet-600 text-white font-bold hover:opacity-90 transition disabled:opacity-40">
                <RefreshCw className="inline size-4 ml-2" /> تحويل الآن
              </button>
            </div>
          )}

          {/* ── Editor Tab ── */}
          {tab === "editor" && (
            <div className="rounded-2xl border border-border bg-card/30 p-5">
              <SrtEditorPanel entries={srtEntries} setEntries={setSrtEntries} />
            </div>
          )}

          {/* ── Transcribe Tab ── */}
          {tab === "transcribe" && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-card/30 p-6 text-center space-y-4">
                <div className="inline-flex p-4 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 shadow-xl shadow-amber-500/30">
                  <Mic className="size-8 text-white" />
                </div>
                <h2 className="text-xl font-black">نسخ الصوت إلى نص</h2>
                <p className="text-muted-foreground text-sm max-w-md mx-auto leading-relaxed">
                  تحويل الكلام في الفيديو أو الصوت إلى نص مكتوب — يتطلب نموذج Whisper AI.
                </p>
              </div>

              <div className="grid md:grid-cols-3 gap-4">
                {[
                  { step: "1", title: "استخرج الصوت", desc: "اذهب لاستوديو الصوت واستخرج ملف MP3 من فيديوك", href: "/audio", color: "from-emerald-500 to-teal-500" },
                  { step: "2", title: "استخدم Whisper", desc: "ارفع ملف الصوت على OpenAI Whisper API أو نموذج محلي", href: null, color: "from-amber-500 to-orange-500" },
                  { step: "3", title: "احرق الترجمات", desc: "انسخ SRT الناتج وادمجه في فيديوك عبر تبويب حرق الترجمات", href: null, color: "from-orange-500 to-red-500" },
                ].map(s => (
                  <div key={s.step} className="rounded-2xl border border-border bg-card/30 p-5 space-y-3">
                    <div className={`inline-flex size-8 items-center justify-center rounded-xl bg-gradient-to-br ${s.color} text-white font-black text-sm`}>{s.step}</div>
                    <h3 className="font-bold">{s.title}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
                    {s.href && (
                      <Link to={s.href as any} className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400 hover:text-emerald-300 transition">
                        الذهاب <ChevronRight className="size-3.5" />
                      </Link>
                    )}
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
                <h3 className="font-bold mb-3 flex items-center gap-2"><Sparkles className="size-4 text-amber-400" /> خدمات نسخ الصوت المتاحة</h3>
                <div className="space-y-2.5">
                  {[
                    { name: "OpenAI Whisper API", desc: "الأدق والأسرع — يدعم 100+ لغة، مدفوع", url: "https://platform.openai.com", tag: "موصى به" },
                    { name: "Groq Whisper (مجاني)", desc: "سريع جداً ومجاني مع حدود استخدام", url: "https://console.groq.com", tag: "مجاني" },
                    { name: "Whisper.cpp (محلي)", desc: "تشغيل نموذج Whisper على جهازك بالكامل", url: "https://github.com/ggerganov/whisper.cpp", tag: "مفتوح المصدر" },
                  ].map(s => (
                    <a key={s.name} href={s.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 rounded-xl border border-border hover:border-amber-500/40 hover:bg-secondary/50 transition">
                      <div className="flex-1">
                        <p className="text-sm font-semibold">{s.name}</p>
                        <p className="text-xs text-muted-foreground">{s.desc}</p>
                      </div>
                      <span className="text-[10px] font-bold rounded-full bg-amber-500/15 text-amber-400 px-2.5 py-1 border border-amber-500/20">{s.tag}</span>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Run Button ── */}
          {tab !== "editor" && tab !== "transcribe" && tab !== "convert" && (
            <button onClick={handleRun} disabled={!canRun || busy}
              className={`w-full py-4 rounded-2xl font-black text-base transition shadow-lg disabled:opacity-40 flex items-center justify-center gap-3 ${processMode === "cloud" ? "bg-sky-600 hover:bg-sky-500 shadow-sky-500/25" : "bg-amber-600 hover:bg-amber-500 shadow-amber-500/25"} text-white`}>
              {busy ? <><Loader2 className="size-5 animate-spin" /> جاري المعالجة...</> : <><Film className="size-5" /> تنفيذ</>}
            </button>
          )}

          {/* Progress */}
          {busy && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{processMode === "cloud" ? "☁ معالجة سحابية" : "💻 معالجة محلية"}</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 rounded-full bg-border overflow-hidden">
                <div className="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-500 rounded-full" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {/* Log */}
          {log && (
            <details className="rounded-xl border border-border overflow-hidden">
              <summary className="flex items-center gap-2 px-4 py-2.5 text-xs font-mono text-muted-foreground cursor-pointer hover:bg-secondary/50 transition">
                <ChevronDown className="size-3.5" /> سجل FFmpeg
              </summary>
              <pre ref={logRef} className="max-h-40 overflow-y-auto bg-black/40 px-4 py-3 text-[11px] font-mono text-emerald-400 leading-relaxed whitespace-pre-wrap">
                {log}
              </pre>
            </details>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 flex items-start gap-3">
              <AlertCircle className="size-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-red-300 mb-1">فشل التنفيذ</p>
                <p className="text-xs text-red-400 font-mono">{error}</p>
              </div>
            </div>
          )}

          {/* Text Output (SRT/VTT/ASS extracted) */}
          {outputText && tab !== "convert" && (
            <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold flex items-center gap-2"><CheckCircle2 className="size-5 text-emerald-400" /> الترجمات المُستخرَجة</h3>
                <div className="flex gap-2">
                  <button onClick={() => { navigator.clipboard.writeText(outputText); setTextCopied(true); setTimeout(() => setTextCopied(false), 2000); }}
                    className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary transition">
                    {textCopied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                    {textCopied ? "تم النسخ" : "نسخ"}
                  </button>
                  <a href={outputUrl!} download={outputName}
                    className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:opacity-90 transition">
                    <Download className="size-3.5" /> تنزيل
                  </a>
                </div>
              </div>
              <textarea readOnly value={outputText} rows={10}
                className="w-full rounded-xl border border-border bg-black/30 px-3 py-2.5 text-xs font-mono text-emerald-300 resize-none" />
            </div>
          )}

          {/* Video Output */}
          {outputUrl && !outputText && (
            <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-5 space-y-4">
              <h3 className="font-bold flex items-center gap-2"><CheckCircle2 className="size-5 text-emerald-400" /> اكتملت المعالجة</h3>
              <video src={outputUrl} controls className="w-full rounded-xl border border-border bg-black" />
              <a href={outputUrl} download={outputName}
                className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-black hover:opacity-90 transition shadow-lg shadow-emerald-500/25">
                <Download className="size-5" /> تنزيل {outputName}
              </a>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
