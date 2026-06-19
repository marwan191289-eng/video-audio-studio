import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { writeFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const UPLOADS_DIR = join(process.cwd(), "uploads");

async function ensureUploadsDir() {
  if (!existsSync(UPLOADS_DIR)) {
    await mkdir(UPLOADS_DIR, { recursive: true });
  }
}

async function getDb() {
  const { db } = await import("../../../server/db");
  return db;
}

export const listVideos = createServerFn({ method: "GET" }).handler(async () => {
  const db = await getDb();
  const { processedVideos } = await import("../../../shared/schema");
  const { desc } = await import("drizzle-orm");

  const rows = await db
    .select()
    .from(processedVideos)
    .orderBy(desc(processedVideos.createdAt));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    storage_path: r.storagePath,
    size_bytes: r.sizeBytes ?? null,
    created_at: r.createdAt.toISOString(),
  }));
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

    const db = await getDb();
    const { processedVideos } = await import("../../../shared/schema");

    await db.insert(processedVideos).values({
      id,
      name: data.name,
      storagePath,
      sizeBytes: data.sizeBytes,
      settings: (data.settings ?? null) as Record<string, unknown> | null,
    });

    return { id, storagePath };
  });

export const deleteVideo = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string(), storagePath: z.string() }))
  .handler(async ({ data }) => {
    const db = await getDb();
    const { processedVideos } = await import("../../../shared/schema");
    const { eq } = await import("drizzle-orm");

    await db.delete(processedVideos).where(eq(processedVideos.id, data.id));

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
