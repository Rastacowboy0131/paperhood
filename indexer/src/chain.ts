import { createPublicClient, defineChain, http, parseAbi } from "viem";

const RPC = process.env.RH_RPC_HTTP;
if (!RPC) throw new Error("RH_RPC_HTTP not set");

const robinhoodChain = defineChain({
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

export const pairAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);

export const erc20Abi = parseAbi([
  "function decimals() view returns (uint8)",
]);

export const v2Abi = parseAbi([
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
]);

export const v3Abi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
]);
