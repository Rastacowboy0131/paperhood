"use client";

import { http, createConfig } from "wagmi";
import { mainnet } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";
import { defineChain } from "viem";

// Robinhood chain (Arbitrum Orbit), chain id 4663.
export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_RH_RPC || "https://rpc.robinhood.com"] },
  },
});

// WalletConnect enables mobile wallets (iOS/Android have no injected
// extension provider). Requires a free project id from cloud.reown.com,
// set as NEXT_PUBLIC_WC_PROJECT_ID; without it only injected wallets work.
const wcProjectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID;

export const wagmiConfig = createConfig({
  // Mainnet is included so mobile wallets that refuse the custom RH chain
  // can still connect and sign (SIWE auth accepts chain 1 or 4663).
  chains: [robinhoodChain, mainnet],
  connectors: [
    injected(),
    ...(wcProjectId
      ? [
          walletConnect({
            projectId: wcProjectId,
            metadata: {
              name: "PaperHood",
              description: "RH chain paper trading terminal",
              url: "https://paperhood-psi.vercel.app",
              icons: [],
            },
            showQrModal: true,
          }),
        ]
      : []),
  ],
  transports: {
    [robinhoodChain.id]: http(),
    [mainnet.id]: http(),
  },
});
