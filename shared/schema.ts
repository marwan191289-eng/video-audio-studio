import { pgTable, uuid, text, bigint, jsonb, timestamp } from "drizzle-orm/pg-core";

export const processedVideos = pgTable("processed_videos", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  storagePath: text("storage_path").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  settings: jsonb("settings"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
