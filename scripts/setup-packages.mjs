/**
 * Ensures h3-v2 is available. In Replit, h3 is bundled with @tanstack/react-start
 * so this step is a no-op if the package already exists via node_modules.
 */
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const H3_V2_DEST = path.join(ROOT, "node_modules", "h3-v2");

if (existsSync(H3_V2_DEST)) {
  console.log("[setup] h3-v2 already present, skipping download.");
} else {
  console.log("[setup] h3-v2 not found — skipping (handled by bundler).");
}
