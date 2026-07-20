"use client";

// Session context: who is signed in (per the API cookie), plus SIWE sign-in helpers.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAccount, useChainId, useConnect, useDisconnect, useSignMessage } from "wagmi";
import { createSiweMessage } from "viem/siwe";
import { api, DEV_AUTH } from "./api";

interface AuthState {
  address: string | null;
  loading: boolean;
  signingIn: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  devSignIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  address: null,
  loading: true,
  signingIn: false,
  error: null,
  signIn: async () => {},
  devSignIn: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { address: walletAddr, isConnected, chain } = useAccount();
  const configChainId = useChainId();
  const { connectAsync, connectors } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();

  useEffect(() => {
    api.me().then((me) => {
      setAddress(me.user?.address ?? null);
      setLoading(false);
    });
  }, []);

  const signIn = useCallback(async () => {
    setError(null);
    setSigningIn(true);
    try {
      let addr = walletAddr;
      if (!isConnected || !addr) {
        // Prefer an injected wallet (extension or wallet in-app browser);
        // fall back to WalletConnect for plain mobile browsers.
        const hasInjected = typeof window !== "undefined" && !!(window as any).ethereum;
        const connector =
          (hasInjected ? connectors.find((c) => c.id === "injected") : undefined) ??
          connectors.find((c) => c.id === "walletConnect") ??
          connectors[0];
        if (!connector) throw new Error("No wallet found. Install MetaMask or Rabby.");
        // Sign-in only needs a signature, not the wallet on the RH chain.
        // Many mobile wallets reject adding/switching to chain 4663, so
        // tolerate switch-chain failures as long as we got an account.
        let accounts: readonly `0x${string}`[] = [];
        try {
          const result = await connectAsync({ connector });
          accounts = result.accounts;
        } catch (e: any) {
          const msg = String(e?.message || "");
          if (/switch chain|switching chain|addEthereumChain|Unrecognized chain|unsupported chain/i.test(msg)) {
            accounts = await connector.getAccounts().catch(() => [] as `0x${string}`[]);
          }
          if (!accounts.length) throw e;
        }
        addr = accounts[0];
      }
      if (!addr) throw new Error("No account");
      const { nonce } = await api.nonce();
      // Use the wallet's actual chain in the SIWE message. Some wallets
      // (Trust, Phantom) reject or warn on signatures whose message chainId
      // differs from the active chain. Server accepts 1 or 4663.
      const activeChainId = chain?.id ?? configChainId;
      const siweChainId = activeChainId === 1 || activeChainId === 4663 ? activeChainId : 4663;
      const message = createSiweMessage({
        address: addr,
        chainId: siweChainId,
        domain: window.location.host,
        nonce,
        uri: window.location.origin,
        version: "1",
      });
      const signature = await signMessageAsync({ message });
      const res = await api.verify(message, signature);
      setAddress(res.user.address);
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || "sign-in failed");
    } finally {
      setSigningIn(false);
    }
  }, [walletAddr, isConnected, chain, configChainId, connectAsync, connectors, signMessageAsync]);

  const devSignIn = useCallback(async () => {
    setError(null);
    setSigningIn(true);
    try {
      await api.devLogin();
      const me = await api.me();
      setAddress(me.user?.address ?? null);
    } catch (e: any) {
      setError(e?.message || "dev login failed");
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {}
    try {
      await disconnectAsync();
    } catch {}
    setAddress(null);
  }, [disconnectAsync]);

  return (
    <AuthContext.Provider value={{ address, loading, signingIn, error, signIn, devSignIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export { DEV_AUTH };
