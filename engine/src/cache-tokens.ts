// One-shot: fetch and cache decimals/symbol for all universe tokens.
import { openDb } from "./db.js";
import { cacheUniverseTokens } from "./quote.js";

const db = openDb();
const n = await cacheUniverseTokens(db);
console.log(`cached metadata for ${n} tokens`);
