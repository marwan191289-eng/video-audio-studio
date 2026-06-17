import { app, BrowserWindow } from "electron";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEV_PORT = 5000;
const PROD_PORT = 8080;

const userDataPath = path.join(__dirname, "user-data");
const cachePath = path.join(userDataPath, "Cache");

if (!fs.existsSync(cachePath)) {
  fs.mkdirSync(cachePath, { recursive: true });
}

app.setPath("userData", userDataPath);
app.commandLine.appendSwitch("disk-cache-dir", cachePath);
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
const DEV_URL = `http://localhost:${DEV_PORT}`;
const PROD_URL = `http://localhost:${PROD_PORT}`;
const isDev = process.env.ELECTRON_DEV === "true" || process.env.NODE_ENV !== "production";

let serverProcess = null;

function createWindow(url) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(url);
}

function startProdServer() {
  if (serverProcess) return;
  serverProcess = spawn(process.execPath, [path.join(__dirname, "serve.mjs")], {
    env: { ...process.env, PORT: String(PROD_PORT), NODE_ENV: "production" },
    stdio: "inherit",
  });

  serverProcess.on("exit", (code) => {
    serverProcess = null;
    if (code !== 0) {
      console.error(`serve.mjs exited with code ${code}`);
    }
  });
}

function startDevServer() {
  if (serverProcess) return;
  serverProcess = spawn("npx", ["vite", "dev", "--host", "0.0.0.0", "--port", String(DEV_PORT)], {
    cwd: __dirname,
    env: { ...process.env, FORCE_COLOR: "1" },
    shell: true,
    stdio: "inherit",
  });

  serverProcess.on("exit", (code) => {
    serverProcess = null;
    if (code !== 0) {
      console.error(`Vite dev server exited with code ${code}`);
    }
  });
}

async function checkPort(port) {
  try {
    const res = await fetch(`http://localhost:${port}`, { method: "HEAD" });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

async function waitForPort(port, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await checkPort(port)) return port;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

async function findRunningDevPort() {
  for (let port = DEV_PORT; port <= DEV_PORT + 10; port += 1) {
    if (await checkPort(port)) return port;
  }
  return null;
}

app.whenReady().then(async () => {
  try {
    let url;
    if (isDev) {
      const runningPort = await findRunningDevPort();
      if (runningPort) {
        url = `http://localhost:${runningPort}`;
      } else {
        startDevServer();
        const port =
          (await waitForPort(DEV_PORT, 20000)) || (await waitForPort(DEV_PORT + 1, 20000));
        if (!port) throw new Error("Unable to start Vite dev server on a valid port.");
        url = `http://localhost:${port}`;
      }
    } else {
      startProdServer();
      const activePort = await waitForPort(PROD_PORT, 20000);
      if (!activePort) throw new Error("Unable to start production server.");
      url = `http://localhost:${activePort}`;
    }
    createWindow(url);
  } catch (error) {
    console.error(error);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const url = isDev ? DEV_URL : PROD_URL;
      createWindow(url);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});
