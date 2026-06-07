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
type TestnetMethod = "zerodev-7702" | "zerodev-particle";

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
  const [testnetMethod, setTestnetMethod] = useState<TestnetMethod>(() => {
    if (typeof window === "undefined") return "zerodev-7702";
    return (
      (localStorage.getItem("ua_testnet_method") as TestnetMethod) ||
      "zerodev-7702"
    );
  });
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
  const [xp, setXp] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    return Number(localStorage.getItem("ua_xp") || 0);
  });
  const [txCount, setTxCount] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    return Number(localStorage.getItem("ua_txcount") || 0);
  });
  const [streak, setStreak] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    return Number(localStorage.getItem("ua_streak") || 0);
  });

  const awardXp = useCallback((amount: number) => {
    setXp((x) => {
      const next = x + amount;
      try { localStorage.setItem("ua_xp", String(next)); } catch {}
      return next;
    });
    setTxCount((c) => {
      const next = c + 1;
      try { localStorage.setItem("ua_txcount", String(next)); } catch {}
      return next;
    });
    setStreak((s) => {
      const next = s + 1;
      try { localStorage.setItem("ua_streak", String(next)); } catch {}
      return next;
    });
  }, []);

  const level = Math.floor(xp / 100) + 1;
  const levelProgress = xp % 100;

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

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("ua_testnet_method", testnetMethod);
    }
    setSmartAccountAddress(null);
    setStatus(null);
    setError(null);
  }, [testnetMethod]);

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
      awardXp(50);
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

  // ---------- Testnet path 1: ZeroDev EIP-7702 (Local Account, per 7702.zerodev.app) ----------
  const sendZeroDev7702Tx = useCallback(async () => {
    setBusy("Generating local 7702 account…");
    setError(null);
    setStatus(null);
    try {
      const [
        { createKernelAccount, createKernelAccountClient, createZeroDevPaymasterClient, getUserOperationGasPrice },
        { KERNEL_V3_3, getEntryPoint, KernelVersionToAddressesMap },
        viem,
        accounts,
        { arbitrumSepolia },
      ] = await Promise.all([
        import("@zerodev/sdk"),
        import("@zerodev/sdk/constants"),
        import("viem"),
        import("viem/accounts"),
        import("viem/chains"),
      ]);

      const { createPublicClient, http, zeroAddress } = viem;
      const { generatePrivateKey, privateKeyToAccount } = accounts;

      const kernelVersion = KERNEL_V3_3;
      const kernelAddresses = (KernelVersionToAddressesMap as any)[kernelVersion];

      // Per https://7702.zerodev.app/ — use a freshly generated local EOA so
      // signAuthorization works regardless of wallet support. MetaMask does
      // not yet expose wallet_signAuthorization on Arbitrum Sepolia.
      const privateKey = generatePrivateKey();
      const localAccount = privateKeyToAccount(privateKey);

      const publicClient = createPublicClient({
        transport: http(ARB_SEPOLIA.rpcUrl),
        chain: arbitrumSepolia,
      });

      setBusy("Signing EIP-7702 authorization (local key)…");
      const authorization = await localAccount.signAuthorization({
        chainId: arbitrumSepolia.id,
        nonce: 0,
        address: kernelAddresses.accountImplementationAddress,
      });

      setBusy("Building Kernel smart account…");
      const entryPoint = getEntryPoint("0.7");
      const account = await createKernelAccount(publicClient as any, {
        eip7702Account: localAccount,
        entryPoint,
        kernelVersion,
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

      awardXp(75);
      setStatus(
        `UserOp confirmed! Tx: ${ARB_SEPOLIA.explorer}/tx/${receipt.receipt.transactionHash}`
      );
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || "ZeroDev 7702 failed");
    } finally {
      setBusy(null);
    }
  }, []);


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

      const { createPublicClient, http, zeroAddress } = viem;

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

      // Read the EOA from the provider (for display only — ZeroDev derives it from the provider)
      const accounts: string[] = await particleProvider.request({
        method: "eth_accounts",
      });
      const particleEoa = accounts?.[0] as `0x${string}` | undefined;
      if (!particleEoa) throw new Error("No Particle account returned");

      const publicClient = createPublicClient({
        transport: http(ARB_SEPOLIA.rpcUrl),
        chain: arbitrumSepolia,
      });

      setBusy("Creating ECDSA validator…");
      const entryPoint = getEntryPoint("0.7");
      // ZeroDev's Signer type accepts an EIP-1193 provider directly — this is
      // the shape ZeroDev's Particle docs use. Passing walletClient.account
      // (a JsonRpcAccount) is NOT a valid Signer and produced the
      // "Cannot read properties of undefined (reading 'address')" crash.
      const ecdsaValidator = await signerToEcdsaValidator(publicClient as any, {
        signer: particleProvider as any,
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

  const sendTestnetTx =
    testnetMethod === "zerodev-7702" ? sendZeroDev7702Tx : sendZeroDevParticleTx;
  const sendDemoTx = isTestnet ? sendTestnetTx : sendMainnetTx;

  const totalUsd = useMemo(() => {
    if (!balance) return "—";
    return `$${balance.totalAmountInUSD.toFixed(2)}`;
  }, [balance]);

  // For ZeroDev+Particle path, login happens inside the send action,
  // so the button is always enabled in testnet.
  const canSend = isTestnet
    ? testnetMethod === "zerodev-particle"
      ? true
      : !!eoa
    : !!ua;

  const methodLabel =
    testnetMethod === "zerodev-7702"
      ? "ZeroDev (EIP-7702)"
      : "ZeroDev + Particle";

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
        <div className="mb-6 rounded-xl border border-panel-border bg-panel/60 p-4 text-sm text-muted-foreground space-y-3">
          <div>
            <strong className="text-foreground">Testnet mode — Arbitrum Sepolia.</strong>{" "}
            Gasless UserOps via ZeroDev paymaster. Two signer paths:
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-foreground">Method:</span>
            <div className="inline-flex rounded-md border border-panel-border bg-background/40 p-1">
              {(
                [
                  ["zerodev-7702", "ZeroDev (EIP-7702)"],
                  ["zerodev-particle", "ZeroDev + Particle"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setTestnetMethod(k)}
                  className={`px-3 py-1 text-xs rounded transition ${
                    testnetMethod === k
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <a
              className="text-xs text-primary hover:underline ml-1"
              href={ARB_SEPOLIA.faucet}
              target="_blank"
              rel="noreferrer"
            >
              Get test ETH ↗
            </a>
          </div>
          <div className="text-[11px]">
            {testnetMethod === "zerodev-7702"
              ? "Upgrades your MetaMask EOA into a Kernel V3.3 smart account via EIP-7702 signAuthorization. Requires MetaMask with 7702 support."
              : "Uses Particle Auth (social login) as the ECDSA signer for a Kernel V3.1 smart account — no MetaMask required."}
          </div>
        </div>
      )}

      {!eoa && !(isTestnet && testnetMethod === "zerodev-particle") ? (
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
                    {isTestnet ? methodLabel : "Universal Account"}
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
                {eoa && (
                  <AddressRow label="EOA" value={eoa} loading={false} />
                )}
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
                Transfer
              </button>
            </div>

            <div className="space-y-4">
              <Field label={isTestnet ? "Send" : "Withdraw"}>
                <div className="flex items-center justify-between rounded-xl border border-panel-border bg-background/40 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="size-8 rounded-full bg-gradient-to-br from-primary to-accent" />
                    <div>
                      <div className="text-sm font-medium">
                        {isTestnet ? "UserOp" : "USDT"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {isTestnet ? "Gasless · ZeroDev" : "Arbitrum"}
                      </div>
                    </div>
                  </div>
                  <div className="text-sm font-medium">
                    {isTestnet ? (testnetMethod === "zerodev-7702" ? "2 calls" : "1 call") : "0.10"}
                  </div>
                </div>
              </Field>

              {!isTestnet && (
                <>
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
                </>
              )}

              <button
                onClick={sendDemoTx}
                disabled={!canSend || !!busy}
                className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
              >
                {busy ??
                  (isTestnet
                    ? testnetMethod === "zerodev-7702"
                      ? "Upgrade EOA & send gasless UserOp"
                      : "Login with Particle & send gasless UserOp"
                    : "Sign with MetaMask & Send")}
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
                {isTestnet
                  ? testnetMethod === "zerodev-7702"
                    ? "Signs an EIP-7702 authorization with MetaMask, then sends a sponsored batched UserOp via ZeroDev."
                    : "Particle Auth signer → ZeroDev ECDSA validator → sponsored Kernel UserOp."
                  : "Signs rootHash with MetaMask, then submits via Particle."}
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
