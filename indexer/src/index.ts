import { runDiscovery } from "./discovery.js";
import { pollOnce } from "./poller.js";
import { runBackfill } from "./backfill.js";

const POLL_MS = Number(process.env.POLL_INTERVAL_MS ?? 10_000);
const DISCOVERY_MS = Number(process.env.DISCOVERY_INTERVAL_MS ?? 15 * 60_000);

let running = true;
let backoff = 0; // extra ms added after RPC failures

async function pollLoop() {
  while (running) {
    const started = Date.now();
    try {
      const n = await pollOnce();
      backoff = 0;
      console.log(`poll: ${n} pools snapshotted`);
    } catch (e) {
      backoff = Math.min((backoff || POLL_MS) * 2, 120_000);
      console.warn(`poll failed (backing off +${backoff}ms):`, (e as Error).message);
    }
    const wait = Math.max(0, POLL_MS + backoff - (Date.now() - started));
    await new Promise((r) => setTimeout(r, wait));
  }
}

async function discoveryLoop() {
  while (running) {
    try {
      await runDiscovery();
    } catch (e) {
      console.warn("discovery failed:", (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, DISCOVERY_MS));
  }
}

function shutdown() {
  console.log("shutting down");
  running = false;
  setTimeout(() => process.exit(0), 500);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("paperhood indexer starting");
await runDiscovery().catch((e) => console.warn("initial discovery failed:", e.message));
// Historical backfill runs once in the background; slow by design (rate limited).
void runBackfill().catch((e) => console.warn("backfill failed:", e.message));
void discoveryLoop; // initial run done above; start the repeat loop below
(async () => {
  await new Promise((r) => setTimeout(r, DISCOVERY_MS));
  await discoveryLoop();
})();
await pollLoop();
