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

type NetworkMode = "mainnet" | "testnet";


// ---------- Arbitrum Sepolia + ZeroDev config ----------
const ARB_SEPOLIA = {
  chainId: 421614,
  chainIdHex: "0x66eee",
  label: "Arbitrum Sepolia",
  rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
  explorer: "https://sepolia.arbiscan.io",
  faucet: "https://faucet.quicknode.com/arbitrum/sepolia",
};

const ZERODEV_RPC =
  "https://rpc.zerodev.app/api/v3/263a14d6-19fe-4e98-8ba4-02b793c1aa0a/chain/421614";

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
  const [network, setNetwork] = useState<NetworkMode>(() => {
    if (typeof window === "undefined") return "mainnet";
    return (localStorage.getItem("ua_network") as NetworkMode) || "mainnet";
  });
  const [logs, setLogs] = useState<string[]>([]);
  const appendLog = useCallback(
    (m: string) => setLogs((l) => [...l, `${new Date().toLocaleTimeString()}  ${m}`]),
    []
  );

  const [eoa, setEoa] = useState<string | null>(null);
  const [ua, setUa] = useState<any | null>(null);
  const [addresses, setAddresses] = useState<UAAddresses | null>(null);
  const [balance, setBalance] = useState<PrimaryBalance | null>(null);
  const [smartAccountAddress, setSmartAccountAddress] = useState<string | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const missingAppId = !PARTICLE_APP_ID;
  const isTestnet = network === "testnet";

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("ua_network", network);
    }
    setUa(null);
    setAddresses(null);
    setBalance(null);
    setSmartAccountAddress(null);
    setStatus(null);
    setError(null);
  }, [network]);




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
    setSmartAccountAddress(null);
    setStatus(null);
  }, []);

  // Initialize Universal Account (mainnet only)
  useEffect(() => {
    if (!eoa || missingAppId || isTestnet) return;
    let cancelled = false;
    loadSdk()
      .then(({ UniversalAccount }) => {
        if (cancelled) return;
        const account = new UniversalAccount({
          projectId: PARTICLE_PROJECT_ID,
          projectClientKey: PARTICLE_CLIENT_KEY,
          projectAppUuid: PARTICLE_APP_ID,
          ownerAddress: eoa,
          tradeConfig: { slippageBps: 100 },
        });
        setUa(account);
      })
      .catch((e) => setError(e?.message ?? "Failed to load SDK"));
    return () => {
      cancelled = true;
    };
  }, [eoa, missingAppId, isTestnet]);

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

  // ---------- Mainnet: Particle UA transfer ----------
  const sendMainnetTx = useCallback(async () => {
    if (!ua || !eoa) return;
    setBusy("Building transfer…");
    setError(null);
    setStatus(null);
    try {
      const { CHAIN_ID } = await loadSdk();
      const tx = await ua.createTransferTransaction({
        token: {
          chainId: CHAIN_ID.ARBITRUM_MAINNET_ONE,
          address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
        },
        amount: "0.1",
        receiver: eoa,
      });
      setBusy("Awaiting MetaMask signature…");
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const signature = await signer.signMessage(ethers.getBytes(tx.rootHash));
      setBusy("Broadcasting…");
      const result = await ua.sendTransaction(tx, signature);
      setStatus(
        `Sent! View: https://universalx.app/activity/details?id=${result.transactionId}`
      );
    } catch (e: any) {
      setError(e?.message ?? "Transfer failed");
    } finally {
      setBusy(null);
    }
  }, [ua, eoa]);

  // ---------- Helper: switch MetaMask to Arbitrum Sepolia ----------
  const ensureArbSepolia = useCallback(async () => {
    if (!window.ethereum) throw new Error("MetaMask not detected");
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: ARB_SEPOLIA.chainIdHex }],
      });
    } catch (err: any) {
      if (err?.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: ARB_SEPOLIA.chainIdHex,
              chainName: ARB_SEPOLIA.label,
              nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
              rpcUrls: [ARB_SEPOLIA.rpcUrl],
              blockExplorerUrls: [ARB_SEPOLIA.explorer],
            },
          ],
        });
      } else {
        throw err;
      }
    }
  }, []);

  // ---------- Testnet path 1: ZeroDev EIP-7702 (MetaMask EOA) ----------
  const sendZeroDev7702Tx = useCallback(async () => {
    if (!eoa) return;
    setBusy("Switching to Arbitrum Sepolia…");
    setError(null);
    setStatus(null);
    try {
      await ensureArbSepolia();

      const [
        { createKernelAccount, createKernelAccountClient, createZeroDevPaymasterClient, getUserOperationGasPrice },
        { KERNEL_V3_3, getEntryPoint },
        viem,
        { arbitrumSepolia },
      ] = await Promise.all([
        import("@zerodev/sdk"),
        import("@zerodev/sdk/constants"),
        import("viem"),
        import("viem/chains"),
      ]);

      const { createPublicClient, createWalletClient, custom, http, zeroAddress } =
        viem;

      const publicClient = createPublicClient({
        transport: http(ARB_SEPOLIA.rpcUrl),
        chain: arbitrumSepolia,
      });

      const walletClient = createWalletClient({
        account: eoa as `0x${string}`,
        chain: arbitrumSepolia,
        transport: custom(window.ethereum),
      });

      setBusy("Signing EIP-7702 authorization in MetaMask…");
      // Sign the authorization manually so we can surface MetaMask errors clearly.
      const authorization = await walletClient.signAuthorization({
        account: walletClient.account,
        contractAddress: KERNEL_V3_3 as `0x${string}`,
      });

      setBusy("Building Kernel smart account…");
      const entryPoint = getEntryPoint("0.7");
      const account = await createKernelAccount(publicClient as any, {
        eip7702Account: walletClient.account as any,
        entryPoint,
        kernelVersion: KERNEL_V3_3,
        eip7702Auth: authorization,
      });

      setSmartAccountAddress(account.address);

      const paymasterClient = createZeroDevPaymasterClient({
        chain: arbitrumSepolia,
        transport: http(ZERODEV_RPC),
      });

      const kernelClient = createKernelAccountClient({
        account,
        chain: arbitrumSepolia,
        bundlerTransport: http(ZERODEV_RPC),
        paymaster: paymasterClient,
        client: publicClient,
        userOperation: {
          estimateFeesPerGas: async ({ bundlerClient }: any) =>
            getUserOperationGasPrice(bundlerClient),
        },
      });

      setBusy("Sending gasless batched UserOp…");
      const userOpHash = await kernelClient.sendUserOperation({
        callData: await kernelClient.account!.encodeCalls([
          { to: zeroAddress, value: BigInt(0), data: "0x" },
          { to: zeroAddress, value: BigInt(0), data: "0x" },
        ]),
      });

      setBusy("Waiting for confirmation…");
      const receipt = await kernelClient.waitForUserOperationReceipt({
        hash: userOpHash,
      });

      setStatus(
        `UserOp confirmed! Tx: ${ARB_SEPOLIA.explorer}/tx/${receipt.receipt.transactionHash}`
      );
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || "ZeroDev 7702 failed";
      setError(
        msg.includes("does not support") || msg.includes("not supported")
          ? `${msg} — your MetaMask may not yet support EIP-7702 signAuthorization. Try MetaMask 12+ on Sepolia.`
          : msg
      );
    } finally {
      setBusy(null);
    }
  }, [eoa, ensureArbSepolia]);

  // ---------- Testnet path 2: ZeroDev + Particle Auth (social login signer) ----------
  const sendZeroDevParticleTx = useCallback(async () => {
    setBusy("Loading Particle Auth…");
    setError(null);
    setStatus(null);
    try {
      const [
        { ParticleNetwork },
        { ParticleProvider },
        { signerToEcdsaValidator },
        {
          createKernelAccount,
          createKernelAccountClient,
          createZeroDevPaymasterClient,
          getUserOperationGasPrice,
        },
        { KERNEL_V3_1, getEntryPoint },
        viem,
        { arbitrumSepolia },
      ] = await Promise.all([
        import("@particle-network/auth"),
        import("@particle-network/provider"),
        import("@zerodev/ecdsa-validator"),
        import("@zerodev/sdk"),
        import("@zerodev/sdk/constants"),
        import("viem"),
        import("viem/chains"),
      ]);

      const { createPublicClient, createWalletClient, custom, http, zeroAddress } =
        viem;

      const particle = new ParticleNetwork({
        projectId: PARTICLE_PROJECT_ID,
        clientKey: PARTICLE_CLIENT_KEY,
        appId: PARTICLE_APP_ID,
        chainName: "arbitrum" as any,
        chainId: ARB_SEPOLIA.chainId,
      });
      const particleProvider = new ParticleProvider(particle.auth);

      setBusy("Awaiting Particle login…");
      if (!particle.auth.isLogin()) {
        await particle.auth.login();
      }

      // Read the EOA from the provider
      const accounts: string[] = await particleProvider.request({
        method: "eth_accounts",
      });
      const particleEoa = accounts[0] as `0x${string}`;
      if (!particleEoa) throw new Error("No Particle account returned");

      const publicClient = createPublicClient({
        transport: http(ARB_SEPOLIA.rpcUrl),
        chain: arbitrumSepolia,
      });

      // Build a viem wallet client backed by Particle's EIP-1193 provider,
      // which acts as the signer for the ZeroDev ECDSA validator.
      const walletClient = createWalletClient({
        account: particleEoa,
        chain: arbitrumSepolia,
        transport: custom(particleProvider as any),
      });

      setBusy("Creating ECDSA validator…");
      const entryPoint = getEntryPoint("0.7");
      const ecdsaValidator = await signerToEcdsaValidator(publicClient as any, {
        signer: walletClient.account as any,
        entryPoint,
        kernelVersion: KERNEL_V3_1,
      });

      setBusy("Building Kernel smart account…");
      const account = await createKernelAccount(publicClient as any, {
        plugins: { sudo: ecdsaValidator },
        entryPoint,
        kernelVersion: KERNEL_V3_1,
      });
      setSmartAccountAddress(account.address);

      const paymasterClient = createZeroDevPaymasterClient({
        chain: arbitrumSepolia,
        transport: http(ZERODEV_RPC),
      });

      const kernelClient = createKernelAccountClient({
        account,
        chain: arbitrumSepolia,
        bundlerTransport: http(ZERODEV_RPC),
        paymaster: paymasterClient,
        client: publicClient,
        userOperation: {
          estimateFeesPerGas: async ({ bundlerClient }: any) =>
            getUserOperationGasPrice(bundlerClient),
        },
      });

      setBusy("Sending gasless UserOp…");
      const userOpHash = await kernelClient.sendUserOperation({
        callData: await kernelClient.account!.encodeCalls([
          { to: zeroAddress, value: BigInt(0), data: "0x" },
        ]),
      });

      const receipt = await kernelClient.waitForUserOperationReceipt({
        hash: userOpHash,
      });

      setStatus(
        `UserOp confirmed! Tx: ${ARB_SEPOLIA.explorer}/tx/${receipt.receipt.transactionHash}`
      );
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || "ZeroDev + Particle failed");
    } finally {
      setBusy(null);
    }
  }, []);

  const sendDemoTx = isTestnet ? sendZeroDev7702Tx : sendMainnetTx;

  const totalUsd = useMemo(() => {
    if (!balance) return "—";
    return `$${balance.totalAmountInUSD.toFixed(2)}`;
  }, [balance]);

  // Intent runner: wraps the intent helper and surfaces logs/errors in the UI.
  const runIntent = useCallback(
    (label: string, fn: (log: (m: string) => void) => Promise<unknown>) =>
      async () => {
        setBusy(label);
        setError(null);
        setStatus(null);
        setLogs([]);
        try {
          await fn(appendLog);
          setStatus(`${label} ✓`);
        } catch (e: any) {
          setError(e?.shortMessage || e?.message || `${label} failed`);
        } finally {
          setBusy(null);
        }
      },
    [appendLog]
  );

  const canSend = !!eoa || !isTestnet ? !!eoa || !!ua : false;


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

        <div className="mt-6 inline-flex rounded-lg border border-panel-border bg-panel/60 p-1">
          {(["mainnet", "testnet"] as const).map((n) => (
            <button
              key={n}
              onClick={() => setNetwork(n)}
              className={`px-4 py-1.5 text-xs font-medium rounded-md transition ${
                network === n
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {n === "mainnet" ? "Mainnet" : "Testnet"}
            </button>
          ))}
        </div>
      </header>

      {missingAppId && !isTestnet && (
        <div className="mb-6 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <strong className="text-destructive-foreground">App ID missing.</strong>{" "}
          Set <code>VITE_PARTICLE_APP_ID</code> or edit
          <code> src/lib/particle-config.ts</code>.
        </div>
      )}

      {isTestnet && (
        <div className="mb-6 rounded-xl border border-panel-border bg-panel/60 p-4 text-sm text-muted-foreground space-y-2">
          <div>
            <strong className="text-foreground">Testnet — Arbitrum Sepolia.</strong>{" "}
            Both signer paths shown below. Intent buttons run on Arbitrum mainnet → Base (requires real USDC).
          </div>
          <a
            className="text-xs text-primary hover:underline"
            href={ARB_SEPOLIA.faucet}
            target="_blank"
            rel="noreferrer"
          >
            Get test ETH ↗
          </a>
        </div>
      )}

      {!eoa && !isTestnet ? (
        <div className="rounded-2xl border border-panel-border bg-panel/70 backdrop-blur p-10 text-center">
          <div className="mx-auto size-14 rounded-2xl bg-primary/15 flex items-center justify-center text-2xl mb-4">
            🦊
          </div>
          <h2 className="text-xl font-medium mb-2">Connect your wallet</h2>
          <p className="text-sm text-muted-foreground mb-6">
            We'll use your EOA as the owner of a smart account.
          </p>
          <button
            onClick={connect}
            disabled={loading}
            className="inline-flex items-center justify-center rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
          >
            {loading ? "Connecting…" : "Connect MetaMask"}
          </button>
          {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <section className="rounded-2xl border border-panel-border bg-panel/70 backdrop-blur p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className="size-8 rounded-lg bg-primary/20 flex items-center justify-center">
                  <div className="size-3 rounded-sm bg-primary" />
                </div>
                <div>
                  <div className="text-sm font-medium">
                    {isTestnet ? "ZeroDev Testnet" : "Universal Account"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {isTestnet
                      ? `Arbitrum Sepolia (${ARB_SEPOLIA.chainId})`
                      : `Owner ${short(eoa ?? undefined)}`}
                  </div>
                </div>
              </div>
              {eoa && (
                <button
                  onClick={disconnect}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Disconnect
                </button>
              )}
            </div>

            {isTestnet ? (
              <div className="space-y-3">
                {!eoa && (
                  <button
                    onClick={connect}
                    disabled={loading}
                    className="w-full rounded-xl bg-primary py-2 text-xs font-medium text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
                  >
                    {loading ? "Connecting…" : "Connect MetaMask"}
                  </button>
                )}
                {eoa && <AddressRow label="EOA" value={eoa} loading={false} />}
                {smartAccountAddress && (
                  <AddressRow
                    label="SA"
                    value={smartAccountAddress}
                    loading={false}
                  />
                )}
                <div className="text-xs text-muted-foreground px-1">
                  Bundler/Paymaster: ZeroDev (chain {ARB_SEPOLIA.chainId})
                </div>
                {logs.length > 0 && (
                  <div className="mt-3 max-h-48 overflow-auto rounded-md border border-panel-border bg-background/40 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                    {logs.map((l, i) => (
                      <div key={i} className="break-all">
                        {l}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
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
              </>
            )}
          </section>

          <section className="rounded-2xl border border-panel-border bg-panel/70 backdrop-blur p-6">
            <div className="inline-flex rounded-lg bg-background/50 p-1 mb-6">
              <button className="px-4 py-1.5 text-sm rounded-md bg-primary text-primary-foreground">
                {isTestnet ? "Gasless UserOps" : "Transfer"}
              </button>
            </div>

            {isTestnet ? (
              <div className="space-y-5">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                    Signer paths
                  </div>
                  <div className="space-y-2">
                    <button
                      onClick={sendZeroDev7702Tx}
                      disabled={!eoa || !!busy}
                      className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
                    >
                      {busy === "Building" ? busy : "Upgrade EOA & send gasless UserOp"}
                    </button>
                    <button
                      onClick={sendZeroDevParticleTx}
                      disabled={!!busy}
                      className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
                    >
                      Login with Particle & send gasless UserOp
                    </button>
                  </div>
                </div>

                <div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                    ZeroDev Intent (Arbitrum → Base, mainnet)
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <IntentBtn label="Intent · Default gas" onClick={runIntent("Intent (default)", (l) => import("@/lib/zerodev-intents").then((m) => m.sendIntentDefault(l)))} disabled={!eoa || !!busy} />
                    <IntentBtn label="Intent · Native ETH" onClick={runIntent("Intent (native)", (l) => import("@/lib/zerodev-intents").then((m) => m.sendIntentNative(l)))} disabled={!eoa || !!busy} />
                    <IntentBtn label="Intent · Sponsored" onClick={runIntent("Intent (sponsored)", (l) => import("@/lib/zerodev-intents").then((m) => m.sendIntentSponsored(l)))} disabled={!eoa || !!busy} />
                    <IntentBtn label="Estimate Fee" onClick={runIntent("Estimate fee", (l) => import("@/lib/zerodev-intents").then((m) => m.estimateIntentFee(l)))} disabled={!eoa || !!busy} />
                    <IntentBtn label="Enable Intent (V3.0→V3.2)" onClick={runIntent("Enable intent", (l) => import("@/lib/zerodev-intents").then((m) => m.enableIntent(l)))} disabled={!eoa || !!busy} />
                    <IntentBtn label="Migrate to Intent Executor" onClick={runIntent("Migrate", (l) => import("@/lib/zerodev-intents").then((m) => m.migrateToIntentExecutor(l)))} disabled={!eoa || !!busy} />
                  </div>
                </div>

                {busy && (
                  <p className="text-xs text-muted-foreground">{busy}…</p>
                )}
                {status && (
                  <p className="text-xs text-[color:var(--success)] break-all">
                    {status}
                  </p>
                )}
                {error && (
                  <p className="text-xs text-destructive break-all">{error}</p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  EIP-7702 needs MetaMask with <code>wallet_signAuthorization</code>. If your version (e.g. 13.32.x) doesn't support it, the EOA path will fall back to an error and you should use the Particle path.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <Field label="Withdraw">
                  <div className="flex items-center justify-between rounded-xl border border-panel-border bg-background/40 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="size-8 rounded-full bg-gradient-to-br from-primary to-accent" />
                      <div>
                        <div className="text-sm font-medium">USDT</div>
                        <div className="text-xs text-muted-foreground">Arbitrum</div>
                      </div>
                    </div>
                    <div className="text-sm font-medium">0.10</div>
                  </div>
                </Field>
                <div className="flex justify-center">
                  <div className="size-8 rounded-full border border-panel-border bg-background/60 flex items-center justify-center text-muted-foreground">
                    ↓
                  </div>
                </div>
                <Field label="To your EOA">
                  <div className="flex items-center justify-between rounded-xl border border-panel-border bg-background/40 px-4 py-3">
                    <div className="text-sm font-mono">{short(eoa ?? "")}</div>
                    <div className="text-xs text-muted-foreground">MetaMask</div>
                  </div>
                </Field>
                <button
                  onClick={sendDemoTx}
                  disabled={!canSend || !!busy}
                  className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
                >
                  {busy ?? "Sign with MetaMask & Send"}
                </button>
                {status && (
                  <p className="text-xs text-[color:var(--success)] break-all">{status}</p>
                )}
                {error && (
                  <p className="text-xs text-destructive break-all">{error}</p>
                )}
                <p className="text-[11px] text-muted-foreground text-center">
                  Signs rootHash with MetaMask, then submits via Particle.
                </p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function IntentBtn({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-panel-border bg-background/40 px-3 py-2 text-xs font-medium text-foreground hover:bg-background/70 transition disabled:opacity-50 disabled:cursor-not-allowed text-left"
    >
      {label}
    </button>
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
