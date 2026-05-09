// Cross-platform port killer for dev. Default port: 1420 (Vite/Tauri dev server).
// Usage: node scripts/kill-port.mjs [port]
import { execSync } from "node:child_process";
import os from "node:os";

const port = Number(process.argv[2] || 1420);
const platform = os.platform();

function run(cmd) {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

let pids = new Set();

if (platform === "win32") {
  // netstat -ano | findstr :PORT
  const out = run(`netstat -ano -p tcp`);
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
    if (m && Number(m[1]) === port) pids.add(m[2]);
  }
  for (const pid of pids) {
    console.log(`[kill-port] Killing PID ${pid} on :${port}`);
    run(`taskkill /F /PID ${pid}`);
  }
} else {
  const out = run(`lsof -ti tcp:${port}`);
  out.split(/\s+/).filter(Boolean).forEach((p) => pids.add(p));
  for (const pid of pids) {
    console.log(`[kill-port] Killing PID ${pid} on :${port}`);
    run(`kill -9 ${pid}`);
  }
}

if (pids.size === 0) {
  console.log(`[kill-port] Port ${port} is free.`);
} else {
  console.log(`[kill-port] Cleared port ${port}.`);
}
