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
      /*
       * ffmpeg-core.js is a UMD bundle — it can NOT be dynamic-imported directly.
       * toBlobURL fetches it from same-origin (/public/) and wraps it in a blob://
       * URL with the correct MIME type so import() works.
       * wasmURL is passed as a direct same-origin URL (no blob conversion needed).
       *
       * Both files live in /public and are served by Vite with COOP/COEP headers,
       * so SharedArrayBuffer is available.
       */
      const coreURL = await toBlobURL("/ffmpeg-core.js", "text/javascript");
      await ffmpeg.load({
        coreURL,
        wasmURL: "/ffmpeg-core.wasm",
      });
    } catch (err) {
      _loading = null;
      if (onLog) _logHandlers = _logHandlers.filter((h) => h !== onLog);
      const raw =
        err instanceof Error ? err.message : typeof err === "string" ? err : "";
      throw new Error(raw || "فشل تحميل FFmpeg — أعد تحميل الصفحة وحاول مجدداً");
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
