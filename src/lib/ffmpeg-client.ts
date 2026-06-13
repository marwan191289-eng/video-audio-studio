import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

let _ffmpeg: FFmpeg | null = null;
let _loading: Promise<FFmpeg> | null = null;
let _logHandlers: Array<(msg: string) => void> = [];

function globalLogListener({ message }: { message: string }) {
  for (const h of _logHandlers) h(message);
}

/**
 * Detect if the browser supports SharedArrayBuffer (required for MT build).
 * Needs Cross-Origin-Isolated context (COOP + COEP headers).
 */
function supportsSharedMemory(): boolean {
  return (
    typeof SharedArrayBuffer !== "undefined" &&
    typeof crossOriginIsolated !== "undefined" &&
    crossOriginIsolated === true
  );
}

export async function getFFmpeg(onLog?: (msg: string) => void): Promise<FFmpeg> {
  if (onLog) _logHandlers.push(onLog);
  if (_ffmpeg) return _ffmpeg;
  if (_loading) return _loading;

  _loading = (async () => {
    const ffmpeg = new FFmpeg();
    ffmpeg.on("log", globalLogListener);

    try {
      const mt = supportsSharedMemory();

      if (mt) {
        // ── Multi-thread build (4-8× faster) ─────────────────────────────
        // Uses SharedArrayBuffer + pthread workers for parallel encoding.
        const [coreURL, wasmURL, workerURL] = await Promise.all([
          toBlobURL("/ffmpeg-core-mt.js",        "text/javascript"),
          toBlobURL("/ffmpeg-core-mt.wasm",      "application/wasm"),
          toBlobURL("/ffmpeg-core-mt.worker.js", "text/javascript"),
        ]);
        await ffmpeg.load({ coreURL, wasmURL, workerURL });
      } else {
        // ── Single-thread fallback (ESM build) ───────────────────────────
        // Works without SharedArrayBuffer / COOP-COEP headers.
        const [coreURL, wasmURL] = await Promise.all([
          toBlobURL("/ffmpeg-core-esm.js", "text/javascript"),
          toBlobURL("/ffmpeg-core.wasm",   "application/wasm"),
        ]);
        await ffmpeg.load({ coreURL, wasmURL });
      }
    } catch (err) {
      _loading = null;
      if (onLog) _logHandlers = _logHandlers.filter((h) => h !== onLog);
      const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
      throw new Error(
        raw ||
          "فشل تحميل FFmpeg — تأكد من أن المتصفح يدعم WebAssembly وأعد المحاولة",
      );
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
  try { _ffmpeg?.terminate(); } catch {}
  _ffmpeg = null;
  _loading = null;
  _logHandlers = [];
}

/** Check if the file likely has an audio stream based on extension */
export function hasAudioByExt(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const noAudio = ["gif", "apng"];
  return !noAudio.includes(ext);
}

/** Returns true when running in a cross-origin isolated context (MT available) */
export function isMultiThreaded(): boolean {
  return supportsSharedMemory();
}
