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
      // CRITICAL FIX: Both files must be wrapped in toBlobURL with correct MIME types.
      // Passing a direct URL for wasmURL causes MIME type / CORS failures in proxied
      // environments (Replit, iframes). toBlobURL fetches → stores in a local blob://
      // URL → browser accepts it without CORS or MIME checks.
      const [coreURL, wasmURL] = await Promise.all([
        toBlobURL("/ffmpeg-core.js", "text/javascript"),
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
