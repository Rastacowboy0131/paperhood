// Pons launchpad (ponsfamily.com/launchpad) integration.
//
// Research notes (2026-07-21, verified on-chain):
// - Factory: PonsLaunchFactory 0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB
//   (verified on robinhoodchain.blockscout.com). Locker:
//   0x736D76699C26D0d966744cAe304C000d471f7F35.
// - Pons is NOT a virtual-reserve bonding curve. launchToken() deploys the
//   token via CREATE2 and immediately creates a real Uniswap v3 pool with a
//   locked single-sided position (all supply on one side). Every launched
//   token is tradeable on v3 from block one.
// - "Graduation" is a fee milestone, not a migration: graduationStatus()
//   compares the paired-token principal accumulated in the locked position
//   against a threshold (launch config 0 uses 4.2 WETH). No new pool is
//   created on graduation; the pool address never changes.
// - Enumeration: TokenLaunched(token, deployer, dexFactory, pairToken, pool,
//   dexId, launchConfigId, positionId, restrictionsEndBlock, initialBuyAmount)
//   topic0 0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a.
// - Per-token lookup: getLaunchedToken(token) returns the pool-adjacent
//   struct including pairedToken, poolFee and supply; the token contract
//   itself exposes liquidityPool() and getTokenInfo() (logo + socials).
import { parseAbi } from "viem";
import { client } from "./chain.js";

export const PONS_FACTORY = "0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB" as const;

export const ponsFactoryAbi = parseAbi([
  "function getLaunchedToken(address token) view returns ((address token, address deployer, address pairedToken, address positionManager, uint256 positionId, uint256 dexId, uint256 launchConfigId, uint256 restrictionsEndBlock, uint256 supply, bool isToken0, uint24 poolFee, bool exists, uint256 initialBuyAmount) launched)",
  "function graduationStatus(address token) view returns (uint256 pairedPrincipal, uint256 threshold, bool graduated)",
]);

export const ponsTokenAbi = parseAbi([
  "function liquidityPool() view returns (address)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function getTokenInfo() view returns (address deployer, string logo, string description, (string twitter, string telegram, string discord, string website, string farcaster) socials)",
]);

export interface PonsLaunch {
  token: string;
  pool: string;
  pairedToken: string;
  poolFee: number;
  supply: bigint;
  name: string;
  symbol: string;
  imageUrl: string | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
}

export interface PonsGraduation {
  pairedPrincipal: bigint;
  threshold: bigint;
  graduated: boolean;
  progressPct: number; // 0-100, capped
}

function ipfsToHttp(u: string): string | null {
  if (!u) return null;
  if (u.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${u.slice(7)}`;
  return u.startsWith("http") ? u : null;
}

// Look a token up on the Pons factory. Returns null when the factory does
// not know it (not a pons launch).
export async function lookupPonsToken(address: string): Promise<PonsLaunch | null> {
  const token = address as `0x${string}`;
  let launched;
  try {
    launched = await client.readContract({
      address: PONS_FACTORY,
      abi: ponsFactoryAbi,
      functionName: "getLaunchedToken",
      args: [token],
    });
  } catch {
    return null;
  }
  if (!launched.exists) return null;

  const [pool, name, symbol, info] = await Promise.all([
    client.readContract({ address: token, abi: ponsTokenAbi, functionName: "liquidityPool" }),
    client.readContract({ address: token, abi: ponsTokenAbi, functionName: "name" }).catch(() => "?"),
    client.readContract({ address: token, abi: ponsTokenAbi, functionName: "symbol" }).catch(() => "?"),
    client.readContract({ address: token, abi: ponsTokenAbi, functionName: "getTokenInfo" }).catch(() => null),
  ]);

  const socials = info?.[3];
  return {
    token: address.toLowerCase(),
    // Keep the checksummed pool address so a later dexscreener discovery
    // upsert (which uses checksummed pair addresses) hits the same row.
    pool: pool as string,
    pairedToken: launched.pairedToken.toLowerCase(),
    poolFee: Number(launched.poolFee),
    supply: launched.supply,
    name: String(name),
    symbol: String(symbol),
    imageUrl: info ? ipfsToHttp(info[1]) : null,
    website: socials?.website || null,
    twitter: socials?.twitter || null,
    telegram: socials?.telegram || null,
  };
}

export async function ponsGraduation(address: string): Promise<PonsGraduation | null> {
  try {
    const [pairedPrincipal, threshold, graduated] = await client.readContract({
      address: PONS_FACTORY,
      abi: ponsFactoryAbi,
      functionName: "graduationStatus",
      args: [address as `0x${string}`],
    });
    const progressPct = threshold > 0n
      ? Math.min(100, (Number(pairedPrincipal) / Number(threshold)) * 100)
      : 0;
    return { pairedPrincipal, threshold, graduated, progressPct };
  } catch {
    return null;
  }
}
