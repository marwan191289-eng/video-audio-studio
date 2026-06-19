/**
 * Ensures blocked-firewall packages are installed after bun install.
 * Run: node scripts/setup-packages.mjs
 */
import { existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { createWriteStream } from "fs";
import { get } from "https";
import { pipeline } from "stream/promises";
import { createGunzip } from "zlib";
import { extract } from "tar";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

async function downloadAndExtract(url, dest) {
  if (existsSync(dest) && existsSync(path.join(dest, "package.json"))) {
    const pkg = JSON.parse(
      await import("fs/promises").then(({ readFile }) =>
        readFile(path.join(dest, "package.json"), "utf8"),
      ),
    );
    if (pkg.name === "h3" && pkg.version) {
      console.log(`[setup] h3-v2 already installed (h3@${pkg.version})`);
      return;
    }
  }

  console.log(`[setup] Downloading h3-v2 from ${url}...`);
  mkdirSync(dest, { recursive: true });

  await new Promise((resolve, reject) => {
    get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        downloadAndExtract(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        return;
      }
      const gunzip = createGunzip();
      const tarExtract = extract({ cwd: dest, strip: 1 });
      res.pipe(gunzip).pipe(tarExtract);
      tarExtract.on("finish", resolve);
      tarExtract.on("error", reject);
      gunzip.on("error", reject);
    }).on("error", reject);
  });

  console.log("[setup] h3-v2 installed successfully");
}

const H3_V2_DEST = path.join(ROOT, "node_modules", "h3-v2");
const H3_V2_URL = "https://registry.npmjs.org/h3/-/h3-2.0.1-rc.20.tgz";

try {
  await downloadAndExtract(H3_V2_URL, H3_V2_DEST);
} catch (err) {
  console.error("[setup] Failed to install h3-v2:", err.message);
  process.exit(1);
}
