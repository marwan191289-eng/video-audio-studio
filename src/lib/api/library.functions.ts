import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { writeFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import type { Database } from "@/integrations/supabase/types";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) throw new Error("Supabase env vars missing (SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY)");
  return createClient<Database>(url, key);
}

const UPLOADS_DIR = join(process.cwd(), "uploads");

async function ensureUploadsDir() {
  if (!existsSync(UPLOADS_DIR)) {
    await mkdir(UPLOADS_DIR, { recursive: true });
  }
}

export const listVideos = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("processed_videos")
    .select("id, name, storage_path, size_bytes, created_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data as {
    id: string;
    name: string;
    storage_path: string;
    size_bytes: number | null;
    created_at: string;
  }[];
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

    const supabase = getSupabase();
    const { error } = await supabase.from("processed_videos").insert({
      id,
      name: data.name,
      storage_path: storagePath,
      size_bytes: data.sizeBytes,
      settings: (data.settings ?? null) as import("@/integrations/supabase/types").Json,
    });

    if (error) throw new Error(error.message);
    return { id, storagePath };
  });

export const deleteVideo = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string(), storagePath: z.string() }))
  .handler(async ({ data }) => {
    const supabase = getSupabase();
    const { error } = await supabase.from("processed_videos").delete().eq("id", data.id);
    if (error) throw new Error(error.message);

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
