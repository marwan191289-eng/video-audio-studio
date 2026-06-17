import { execFile } from "child_process";
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";

const _require = createRequire(import.meta.url);
const FFMPEG_BIN = (() => {
  try {
    const bin = _require("ffmpeg-static");
    if (bin && fs.existsSync(bin)) return bin;
  } catch { /* ignore */ }
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH))
    return process.env.FFMPEG_PATH;
  return "ffmpeg";
})();

export default async function handler(req, res) {
  const tempId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const inputPath = path.join(os.tmpdir(), `input-${tempId}.mp4`);
  const outputPath = path.join(os.tmpdir(), `output-${tempId}.mp4`);

  const cleanup = () => {
    try { fs.rmSync(inputPath, { force: true }); } catch { /* ignore */ }
    try { fs.rmSync(outputPath, { force: true }); } catch { /* ignore */ }
  };

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    if (!buffer.length) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "الملف المرفوع فارغ" }));
      return;
    }

    fs.writeFileSync(inputPath, buffer);

    const vfFilters = [
      "hqdn3d=3:2:4:3.5",
      "eq=brightness=0.03:contrast=1.1:saturation=1.25:gamma=0.95",
      "unsharp=5:5:0.5",
    ].join(",");

    const args = [
      "-y", "-i", inputPath,
      "-vf", vfFilters,
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "20",
      "-c:a", "copy",
      outputPath,
    ];

    execFile(FFMPEG_BIN, args, (err, stdout, stderr) => {
      if (err) {
        console.error("FFmpeg error:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message, details: stderr?.slice(-500) }));
        cleanup();
        return;
      }

      if (!fs.existsSync(outputPath)) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "ملف الإخراج غير موجود" }));
        cleanup();
        return;
      }

      const output = fs.readFileSync(outputPath);
      res.writeHead(200, {
        "Content-Type": "video/mp4",
        "Cache-Control": "no-cache",
      });
      res.end(output);
      cleanup();
    });
  } catch (e) {
    console.error("Cloud enhance error:", e);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e instanceof Error ? e.message : "Internal Server Error" }));
    cleanup();
  }
}
