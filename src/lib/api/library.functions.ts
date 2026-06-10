import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import pg from "pg";
import { writeFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const { Pool } = pg;

function getPool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

const UPLOADS_DIR = join(process.cwd(), "uploads");

async function ensureUploadsDir() {
  if (!existsSync(UPLOADS_DIR)) {
    await mkdir(UPLOADS_DIR, { recursive: true });
  }
}

export const listVideos = createServerFn({ method: "GET" }).handler(async () => {
  const pool = getPool();
  try {
    const { rows } = await pool.query(
      "SELECT id, name, storage_path, size_bytes, created_at FROM processed_videos ORDER BY created_at DESC",
    );
    return rows as {
      id: string;
      name: string;
      storage_path: string;
      size_bytes: number | null;
      created_at: string;
    }[];
  } finally {
    await pool.end();
  }
});

export const saveVideo = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      name: z.string(),
      fileData: z.string(),
      mimeType: z.string(),
      sizeBytes: z.number(),
      settings: z.record(z.unknown()).optional(),
    }),
  )
  .handler(async ({ data }) => {
    await ensureUploadsDir();
    const id = crypto.randomUUID();
    const safeName = data.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${id}-${safeName}`;
    const filePath = join(UPLOADS_DIR, storagePath);

    const base64 = data.fileData.replace(/^data:[^;]+;base64,/, "");
    await writeFile(filePath, Buffer.from(base64, "base64"));

    const pool = getPool();
    try {
      await pool.query(
        "INSERT INTO processed_videos (id, name, storage_path, size_bytes, settings) VALUES ($1, $2, $3, $4, $5)",
        [id, data.name, storagePath, data.sizeBytes, JSON.stringify(data.settings ?? {})],
      );
    } finally {
      await pool.end();
    }
    return { id, storagePath };
  });

export const deleteVideo = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string(), storagePath: z.string() }))
  .handler(async ({ data }) => {
    const pool = getPool();
    try {
      await pool.query("DELETE FROM processed_videos WHERE id = $1", [data.id]);
    } finally {
      await pool.end();
    }
    try {
      await unlink(join(UPLOADS_DIR, data.storagePath));
    } catch {
      // file may not exist, ignore
    }
    return { ok: true };
  });

export const getVideoDownloadPath = createServerFn({ method: "POST" })
  .inputValidator(z.object({ storagePath: z.string() }))
  .handler(async ({ data }) => {
    return { url: `/api/videos/${encodeURIComponent(data.storagePath)}` };
  });
