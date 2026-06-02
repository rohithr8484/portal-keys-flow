import { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import {
  PARTICLE_APP_ID,
  PARTICLE_CLIENT_KEY,
  PARTICLE_PROJECT_ID,
} from "@/lib/particle-config";

// Dynamically loaded to keep the Node-targeted SDK out of the SSR bundle.
type SdkModule = typeof import("@particle-network/universal-account-sdk");
let sdkPromise: Promise<SdkModule> | null = null;
function loadSdk() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("SDK is browser-only"));
  }
  if (!sdkPromise) {
    sdkPromise = import("@particle-network/universal-account-sdk");
  }
  return sdkPromise;
}

type UAAddresses = {
  evmSmartAccount: string;
  solanaSmartAccount: string;
};

type PrimaryBalance = {
  totalAmountInUSD: number;
};

declare global {
  interface Window {
    ethereum?: any;
  }
}

function short(addr?: string) {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function Copy({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="text-xs text-muted-foreground hover:text-foreground transition"
      title="Copy"
    >
      {done ? "✓" : "⧉"}
    </button>
  );
}

export function ParticleUniversalAccount() {
  const [eoa, setEoa] = useState<string | null>(null);
  const [ua, setUa] = useState<any | null>(null);
  const [addresses, setAddresses] = useState<UAAddresses | null>(null);
  const [balance, setBalance] = useState<PrimaryBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const missingAppId = !PARTICLE_APP_ID;

  const connect = useCallback(async () => {
    setError(null);
    try {
      if (!window.ethereum) throw new Error("MetaMask not detected");
      setLoading(true);
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      setEoa(address);
    } catch (e: any) {
      setError(e?.message ?? "Failed to connect");
    } finally {
      setLoading(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setEoa(null);
    setUa(null);
    setAddresses(null);
    setBalance(null);
    setStatus(null);
  }, []);

  // Initialize Universal Account when EOA is available
  useEffect(() => {
    if (!eoa || missingAppId) return;
    const account = new UniversalAccount({
      projectId: PARTICLE_PROJECT_ID,
      projectClientKey: PARTICLE_CLIENT_KEY,
      projectAppUuid: PARTICLE_APP_ID,
      ownerAddress: eoa,
      tradeConfig: { slippageBps: 100 },
    });
    setUa(account);
  }, [eoa, missingAppId]);

  // Load addresses + balance
  const refresh = useCallback(async () => {
    if (!ua) return;
    setLoading(true);
    setError(null);
    try {
      const smart = await ua.getSmartAccountOptions();
      setAddresses({
        evmSmartAccount: smart.smartAccountAddress ?? "",
        solanaSmartAccount: smart.solanaSmartAccountAddress ?? "",
      });
      const primary = await ua.getPrimaryAssets();
      setBalance({ totalAmountInUSD: primary?.totalAmountInUSD ?? 0 });
    } catch (e: any) {
      setError(e?.message ?? "Failed to load Universal Account");
    } finally {
      setLoading(false);
    }
  }, [ua]);

  useEffect(() => {
    if (ua) refresh();
  }, [ua, refresh]);

  // Demo: send 1 USDT on Avalanche, sourced from primary assets, signed via MetaMask (EIP-7702 style UX)
  const sendDemoTx = useCallback(async () => {
    if (!ua) return;
    setBusy("Building transaction…");
    setError(null);
    setStatus(null);
    try {
      const tx = await ua.createUniversalTransaction({
        chainId: CHAIN_ID.AVALANCHE_MAINNET,
        expectTokens: [{ type: SUPPORTED_TOKEN_TYPE.USDT, amount: "1" }],
        transactions: [],
      });
      setBusy("Awaiting MetaMask signature…");
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const signature = await signer.signMessage(tx.rootHash);
      setBusy("Broadcasting…");
      const result = await ua.sendTransaction(tx, signature);
      setStatus(
        `Sent! View: https://universalx.app/activity/details?id=${result.transactionId}`
      );
    } catch (e: any) {
      setError(e?.message ?? "Transaction failed");
    } finally {
      setBusy(null);
    }
  }, [ua]);

  const totalUsd = useMemo(() => {
    if (!balance) return "—";
    return `$${balance.totalAmountInUSD.toFixed(2)}`;
  }, [balance]);

  return (
    <div className="w-full max-w-5xl mx-auto px-6 py-12">
      <header className="mb-10 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-panel-border bg-panel/60 text-xs text-muted-foreground mb-4">
          <span className="size-1.5 rounded-full bg-primary" />
          EIP-7702 · Particle Network · Universal Accounts
        </div>
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">
          Connect MetaMask. Spend anywhere.
        </h1>
        <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
          One EOA, one balance, every chain. Sign with MetaMask — Particle's
          Universal Account routes funds across EVM and Solana.
        </p>
      </header>

      {missingAppId && (
        <div className="mb-6 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <strong className="text-destructive-foreground">App ID missing.</strong>{" "}
          The Universal Account SDK needs <code>projectAppUuid</code>. In the
          Particle Dashboard, open your project → <em>Web App</em>, copy the
          <code> App ID</code>, then set <code>VITE_PARTICLE_APP_ID</code> (or
          edit <code>src/lib/particle-config.ts</code>).
        </div>
      )}

      {!eoa ? (
        <div className="rounded-2xl border border-panel-border bg-panel/70 backdrop-blur p-10 text-center">
          <div className="mx-auto size-14 rounded-2xl bg-primary/15 flex items-center justify-center text-2xl mb-4">
            🦊
          </div>
          <h2 className="text-xl font-medium mb-2">Connect your wallet</h2>
          <p className="text-sm text-muted-foreground mb-6">
            We'll use your EOA as the owner of a Universal Account.
          </p>
          <button
            onClick={connect}
            disabled={loading}
            className="inline-flex items-center justify-center rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
          >
            {loading ? "Connecting…" : "Connect MetaMask"}
          </button>
          {error && (
            <p className="mt-4 text-sm text-destructive">{error}</p>
          )}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          {/* Universal Account panel */}
          <section className="rounded-2xl border border-panel-border bg-panel/70 backdrop-blur p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className="size-8 rounded-lg bg-primary/20 flex items-center justify-center">
                  <div className="size-3 rounded-sm bg-primary" />
                </div>
                <div>
                  <div className="text-sm font-medium">Universal Account</div>
                  <div className="text-xs text-muted-foreground">
                    Owner {short(eoa)}
                  </div>
                </div>
              </div>
              <button
                onClick={disconnect}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Disconnect
              </button>
            </div>

            <div className="space-y-3">
              <AddressRow
                label="EVM"
                value={addresses?.evmSmartAccount ?? ""}
                loading={loading && !addresses}
              />
              <AddressRow
                label="SOL"
                value={addresses?.solanaSmartAccount ?? ""}
                loading={loading && !addresses}
              />
            </div>

            <div className="mt-6 rounded-xl border border-panel-border bg-background/40 p-5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  Wallet balance
                </span>
                <button
                  onClick={refresh}
                  className="text-xs text-muted-foreground hover:text-foreground"
                  disabled={loading}
                >
                  {loading ? "…" : "↻"}
                </button>
              </div>
              <div className="text-3xl font-semibold">{totalUsd}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Aggregated across supported chains
              </div>
            </div>
          </section>

          {/* Action panel */}
          <section className="rounded-2xl border border-panel-border bg-panel/70 backdrop-blur p-6">
            <div className="inline-flex rounded-lg bg-background/50 p-1 mb-6">
              <button className="px-4 py-1.5 text-sm rounded-md bg-primary text-primary-foreground">
                Demo Tx
              </button>
              <button
                className="px-4 py-1.5 text-sm rounded-md text-muted-foreground cursor-not-allowed"
                disabled
              >
                Withdraw
              </button>
            </div>

            <div className="space-y-4">
              <Field label="You receive">
                <div className="flex items-center justify-between rounded-xl border border-panel-border bg-background/40 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="size-8 rounded-full bg-gradient-to-br from-primary to-accent" />
                    <div>
                      <div className="text-sm font-medium">USDT</div>
                      <div className="text-xs text-muted-foreground">
                        Avalanche
                      </div>
                    </div>
                  </div>
                  <div className="text-sm font-medium">1.00</div>
                </div>
              </Field>

              <div className="flex justify-center">
                <div className="size-8 rounded-full border border-panel-border bg-background/60 flex items-center justify-center text-muted-foreground">
                  ↓
                </div>
              </div>

              <Field label="Pay with">
                <div className="flex items-center justify-between rounded-xl border border-panel-border bg-background/40 px-4 py-3">
                  <div className="text-sm">Any primary asset</div>
                  <div className="text-xs text-muted-foreground">auto-routed</div>
                </div>
              </Field>

              <button
                onClick={sendDemoTx}
                disabled={!ua || !!busy}
                className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
              >
                {busy ?? "Sign with MetaMask & Send"}
              </button>

              {status && (
                <p className="text-xs text-[color:var(--success)] break-all">
                  {status}
                </p>
              )}
              {error && (
                <p className="text-xs text-destructive break-all">{error}</p>
              )}
              <p className="text-[11px] text-muted-foreground text-center">
                Signs <code>rootHash</code> with MetaMask, then submits via
                Particle.
              </p>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}

function AddressRow({
  label,
  value,
  loading,
}: {
  label: string;
  value: string;
  loading: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-panel-border bg-background/40 px-4 py-3">
      <div className="text-xs font-medium text-muted-foreground w-10">
        {label}
      </div>
      <div className="flex-1 font-mono text-sm">
        {loading ? "Loading…" : short(value)}
      </div>
      {value && <Copy value={value} />}
    </div>
  );
}
