import http from "http";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = "8089";

async function test() {
  const p = spawn("node", [path.join(__dirname, "serve.mjs")], {
    stdio: "pipe",
  });

  p.stdout.on("data", (d) => process.stdout.write(d));
  p.stderr.on("data", (d) => process.stdout.write(d));

  await new Promise((r) => setTimeout(r, 1000));

  http
    .get(`http://localhost:${PORT}`, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        console.log("\n--- STATUS:", res.statusCode);
        console.log("BODY length:", d.length);
        p.kill();
        process.exit(res.statusCode === 200 ? 0 : 1);
      });
    })
    .on("error", (e) => {
      console.error("FAIL:", e.message);
      p.kill();
      process.exit(1);
    });
}

test();
