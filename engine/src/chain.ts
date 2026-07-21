import { createPublicClient, defineChain, http, parseAbi } from "viem";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load RH_RPC_HTTP from the project .env.local if not already in env.
if (!process.env.RH_RPC_HTTP) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const p of [
    path.resolve(here, "../../../.env.local"),
    path.resolve(here, "../../.env.local"),
  ]) {
    if (fs.existsSync(p)) {
      for (const line of fs.readFileSync(p, "utf8").split("\n")) {
        const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
      }
      break;
    }
  }
}

const RPC = process.env.RH_RPC_HTTP;
if (!RPC) throw new Error("RH_RPC_HTTP not set (see .env.local)");

export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
});

export const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(RPC, { batch: true }),
});

// Official Uniswap v3 deployment on Robinhood Chain (developers.uniswap.org,
// v3-robinhood-chain-deployments). Verified live via eth_getCode + test quote.
export const QUOTER_V2 = "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7" as const;

export const quoterV2Abi = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

export const erc20Abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export const v3PoolAbi = parseAbi([
  "function fee() view returns (uint24)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
]);

export const v2PoolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
]);
