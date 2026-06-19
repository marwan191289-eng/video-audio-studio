/**
 * Rendi Cloud Video Processing
 * POST /v1/run-ffmpeg-command  →  poll GET /v1/commands/:id  →  storage_url
 */

const RENDI_BASE = "https://api.rendi.dev/v1";
const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_ATTEMPTS = 120; // 10 minutes

export interface RendiResult {
  storageUrl: string;
  ext: string;
  mime: string;
}

/**
 * Convert our buildFFmpegArgs output (array of strings) into a Rendi
 * ffmpeg_command string using {{in_1}} / {{out_1}} placeholders.
 */
export function argsToRendiCommand(args: string[]): string {
  return args
    .filter((a) => a !== "-y") // Rendi disallows -y
    .join(" ");
}

export async function runRendiCommand(opts: {
  rendiKey: string;
  inputUrl: string;
  ffmpegArgs: string[];
  outputExt: string;
}): Promise<RendiResult> {
  const { rendiKey, inputUrl, ffmpegArgs, outputExt } = opts;

  const ffmpegCommand = argsToRendiCommand(ffmpegArgs);
  const outputFilename = `output.${outputExt}`;

  console.log(`[rendi] command: ${ffmpegCommand}`);
  console.log(`[rendi] input:   ${inputUrl}`);

  const submitRes = await fetch(`${RENDI_BASE}/run-ffmpeg-command`, {
    method: "POST",
    headers: {
      "X-Api-Key": rendiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input_files: { in_1: inputUrl },
      output_files: { out_1: outputFilename },
      ffmpeg_command: ffmpegCommand,
    }),
  });

  if (!submitRes.ok) {
    const txt = await submitRes.text().catch(() => String(submitRes.status));
    throw new Error(`Rendi submit failed (${submitRes.status}): ${txt}`);
  }

  const { command_id: commandId } = (await submitRes.json()) as { command_id: string };
  console.log(`[rendi] commandId=${commandId}`);

  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS);

    const pollRes = await fetch(`${RENDI_BASE}/commands/${commandId}`, {
      headers: { "X-Api-Key": rendiKey },
    });
    const data = (await pollRes.json()) as Record<string, any>;
    const status: string = data.status ?? "UNKNOWN";
    console.log(`[rendi] poll ${i + 1}: status=${status}`);

    if (status === "SUCCESS") {
      const storageUrl: string | undefined = data.output_files?.out_1?.storage_url;
      if (!storageUrl) throw new Error("Rendi SUCCESS but no storage_url in response");
      const mimeMap: Record<string, string> = {
        mp4: "video/mp4", mp3: "audio/mpeg", gif: "image/gif", jpg: "image/jpeg",
      };
      return {
        storageUrl,
        ext: outputExt,
        mime: mimeMap[outputExt] ?? "video/mp4",
      };
    }

    if (status === "FAILED") {
      const msg: string = data.error_message ?? "Rendi processing failed";
      throw new Error(`Rendi FAILED: ${msg}`);
    }
  }

  throw new Error("Rendi processing timed out after 10 minutes");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
