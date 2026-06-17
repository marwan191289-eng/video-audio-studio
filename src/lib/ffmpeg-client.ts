/**
 * ffmpeg-client.ts — محرك FFmpeg المُحسَّن
 *
 * التحسينات المطبَّقة:
 * 1. Multi-Thread WASM (@ffmpeg/core-mt) — يستخدم كل أنوية المعالج
 * 2. Single FFmpeg instance مع singleton pattern — لا إعادة تحميل
 * 3. Smart file cache — لا إعادة كتابة نفس الملف
 * 4. fastEncodeArgs() مركزية — preset ultrafast + tune fastdecode + threads
 */

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

let _ffmpeg: FFmpeg | null = null;
let _loading: Promise<FFmpeg> | null = null;
let _logHandlers: Array<(msg: string) => void> = [];

// Smart file cache — skip re-writing same file to WASM FS
let _cachedFileName: string | null = null;
let _cachedFileSize: number | null = null;

function globalLogListener({ message }: { message: string }) {
  for (const h of _logHandlers) h(message);
}

/** عدد خيوط المعالج المتاحة (بحد أقصى 8) */
export function getOptimalThreads(): number {
  if (typeof navigator === "undefined") return 2;
  return Math.min(navigator.hardwareConcurrency ?? 2, 8);
}

/**
 * تحميل FFmpeg مرة واحدة — يستخدم Multi-Thread build إذا
 * كان المتصفح يدعم SharedArrayBuffer (Chrome/Edge/Firefox الحديث)
 * مع Fallback للبناء العادي تلقائياً.
 */
export async function getFFmpeg(onLog?: (msg: string) => void): Promise<FFmpeg> {
  if (onLog) _logHandlers.push(onLog);
  if (_ffmpeg) return _ffmpeg;
  if (_loading) return _loading;

  _loading = (async () => {
    const ffmpeg = new FFmpeg();
    ffmpeg.on("log", globalLogListener);

    // ── محاولة تحميل Multi-Thread build أولاً ──────────────────────────
    const supportsMT = typeof SharedArrayBuffer !== "undefined" && typeof Atomics !== "undefined";

    let loaded = false;

    if (supportsMT) {
      try {
        const [coreURL, wasmURL, workerURL] = await Promise.all([
          toBlobURL("/ffmpeg-core-mt.js", "text/javascript"),
          toBlobURL("/ffmpeg-core-mt.wasm", "application/wasm"),
          toBlobURL("/ffmpeg-core-mt.worker.js", "text/javascript"),
        ]);
        await ffmpeg.load({ coreURL, wasmURL, workerURL });
        console.info(`[FFmpeg] ✅ Multi-Thread loaded (${getOptimalThreads()} cores)`);
        loaded = true;
      } catch (mtErr) {
        console.warn("[FFmpeg] Multi-Thread load failed, falling back to single-thread:", mtErr);
      }
    }

    // ── Fallback: Single-Thread ESM build ──────────────────────────────
    if (!loaded) {
      try {
        const [coreURL, wasmURL] = await Promise.all([
          toBlobURL("/ffmpeg-core-esm.js", "text/javascript"),
          toBlobURL("/ffmpeg-core.wasm", "application/wasm"),
        ]);
        await ffmpeg.load({ coreURL, wasmURL });
        console.info("[FFmpeg] ✅ Single-Thread loaded");
        loaded = true;
      } catch (stErr) {
        _loading = null;
        if (onLog) _logHandlers = _logHandlers.filter((h) => h !== onLog);
        const raw = stErr instanceof Error ? stErr.message : "";
        throw new Error(
          raw || "فشل تحميل FFmpeg — تأكد من أن المتصفح يدعم WebAssembly وأعد المحاولة",
        );
      }
    }

    _ffmpeg = ffmpeg;
    return ffmpeg;
  })();

  return _loading;
}

export function removeLogHandler(onLog: (msg: string) => void) {
  _logHandlers = _logHandlers.filter((h) => h !== onLog);
}

export function resetFFmpeg() {
  try {
    _ffmpeg?.terminate();
  } catch {}
  _ffmpeg = null;
  _loading = null;
  _logHandlers = [];
  _cachedFileName = null;
  _cachedFileSize = null;
}

/** Check if the file likely has an audio stream based on extension */
export function hasAudioByExt(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return !["gif", "apng"].includes(ext);
}

/**
 * كتابة ملف لـ WASM FS مع تخزين مؤقت ذكي.
 * إذا كان نفس الملف موجوداً بالفعل يتخطى الكتابة.
 */
export async function writeFileOptimized(
  ffmpeg: FFmpeg,
  name: string,
  data: Uint8Array,
): Promise<void> {
  if (_cachedFileName === name && _cachedFileSize === data.byteLength) {
    return; // نفس الملف موجود بالفعل
  }
  await ffmpeg.writeFile(name, data);
  _cachedFileName = name;
  _cachedFileSize = data.byteLength;
}

export function invalidateFileCache() {
  _cachedFileName = null;
  _cachedFileSize = null;
}

/**
 * بناء أوامر الترميز المثلى لـ libx264.
 * ultrafast + fastdecode + threads صحيحة = أسرع معالجة ممكنة.
 */
export function fastEncodeArgs(options: {
  crf?: number;
  hasAudio: boolean;
  audioArgs?: string[];
  outName: string;
  tune?: "film" | "animation" | "zerolatency" | "fastdecode";
}): string[] {
  const { crf = 18, hasAudio, audioArgs, outName, tune = "fastdecode" } = options;
  const threads = String(getOptimalThreads());
  const defaultAudio = hasAudio ? ["-c:a", "copy"] : ["-an"];

  return [
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-tune",
    tune,
    "-crf",
    String(crf),
    "-threads",
    threads,
    "-movflags",
    "+faststart",
    ...(audioArgs ?? defaultAudio),
    outName,
  ];
}
