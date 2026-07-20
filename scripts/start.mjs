// Production supervisor: runs the indexer and the API in one service.
// Both share the same SQLite file (WAL mode), located under DATA_DIR.
// Each child is restarted with backoff if it exits; the supervisor itself
// exits only on SIGINT/SIGTERM so the platform (Railway, Docker) can manage it.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DATA_DIR = process.env.DATA_DIR || path.join(root, "data");
process.env.DATA_DIR = DATA_DIR;

const services = [
  { name: "indexer", cwd: path.join(root, "indexer"), args: ["src/index.ts"] },
  { name: "api", cwd: path.join(root, "api"), args: ["src/index.ts"] },
];

let shuttingDown = false;
const children = new Map();

function start(svc, attempt = 0) {
  if (shuttingDown) return;
  const tsx = path.join(svc.cwd, "node_modules", ".bin", "tsx");
  const child = spawn(tsx, svc.args, {
    cwd: svc.cwd,
    stdio: "inherit",
    env: process.env,
  });
  children.set(svc.name, child);
  console.log(`[supervisor] ${svc.name} started (pid ${child.pid})`);

  child.on("exit", (code, signal) => {
    children.delete(svc.name);
    if (shuttingDown) return;
    const delay = Math.min(1000 * 2 ** attempt, 30_000);
    console.warn(`[supervisor] ${svc.name} exited (code ${code}, signal ${signal}), restarting in ${delay}ms`);
    setTimeout(() => start(svc, attempt + 1), delay);
  });

  // Reset the backoff counter after 60s of healthy uptime.
  setTimeout(() => {
    if (children.get(svc.name) === child) attempt = 0;
  }, 60_000).unref();
}

function shutdown(sig) {
  console.log(`[supervisor] ${sig}, stopping children`);
  shuttingDown = true;
  for (const child of children.values()) child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 3000);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

console.log(`[supervisor] DATA_DIR=${DATA_DIR}`);
for (const svc of services) start(svc);
