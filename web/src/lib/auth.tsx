"use client";

// Session context: who is signed in (per the API cookie), plus SIWE sign-in helpers.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSignMessage } from "wagmi";
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

  const { address: walletAddr, isConnected } = useAccount();
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
        const connector = connectors[0];
        if (!connector) throw new Error("No wallet found. Install MetaMask or Rabby.");
        const result = await connectAsync({ connector });
        addr = result.accounts[0];
      }
      if (!addr) throw new Error("No account");
      const { nonce } = await api.nonce();
      const message = createSiweMessage({
        address: addr,
        chainId: 4663,
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
  }, [walletAddr, isConnected, connectAsync, connectors, signMessageAsync]);

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
