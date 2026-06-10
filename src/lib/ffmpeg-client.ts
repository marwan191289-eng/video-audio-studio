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

    const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd";
    try {
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
      });
    } catch (err) {
      _loading = null;
      _logHandlers = _logHandlers.filter((h) => h !== onLog);
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "فشل تحميل FFmpeg — تأكد من اتصالك بالإنترنت";
      throw new Error(msg);
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
