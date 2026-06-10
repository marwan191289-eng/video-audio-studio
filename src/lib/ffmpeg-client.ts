import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

let _ffmpeg: FFmpeg | null = null;
let _loading: Promise<FFmpeg> | null = null;
let _logHandlers: Array<(msg: string) => void> = [];

function globalLogListener({ message }: { message: string }) {
  for (const h of _logHandlers) h(message);
}

export async function getFFmpeg(onLog?: (msg: string) => void): Promise<FFmpeg> {
  if (onLog) _logHandlers.push(onLog);
  if (_ffmpeg) return _ffmpeg;
  if (_loading) return _loading;

  _loading = (async () => {
    const ffmpeg = new FFmpeg();
    ffmpeg.on("log", globalLogListener);

    try {
      // ROOT CAUSE FIX (layered):
      //
      // @ffmpeg/ffmpeg in Vite ESM mode creates a *module* Web Worker.
      // Module workers cannot use importScripts() — they fall back to
      //   self.createFFmpegCore = (await import(coreURL)).default
      // This requires coreURL to be an ES module with `export default`.
      //
      // The UMD build (ffmpeg-core.js) has NO `export default`, so .default
      // is undefined → ERROR_IMPORT_FAILURE → "failed to import ffmpeg-core.js".
      //
      // Fix: use the ESM build (ffmpeg-core-esm.js which has `export default
      // createFFmpegCore`). The ESM build uses import.meta.url internally, so
      // it must be served as text/javascript (blob URL is fine for module import).
      //
      // Both files are wrapped in toBlobURL so the Replit proxy cannot interfere
      // with MIME types or CORS headers.
      const [coreURL, wasmURL] = await Promise.all([
        toBlobURL("/ffmpeg-core-esm.js", "text/javascript"),
        toBlobURL("/ffmpeg-core.wasm", "application/wasm"),
      ]);
      await ffmpeg.load({ coreURL, wasmURL });
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
  try {
    _ffmpeg?.terminate();
  } catch {}
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
