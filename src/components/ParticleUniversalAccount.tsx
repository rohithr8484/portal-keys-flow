import { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { PARTICLE_APP_ID, PARTICLE_CLIENT_KEY, PARTICLE_PROJECT_ID } from "@/lib/particle-config";
import { UniversalPayPanel } from "@/components/UniversalPayPanel";

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

const ARBITRUM_MAINNET = {
  chainId: 42161,
  explorer: "https://arbiscan.io",
};

const ZERODEV_RPC = "https://rpc.zerodev.app/api/v3/263a14d6-19fe-4e98-8ba4-02b793c1aa0a/chain/421614";

const UA_7702_PRIVATE_KEY = "ua_7702_pk";
const UA_PLATFORM_PRIVATE_KEY = "ua_platform_pk";
const ENTRY_POINT_V07_ADDRESS = "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as `0x${string}`;
const QUEST_ENTRYPOINT_DEPOSIT_WEI = BigInt(1_000_000_000_000);
const PLATFORM_FEE_RECIPIENT = "0x24A1C7477Bda0BBa179E40Eb9f538fbB719448Fb" as `0x${string}`;
const ENTRY_POINT_INTERFACE = new ethers.Interface(["function depositTo(address account) payable"]);

async function getPlatformWallet() {
  if (typeof window === "undefined") throw new Error("browser-only");
  const { generatePrivateKey } = await import("viem/accounts");
  let pk = localStorage.getItem(UA_PLATFORM_PRIVATE_KEY);
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk ?? "")) {
    pk = generatePrivateKey();
    localStorage.setItem(UA_PLATFORM_PRIVATE_KEY, pk!);
  }
  const provider = new ethers.JsonRpcProvider(ARB_SEPOLIA.rpcUrl);
  return new ethers.Wallet(pk as string, provider);
}

declare global {
  interface Window {
    ethereum?: any;
  }
}

function short(addr?: string) {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function getSubmittedTxHash(result: any): string | undefined {
  return (
    result?.transactionHash ??
    result?.txHash ??
    result?.hash ??
    result?.receipt?.transactionHash ??
    result?.transactionId
  );
}

function getTxUrl(hashOrId: string | undefined, explorer: string) {
  if (!hashOrId) return undefined;
  return /^0x([A-Fa-f0-9]{64})$/.test(hashOrId)
    ? `${explorer}/tx/${hashOrId}`
    : `https://universalx.app/activity/details?id=${hashOrId}`;
}

function isParticleCustomTxMaintenance(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /system\s+maint/i.test(message) && /send|transfer|sell/i.test(message);
}

function isStoredPrivateKey(value: string | null): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test(value ?? "");
}

async function getLocal7702Account() {
  if (typeof window === "undefined") {
    throw new Error("Local EIP-7702 account is browser-only");
  }

  const { privateKeyToAccount, generatePrivateKey } = await import("viem/accounts");
  const cachedPrivateKey = localStorage.getItem(UA_7702_PRIVATE_KEY);
  let privateKey: `0x${string}`;
  if (isStoredPrivateKey(cachedPrivateKey)) {
    privateKey = cachedPrivateKey;
  } else {
    privateKey = generatePrivateKey();
    localStorage.setItem(UA_7702_PRIVATE_KEY, privateKey);
  }

  return privateKeyToAccount(privateKey);
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
  const [network, setNetwork] = useState<NetworkMode>("mainnet");
  const [testnetMethod, setTestnetMethod] = useState<TestnetMethod>("zerodev-7702");
  const [eoa, setEoa] = useState<string | null>(null);
  const [ua, setUa] = useState<any | null>(null);
  const [addresses, setAddresses] = useState<UAAddresses | null>(null);
  const [balance, setBalance] = useState<PrimaryBalance | null>(null);
  const [smartAccountAddress, setSmartAccountAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [coins, setCoins] = useState<number>(0);
  const [usdc, setUsdc] = useState<number>(0);
  type QuestKey = "play" | "claim" | "spend";
  const [questTx, setQuestTx] = useState<Record<QuestKey, string | null>>({
    play: null,
    claim: null,
    spend: null,
  });
  const [questBusy, setQuestBusy] = useState<QuestKey | null>(null);
  const [xp, setXp] = useState<number>(0);
  const [txCount, setTxCount] = useState<number>(0);
  const [streak, setStreak] = useState<number>(0);
  const [platformAddress, setPlatformAddress] = useState<string | null>(null);
  const [platformBalance, setPlatformBalance] = useState<string | null>(null);
  const [testnetSignedIn, setTestnetSignedIn] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const method = (localStorage.getItem("ua_testnet_method") as TestnetMethod) || "zerodev-7702";
    return localStorage.getItem(`ua_signed_in_${method}`) === "1";
  });
  const [signingIn, setSigningIn] = useState<boolean>(false);

  const persistNum = (key: string, v: number) => {
    try {
      localStorage.setItem(key, String(v));
    } catch {}
  };

  useEffect(() => {
    const storedNetwork = localStorage.getItem("ua_network") as NetworkMode | null;
    const storedMethod = localStorage.getItem("ua_testnet_method") as TestnetMethod | null;
    if (storedNetwork === "mainnet" || storedNetwork === "testnet") {
      setNetwork(storedNetwork);
    }
    if (storedMethod === "zerodev-7702" || storedMethod === "zerodev-particle") {
      setTestnetMethod(storedMethod);
    } else {
      setTestnetMethod("zerodev-7702");
    }
    setCoins(Number(localStorage.getItem("ua_coins") || 0));
    setUsdc(Number(localStorage.getItem("ua_usdc") || 0));
    setXp(Number(localStorage.getItem("ua_xp") || 0));
    setTxCount(Number(localStorage.getItem("ua_txcount") || 0));
    setStreak(Number(localStorage.getItem("ua_streak") || 0));
    // Initialize / load platform wallet
    (async () => {
      try {
        const w = await getPlatformWallet();
        setPlatformAddress(w.address);
        const bal = await w.provider!.getBalance(w.address);
        setPlatformBalance(ethers.formatEther(bal));
      } catch {}
    })();
  }, []);

  const awardXp = useCallback((amount: number) => {
    setXp((x) => {
      const next = x + amount;
      try {
        localStorage.setItem("ua_xp", String(next));
      } catch {}
      return next;
    });
    setTxCount((c) => {
      const next = c + 1;
      try {
        localStorage.setItem("ua_txcount", String(next));
      } catch {}
      return next;
    });
    setStreak((s) => {
      const next = s + 1;
      try {
        localStorage.setItem("ua_streak", String(next));
      } catch {}
      return next;
    });
  }, []);

  // EIP-7702 smart account address is the locally persisted 7702 EOA itself.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (testnetMethod !== "zerodev-7702") {
      // Particle path: address resolved after login during first quest
      const cached = localStorage.getItem("ua_particle_sa");
      setSmartAccountAddress(cached);
      return;
    }
    let cancelled = false;
    getLocal7702Account()
      .then((account) => {
        if (!cancelled) setSmartAccountAddress(account.address);
      })
      .catch(() => {
        if (!cancelled) setSmartAccountAddress(null);
      });
    return () => {
      cancelled = true;
    };
  }, [testnetMethod]);

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
    if (network !== "testnet") setSmartAccountAddress(null);
    setStatus(null);
    setError(null);
    // Do NOT clear testnetSignedIn here — user only signs out via explicit "Sign out".
  }, [network]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("ua_testnet_method", testnetMethod);
      // Restore signed-in state for the newly selected method rather than clearing it.
      setTestnetSignedIn(localStorage.getItem(`ua_signed_in_${testnetMethod}`) === "1");
    }
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
    setTestnetSignedIn(false);
    if (typeof window !== "undefined") {
      localStorage.removeItem(`ua_signed_in_${testnetMethod}`);
    }
  }, [testnetMethod]);

  // Testnet sign-in — derives smart account for the chosen method without sending.
  const signInTestnet = useCallback(async (method: TestnetMethod) => {
    setSigningIn(true);
    setError(null);
    setStatus(null);
    try {
      if (method === "zerodev-7702") {
        const account = await getLocal7702Account();
        setSmartAccountAddress(account.address);
      } else {
        const [{ ParticleNetwork }, { ParticleProvider }] = await Promise.all([
          import("@particle-network/auth"),
          import("@particle-network/provider"),
        ]);
        const particle = new ParticleNetwork({
          projectId: PARTICLE_PROJECT_ID,
          clientKey: PARTICLE_CLIENT_KEY,
          appId: PARTICLE_APP_ID,
          chainName: "arbitrum" as any,
          chainId: ARB_SEPOLIA.chainId,
        });
        if (!particle.auth.isLogin()) {
          await particle.auth.login();
        }
        const particleProvider = new ParticleProvider(particle.auth);
        const accounts: string[] = await particleProvider.request({ method: "eth_accounts" });
        if (!accounts?.[0]) throw new Error("Particle returned no account");
        // Kernel SA is derived lazily on first payment; show the signer EOA for now.
        setSmartAccountAddress(accounts[0]);
      }
      setTestnetSignedIn(true);
      if (typeof window !== "undefined") {
        localStorage.setItem(`ua_signed_in_${method}`, "1");
      }
      setStatus("Signed in.");
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || "Sign in failed");
    } finally {
      setSigningIn(false);
    }
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
      setStatus(`Sent! View: https://universalx.app/activity/details?id=${result.transactionId}`);
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
    setBusy("Preparing funded EIP-7702 smart wallet…");
    setError(null);
    setStatus(null);
    try {
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

      const { createPublicClient, http } = viem;

      const kernelVersion = KERNEL_V3_3;

      const publicClient = createPublicClient({
        transport: http(ARB_SEPOLIA.rpcUrl),
        chain: arbitrumSepolia,
      });

      setBusy("Building Kernel smart account…");
      const local7702Account = await getLocal7702Account();
      const entryPoint = getEntryPoint("0.7");
      const account = await createKernelAccount(publicClient as any, {
        eip7702Account: local7702Account,
        entryPoint,
        kernelVersion,
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
          estimateFeesPerGas: async ({ bundlerClient }: any) => getUserOperationGasPrice(bundlerClient),
        },
      });

      setBusy("Sending gasless batched UserOp…");
      const userOpHash = await kernelClient.sendUserOperation({
        callData: await kernelClient.account!.encodeCalls([{ to: account.address, value: BigInt(0), data: "0x" }]),
      });

      setBusy("Waiting for confirmation…");
      const receipt = await kernelClient.waitForUserOperationReceipt({
        hash: userOpHash,
      });

      awardXp(75);
      setStatus(`UserOp confirmed! Tx: ${ARB_SEPOLIA.explorer}/tx/${receipt.receipt.transactionHash}`);
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || "ZeroDev 7702 failed");
    } finally {
      setBusy(null);
    }
  }, [awardXp]);

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
        { createKernelAccount, createKernelAccountClient, createZeroDevPaymasterClient, getUserOperationGasPrice },
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
          estimateFeesPerGas: async ({ bundlerClient }: any) => getUserOperationGasPrice(bundlerClient),
        },
      });

      setBusy("Sending gasless UserOp…");
      const userOpHash = await kernelClient.sendUserOperation({
        callData: await kernelClient.account!.encodeCalls([{ to: zeroAddress, value: BigInt(0), data: "0x" }]),
      });

      const receipt = await kernelClient.waitForUserOperationReceipt({
        hash: userOpHash,
      });

      awardXp(75);
      setStatus(`UserOp confirmed! Tx: ${ARB_SEPOLIA.explorer}/tx/${receipt.receipt.transactionHash}`);
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || "ZeroDev + Particle failed");
    } finally {
      setBusy(null);
    }
  }, []);

  // ---------- Build a kernel client on demand for quest actions ----------
  const buildKernelClient = useCallback(async () => {
    const [
      { createKernelAccount, createKernelAccountClient, createZeroDevPaymasterClient, getUserOperationGasPrice },
      zerodevConsts,
      viem,
      { arbitrumSepolia },
    ] = await Promise.all([
      import("@zerodev/sdk"),
      import("@zerodev/sdk/constants"),
      import("viem"),
      import("viem/chains"),
    ]);
    const { createPublicClient, http } = viem;
    const publicClient = createPublicClient({
      transport: http(ARB_SEPOLIA.rpcUrl),
      chain: arbitrumSepolia,
    });
    const paymasterClient = createZeroDevPaymasterClient({
      chain: arbitrumSepolia,
      transport: http(ZERODEV_RPC),
    });

    let account: any;
    if (testnetMethod === "zerodev-7702") {
      const { KERNEL_V3_3, getEntryPoint } = zerodevConsts;
      const kernelVersion = KERNEL_V3_3;
      const local7702Account = await getLocal7702Account();
      account = await createKernelAccount(publicClient as any, {
        eip7702Account: local7702Account,
        entryPoint: getEntryPoint("0.7"),
        kernelVersion,
      });
    } else {
      const [{ ParticleNetwork }, { ParticleProvider }, { signerToEcdsaValidator }] = await Promise.all([
        import("@particle-network/auth"),
        import("@particle-network/provider"),
        import("@zerodev/ecdsa-validator"),
      ]);
      const { KERNEL_V3_1, getEntryPoint } = zerodevConsts;
      const particle = new ParticleNetwork({
        projectId: PARTICLE_PROJECT_ID,
        clientKey: PARTICLE_CLIENT_KEY,
        appId: PARTICLE_APP_ID,
        chainName: "arbitrum" as any,
        chainId: ARB_SEPOLIA.chainId,
      });
      const particleProvider = new ParticleProvider(particle.auth);
      if (!particle.auth.isLogin()) await particle.auth.login();
      const entryPoint = getEntryPoint("0.7");
      const ecdsaValidator = await signerToEcdsaValidator(publicClient as any, {
        signer: particleProvider as any,
        entryPoint,
        kernelVersion: KERNEL_V3_1,
      });
      account = await createKernelAccount(publicClient as any, {
        plugins: { sudo: ecdsaValidator },
        entryPoint,
        kernelVersion: KERNEL_V3_1,
      });
    }

    setSmartAccountAddress(account.address);
    try {
      if (testnetMethod === "zerodev-particle" && typeof window !== "undefined") {
        localStorage.setItem("ua_particle_sa", account.address);
      }
    } catch {}

    const kernelClient = createKernelAccountClient({
      account,
      chain: arbitrumSepolia,
      bundlerTransport: http(ZERODEV_RPC),
      paymaster: paymasterClient,
      client: publicClient,
      userOperation: {
        estimateFeesPerGas: async ({ bundlerClient }: any) => getUserOperationGasPrice(bundlerClient),
      },
    });
    return { kernelClient, publicClient };
  }, [testnetMethod]);

  // ---------- GameFi quest runner ----------
  const runQuest = useCallback(
    async (key: QuestKey, label: string, direction: "out" | "in", effect: () => void) => {
      setQuestBusy(key);
      setError(null);
      setStatus(null);
      try {
        setBusy(`${label} · building smart account…`);
        const { kernelClient, publicClient } = await buildKernelClient();
        const smart = kernelClient.account!.address as `0x${string}`;
        const isOutbound = direction === "out";

        // Claim Rewards ("in"): send a tiny self-transfer (SA -> SA) so the on-chain
        // internal transaction visibly credits the smart account, instead of a
        // 0-value self-call whose only ETH movement is paymaster -> bundler operator
        // (e.g. 0x43370494...). Falls back to a 0-value self-call if the SA is empty.
        let to: `0x${string}`;
        let value: bigint;
        let data: `0x${string}`;
        if (isOutbound) {
          to = PLATFORM_FEE_RECIPIENT;
          value = QUEST_ENTRYPOINT_DEPOSIT_WEI;
          data = "0x";
        } else {
          to = smart;
          const smartBalance = await publicClient.getBalance({ address: smart });
          value = smartBalance >= BigInt(1) ? BigInt(1) : BigInt(0);
          data = "0x";
        }

        if (isOutbound && value > BigInt(0)) {
          const smartBalance = await publicClient.getBalance({ address: smart });
          if (smartBalance < value) {
            throw new Error(
              `Smart account ${smart} has ${ethers.formatEther(smartBalance)} ETH; Send to Pool needs ${ethers.formatEther(value)} ETH to send to platform ${PLATFORM_FEE_RECIPIENT}. Fund the SA address shown on the card.`,
            );
          }
        }

        setBusy(
          isOutbound
            ? `${label} · moving ETH from ${smart} → platform ${PLATFORM_FEE_RECIPIENT}…`
            : value > BigInt(0)
              ? `${label} · crediting smart account (${smart})…`
              : `${label} · sending gasless self-call…`,
        );
        const userOpHash = await (kernelClient as any).sendUserOperation({
          callData: await kernelClient.account!.encodeCalls([{ to, value, data }]),
        });
        const receipt = await kernelClient.waitForUserOperationReceipt({ hash: userOpHash });
        const txHash = receipt.receipt.transactionHash;
        setQuestTx((q) => ({ ...q, [key]: txHash }));
        effect();
        awardXp(50);
        const note =
          !isOutbound && value === BigInt(0)
            ? ` (SA has 0 ETH — sent 0-value self-call; fund ${smart} to see a real SA→SA credit)`
            : "";
        setStatus(`${label} confirmed!${note} ${ARB_SEPOLIA.explorer}/tx/${txHash}`);
      } catch (e: any) {
        setError(e?.shortMessage || e?.message || `${label} failed`);
      } finally {
        setQuestBusy(null);
        setBusy(null);
      }
    },
    [buildKernelClient, awardXp],
  );

  const playGame = useCallback(async () => {
    setQuestBusy("play");
    setError(null);
    setStatus(null);
    try {
      // Send as a regular EOA tx from the 7702 smart-account key so it appears
      // in the platform's "Transactions" tab (not just Internal Transactions).
      const pk = localStorage.getItem(UA_7702_PRIVATE_KEY);
      if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
        throw new Error("7702 smart-account key not initialized yet — open the app once, then retry.");
      }
      const rpc = new ethers.JsonRpcProvider(ARB_SEPOLIA.rpcUrl);
      const wallet = new ethers.Wallet(pk, rpc);
      const from = (await wallet.getAddress()) as `0x${string}`;
      const value = QUEST_ENTRYPOINT_DEPOSIT_WEI;
      const bal = await rpc.getBalance(from);
      if (bal < value) {
        throw new Error(
          `Smart account ${from} has ${ethers.formatEther(bal)} ETH; needs at least ${ethers.formatEther(value)} ETH (plus gas) to send to platform ${PLATFORM_FEE_RECIPIENT}.`,
        );
      }
      setBusy(`🏊 Send to Pool · ${from} → platform ${PLATFORM_FEE_RECIPIENT}…`);
      const tx = await wallet.sendTransaction({ to: PLATFORM_FEE_RECIPIENT, value });
      const receipt = await tx.wait();
      const txHash = (receipt?.hash ?? tx.hash) as `0x${string}`;
      setQuestTx((q) => ({ ...q, play: txHash }));
      setUsdc((v) => {
        const n = Math.max(0, v - 0.000001);
        persistNum("ua_usdc", n);
        return n;
      });
      awardXp(50);
      setStatus(
        `🏊 Send to Pool confirmed — ${ethers.formatEther(value)} ETH sent from ${from} to platform ${PLATFORM_FEE_RECIPIENT}. ${ARB_SEPOLIA.explorer}/tx/${txHash}`,
      );
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || "Send to Pool failed");
    } finally {
      setQuestBusy(null);
      setBusy(null);
    }
  }, [awardXp]);
  const claimRewards = useCallback(async () => {
    setQuestBusy("claim");
    setError(null);
    setStatus(null);
    try {
      setBusy("🎁 Claim Rewards · deriving smart account…");
      const { kernelClient } = await buildKernelClient();
      const smart = kernelClient.account!.address as `0x${string}`;

      // Platform Treasury -> Smart Account transfer. The platform wallet is a
      // local dev key stored in this browser (ua_platform_pk). Fund its address
      // on Arbitrum Sepolia and it will pay out rewards to the SA.
      const platform = await getPlatformWallet();
      const from = platform.address as `0x${string}`;
      setPlatformAddress(from);
      const rewardWei = ethers.parseUnits("0.000001", "ether");

      const bal = await platform.provider!.getBalance(from);
      setPlatformBalance(ethers.formatEther(bal));
      if (bal < rewardWei + ethers.parseUnits("0.00005", "ether"))
        throw new Error(
          `Platform account ${from} needs ETH on Arbitrum Sepolia. Fund it from the faucet, then retry. Current balance: ${ethers.formatEther(bal)} ETH.`,
        );

      setBusy(`🎁 Claim Rewards · platform ${from} → smart account ${smart}…`);
      const tx = await platform.sendTransaction({ to: smart, value: rewardWei });
      const rcpt = await tx.wait();
      const txHash = (rcpt?.hash ?? tx.hash) as `0x${string}`;
      setQuestTx((q) => ({ ...q, claim: txHash }));

      const newBal = await platform.provider!.getBalance(from);
      setPlatformBalance(ethers.formatEther(newBal));

      setUsdc((v) => {
        const n = v + 2;
        persistNum("ua_usdc", n);
        return n;
      });
      setCoins((c) => {
        const n = c + 10;
        persistNum("ua_coins", n);
        return n;
      });
      awardXp(50);
      setStatus(
        `🎁 Claim Rewards confirmed — 0.000001 ETH sent from platform ${from} to smart account ${smart}. ${ARB_SEPOLIA.explorer}/tx/${txHash}`,
      );
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || "Claim Rewards failed");
    } finally {
      setQuestBusy(null);
      setBusy(null);
    }
  }, [buildKernelClient, awardXp]);

  const spendCoins = useCallback(
    () =>
      runQuest("spend", "🛒 Spend Coins", "out", () => {
        setCoins((c) => {
          const n = Math.max(0, c - 5);
          persistNum("ua_coins", n);
          return n;
        });
        setUsdc((v) => {
          const n = v + 3;
          persistNum("ua_usdc", n);
          return n;
        });
      }),
    [runQuest],
  );

  const sendTestnetTx = testnetMethod === "zerodev-7702" ? sendZeroDev7702Tx : sendZeroDevParticleTx;
  const sendDemoTx = isTestnet ? sendTestnetTx : sendMainnetTx;

  const totalUsd = useMemo(() => {
    if (!balance) return "—";
    return `$${balance.totalAmountInUSD.toFixed(2)}`;
  }, [balance]);

  // Testnet send actions build their signer on demand.
  const canSend = isTestnet ? true : !!ua;

  const methodLabel = testnetMethod === "zerodev-7702" ? "ZeroDev (EIP-7702)" : "ZeroDev + Particle";

  return (
    <div className="relative w-full max-w-6xl mx-auto px-6 py-12">
      {/* Animated GameFi backdrop */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 gamefi-grid opacity-30" />
        <div className="absolute -top-32 left-1/4 size-96 rounded-full bg-primary/25 blur-[120px] float-slow" />
        <div
          className="absolute top-40 right-10 size-80 rounded-full bg-accent/25 blur-[120px] float-slow"
          style={{ animationDelay: "1.5s" }}
        />
        <div
          className="absolute bottom-20 left-10 size-72 rounded-full bg-primary/15 blur-[100px] float-slow"
          style={{ animationDelay: "3s" }}
        />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      </div>

      <header className="mb-10 text-center relative">
        <div className="flex justify-center mb-5">
          <div className="relative inline-flex items-center gap-3 px-5 py-2.5 rounded-2xl border border-panel-border bg-panel/70 backdrop-blur-xl shadow-lg shadow-primary/10">
            <div className="relative size-8 rounded-xl bg-gradient-to-br from-primary via-accent to-primary flex items-center justify-center text-base font-black text-primary-foreground glow-pulse">
              ◆
            </div>
            <div className="text-left leading-tight">
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Powered by Particle</div>
              <div className="text-sm font-bold tracking-tight">Paygrid</div>
            </div>
          </div>
        </div>

        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-panel-border bg-panel/60 text-[11px] text-muted-foreground mb-5">
          <span className="size-1.5 rounded-full bg-success animate-pulse" />
          EIP-7702 · Universal Accounts · Cross-chain GameFi
        </div>

        <h1 className="text-5xl sm:text-6xl font-black tracking-tighter neon-text">
          <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent [background-size:200%_auto] animate-[shimmer_4s_linear_infinite]">
            Paygrid
          </span>
        </h1>
        <p className="mt-4 text-muted-foreground max-w-xl mx-auto text-sm sm:text-base">One Universal wallet.</p>

        <div className="mt-7 inline-flex rounded-xl border border-panel-border bg-panel/70 backdrop-blur p-1 shadow-lg shadow-primary/5">
          {(["mainnet", "testnet"] as const).map((n) => (
            <button
              key={n}
              onClick={() => setNetwork(n)}
              className={`px-5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                network === n
                  ? "bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md shadow-primary/30"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {n === "mainnet" ? "◉ Mainnet" : "◎ Testnet"}
            </button>
          ))}
        </div>
      </header>

      <UniversalPayPanel
        smartAccount={isTestnet ? smartAccountAddress : (addresses?.evmSmartAccount ?? (ua ? eoa : null))}
        unifiedUsd={balance?.totalAmountInUSD ?? null}
        network={isTestnet ? "testnet" : "mainnet"}
        onNotify={(msg: string) => setStatus(msg)}
        onPay={async ({ recipient, amount, token }) => {
          const { buildSplitNativeCalls, buildSplitERC20Calls, EVM_CHAINS } = await import("@/lib/split");

          // ---- Testnet path: send directly from the local 7702 EOA key so
          // the transfer appears as a top-level Arbiscan Sepolia transaction
          // (not just an internal call under a UserOp bundle). Keeps the
          // same ETH / native-USDC currency semantics as before. ----
          if (isTestnet) {
            const ARB_SEPOLIA_USDC = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
            const pk = localStorage.getItem(UA_7702_PRIVATE_KEY);
            if (!isStoredPrivateKey(pk)) {
              throw new Error("Testnet smart account key missing. Sign in again.");
            }
            const rpcProvider = new ethers.JsonRpcProvider(ARB_SEPOLIA.rpcUrl);
            const wallet = new ethers.Wallet(pk, rpcProvider);
            const to = ethers.getAddress(recipient);
            let tx;
            if (token === "ETH") {
              tx = await wallet.sendTransaction({
                to,
                value: ethers.parseEther(String(amount)),
              });
            } else {
              const iface = new ethers.Interface(["function transfer(address,uint256)"]);
              const units = ethers.parseUnits(String(amount), 6);
              const data = iface.encodeFunctionData("transfer", [to, units]);
              tx = await wallet.sendTransaction({ to: ARB_SEPOLIA_USDC, data });
            }
            await tx.wait();
            awardXp(25);
            return { txId: tx.hash, txUrl: `${ARB_SEPOLIA.explorer}/tx/${tx.hash}` };
          }

          // ---- Mainnet: send directly from the connected MetaMask EOA on
          // Arbitrum One. Mirrors the /pay/:requestId payer flow which reads
          // funds straight from the user's wallet instead of relying on the
          // Universal Account to source primary assets. ----
          const ARB_ONE_HEX = "0xa4b1";
          const ARB_ONE_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
          if (!window.ethereum) throw new Error("MetaMask not detected");
          try {
            await window.ethereum.request({
              method: "wallet_switchEthereumChain",
              params: [{ chainId: ARB_ONE_HEX }],
            });
          } catch (err: any) {
            if (err?.code === 4902) {
              await window.ethereum.request({
                method: "wallet_addEthereumChain",
                params: [
                  {
                    chainId: ARB_ONE_HEX,
                    chainName: "Arbitrum One",
                    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                    rpcUrls: ["https://arb1.arbitrum.io/rpc"],
                    blockExplorerUrls: [ARBITRUM_MAINNET.explorer],
                  },
                ],
              });
            } else {
              throw err;
            }
          }
          const provider = new ethers.BrowserProvider(window.ethereum);
          const signer = await provider.getSigner();
          const from = ethers.getAddress(await signer.getAddress());
          const to = ethers.getAddress(recipient);
          let txHash: string;
          if (token === "ETH") {
            const wei = ethers.parseEther(amount.toString());
            txHash = await window.ethereum.request({
              method: "eth_sendTransaction",
              params: [{ from, to, value: ethers.toQuantity(wei) }],
            });
          } else {
            const units = ethers.parseUnits(amount.toString(), 6);
            const iface = new ethers.Interface(["function transfer(address,uint256)"]);
            const data = iface.encodeFunctionData("transfer", [to, units]);
            txHash = await window.ethereum.request({
              method: "eth_sendTransaction",
              params: [{ from, to: ARB_ONE_USDC, data }],
            });
          }
          await provider.waitForTransaction(txHash);
          return { txId: txHash, txUrl: `${ARBITRUM_MAINNET.explorer}/tx/${txHash}` };
        }}
        onSplitPay={async ({ recipients, token }) => {
          const { buildSplitNativeCalls, buildSplitERC20Calls, EVM_CHAINS } = await import("@/lib/split");

          // ---- Testnet path: send each leg as a direct EOA transaction from
          // the local 7702 key. This makes every transfer appear in the
          // "Transactions" tab of Arbiscan (Sepolia) instead of only showing
          // up as an internal transaction under a UserOp bundle. ----
          if (isTestnet) {
            const ARB_SEPOLIA_USDC = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
            const pk = localStorage.getItem(UA_7702_PRIVATE_KEY);
            if (!isStoredPrivateKey(pk)) {
              throw new Error("Testnet smart account key missing. Sign in again.");
            }
            const rpcProvider = new ethers.JsonRpcProvider(ARB_SEPOLIA.rpcUrl);
            const wallet = new ethers.Wallet(pk, rpcProvider);
            const erc20Iface = new ethers.Interface(["function transfer(address,uint256)"]);
            const hashes: string[] = [];
            for (const r of recipients) {
              const to = ethers.getAddress(r.address);
              let tx;
              if (token === "ETH") {
                tx = await wallet.sendTransaction({
                  to,
                  value: ethers.parseEther(String(r.amount)),
                });
              } else {
                const units = ethers.parseUnits(String(r.amount), 6);
                const data = erc20Iface.encodeFunctionData("transfer", [to, units]);
                tx = await wallet.sendTransaction({
                  to: ARB_SEPOLIA_USDC,
                  data,
                });
              }
              await tx.wait();
              hashes.push(tx.hash);
            }
            awardXp(50);
            const first = hashes[0];
            return {
              txId: hashes.join(", "),
              txUrl: first ? `${ARB_SEPOLIA.explorer}/tx/${first}` : undefined,
            };
          }

          // ---- Mainnet: send every recipient directly from the connected
          // MetaMask EOA on Arbitrum One (same approach as /pay/:requestId).
          // Each leg is a normal wallet transaction, so funds come from the
          // user's own ETH/USDC balance rather than the Universal Account's
          // sourced primary assets. ----
          const ARB_ONE_HEX = "0xa4b1";
          const ARB_ONE_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
          if (!window.ethereum) throw new Error("MetaMask not detected");
          try {
            await window.ethereum.request({
              method: "wallet_switchEthereumChain",
              params: [{ chainId: ARB_ONE_HEX }],
            });
          } catch (err: any) {
            if (err?.code === 4902) {
              await window.ethereum.request({
                method: "wallet_addEthereumChain",
                params: [
                  {
                    chainId: ARB_ONE_HEX,
                    chainName: "Arbitrum One",
                    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                    rpcUrls: ["https://arb1.arbitrum.io/rpc"],
                    blockExplorerUrls: [ARBITRUM_MAINNET.explorer],
                  },
                ],
              });
            } else {
              throw err;
            }
          }
          const providerMain = new ethers.BrowserProvider(window.ethereum);
          const signerMain = await providerMain.getSigner();
          const fromMain = ethers.getAddress(await signerMain.getAddress());
          const erc20 = new ethers.Interface(["function transfer(address,uint256)"]);
          const hashes: string[] = [];
          for (const r of recipients) {
            const to = ethers.getAddress(r.address);
            let hash: string;
            if (token === "ETH") {
              const wei = ethers.parseEther(String(r.amount));
              hash = await window.ethereum.request({
                method: "eth_sendTransaction",
                params: [{ from: fromMain, to, value: ethers.toQuantity(wei) }],
              });
            } else {
              const units = ethers.parseUnits(String(r.amount), 6);
              const data = erc20.encodeFunctionData("transfer", [to, units]);
              hash = await window.ethereum.request({
                method: "eth_sendTransaction",
                params: [{ from: fromMain, to: ARB_ONE_USDC, data }],
              });
            }
            await providerMain.waitForTransaction(hash);
            hashes.push(hash);
          }
          return {
            txId: hashes.join(", "),
            txUrl: hashes[0] ? `${ARBITRUM_MAINNET.explorer}/tx/${hashes[0]}` : undefined,
          };
        }}
      />

      <section className="mb-8 rounded-2xl border border-panel-border bg-panel/70 backdrop-blur p-5 neon-border">
        {/* GameFi action loop — each button fires a real gasless UserOp via the selected method */}
        {isTestnet && (
          <div className="mt-6">
            {platformAddress && (
              <div className="mb-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-[11px] flex flex-wrap items-center gap-2 justify-between">
                <div>
                  <div className="font-semibold text-foreground">🏦 Platform Treasury (rewards source)</div>
                  <div className="text-muted-foreground break-all">
                    {platformAddress} · balance {platformBalance ?? "…"} ETH
                  </div>
                </div>
                <a href={ARB_SEPOLIA.faucet} target="_blank" rel="noreferrer" className="underline text-primary">
                  Fund via faucet →
                </a>
              </div>
            )}
            {/* Send to Pool & Claim Rewards buttons intentionally hidden — logic preserved in playGame/claimRewards. */}
            <div className="hidden grid grid-cols-1 md:grid-cols-3 gap-3">
              <GameActionCard
                emoji="🏊"
                title="Send to Pool"
                subtitle="Route ETH → Platform"
                reward="-0.000001 ETH"
                busy={questBusy === "play"}
                disabled={!!questBusy}
                onClick={playGame}
                txHash={questTx.play}
                explorer={ARB_SEPOLIA.explorer}
                smartAccount={smartAccountAddress}
                direction="out"
              />
              <GameActionCard
                emoji="🎁"
                title="Claim Rewards"
                subtitle="→ Receive ETH"
                reward="+2 ETH · +10 🪙"
                busy={questBusy === "claim"}
                disabled={!!questBusy}
                onClick={claimRewards}
                txHash={questTx.claim}
                explorer={ARB_SEPOLIA.explorer}
                smartAccount={smartAccountAddress}
                direction="in"
              />
            </div>
          </div>
        )}
      </section>

      {missingAppId && !isTestnet && (
        <div className="mb-6 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <strong className="text-destructive-foreground">App ID missing.</strong> Set <code>VITE_PARTICLE_APP_ID</code>{" "}
          or edit
          <code> src/lib/particle-config.ts</code>.
        </div>
      )}

      {isTestnet && (
        <div className="mb-6 rounded-xl border border-panel-border bg-panel/60 p-4 text-sm text-muted-foreground space-y-2">
          <div>
            <strong className="text-foreground">Testnet mode — Arbitrum Sepolia.</strong> Gasless UserOps via ZeroDev
            paymaster.
          </div>
          <div className="text-[11px]">
            One wallet per browser: your EIP-7702 Kernel smart account address is derived from a locally-persisted key
            and reused every time you sign in.
            <a className="text-primary hover:underline ml-2" href={ARB_SEPOLIA.faucet} target="_blank" rel="noreferrer">
              Get test ETH ↗
            </a>
          </div>
        </div>
      )}

      {(!eoa && !isTestnet) || (isTestnet && !testnetSignedIn) ? (
        <div className="space-y-14">
          <div className="relative overflow-hidden rounded-3xl border border-panel-border bg-gradient-to-br from-panel/90 via-panel/70 to-panel/40 backdrop-blur-xl p-10 text-center shadow-2xl shadow-primary/10 animate-fade-in">
            <div
              aria-hidden
              className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full bg-primary/20 blur-3xl float-slow"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -bottom-24 -left-24 size-64 rounded-full bg-accent/20 blur-3xl float-slow"
              style={{ animationDelay: "2s" }}
            />
            <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px shimmer-bar" />
            <div className="relative">
              <div className="mx-auto size-16 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center text-3xl mb-5 shadow-lg shadow-primary/30 glow-pulse animate-scale-in">
                {isTestnet ? "🔐" : "🦊"}
              </div>
              <h2
                className="text-2xl sm:text-3xl font-bold mb-2 tracking-tight animate-fade-in"
                style={{ animationDelay: "80ms", animationFillMode: "backwards" }}
              >
                {isTestnet ? "Sign in to continue" : "Connect your wallet"}
              </h2>
              <p
                className="text-sm text-muted-foreground mb-7 max-w-md mx-auto animate-fade-in"
                style={{ animationDelay: "160ms", animationFillMode: "backwards" }}
              >
                {isTestnet
                  ? "Unlock your Kernel smart account on Arbitrum Sepolia and start moving value across chains."
                  : "Your EOA becomes the owner of a Universal Account — one balance, every supported chain."}
              </p>

              {isTestnet ? (
                <div
                  className="flex justify-center max-w-md mx-auto animate-fade-in"
                  style={{ animationDelay: "240ms", animationFillMode: "backwards" }}
                >
                  <button
                    onClick={() => signInTestnet("zerodev-7702")}
                    disabled={signingIn}
                    className="w-full inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-primary to-accent px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 shadow-lg shadow-primary/30 hover:shadow-primary/50"
                  >
                    {signingIn ? "Signing in…" : "Sign in with ZeroDev (EIP-7702)"}
                  </button>
                </div>
              ) : (
                <button
                  onClick={connect}
                  disabled={loading}
                  className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-primary to-accent px-7 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 shadow-lg shadow-primary/30 hover:shadow-primary/50 animate-fade-in"
                  style={{ animationDelay: "240ms", animationFillMode: "backwards" }}
                >
                  {loading ? "Connecting…" : "Sign in with MetaMask"}
                </button>
              )}

              {error && <p className="mt-4 text-sm text-destructive animate-fade-in">{error}</p>}
            </div>
          </div>

          <LandingHowItWorks />
          <LandingFaq />
        </div>
      ) : (
        <div className="grid gap-6">
          <section className="rounded-2xl border border-panel-border bg-panel/70 backdrop-blur p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className="size-8 rounded-lg bg-primary/20 flex items-center justify-center">
                  <div className="size-3 rounded-sm bg-primary" />
                </div>
                <div>
                  <div className="text-sm font-medium">{isTestnet ? methodLabel : "Universal Account"}</div>
                  <div className="text-xs text-muted-foreground">
                    {isTestnet ? `Arbitrum Sepolia (${ARB_SEPOLIA.chainId})` : `Owner ${short(eoa ?? undefined)}`}
                  </div>
                </div>
              </div>
              <button onClick={disconnect} className="text-xs text-muted-foreground hover:text-foreground">
                Sign out
              </button>
            </div>

            {isTestnet ? (
              <div className="space-y-3">
                {smartAccountAddress && <AddressRow label="SA" value={smartAccountAddress} loading={false} />}
                <div className="text-xs text-muted-foreground px-1">
                  Bundler/Paymaster: ZeroDev (chain {ARB_SEPOLIA.chainId})
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  <AddressRow label="EVM" value={addresses?.evmSmartAccount ?? ""} loading={loading && !addresses} />
                  <AddressRow label="SOL" value={addresses?.solanaSmartAccount ?? ""} loading={loading && !addresses} />
                </div>

                <div className="mt-6 rounded-xl border border-panel-border bg-background/40 p-5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">Wallet balance</span>
                    <button
                      onClick={refresh}
                      className="text-xs text-muted-foreground hover:text-foreground"
                      disabled={loading}
                    >
                      {loading ? "…" : "↻"}
                    </button>
                  </div>
                  <div className="text-3xl font-semibold">{totalUsd}</div>
                  <div className="mt-1 text-xs text-muted-foreground">Aggregated across supported chains</div>
                </div>
              </>
            )}

            {status && <p className="mt-4 text-xs text-[color:var(--success)] break-all">{status}</p>}
            {error && <p className="mt-4 text-xs text-destructive break-all">{error}</p>}
          </section>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function AddressRow({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-panel-border bg-background/40 px-4 py-3">
      <div className="text-xs font-medium text-muted-foreground w-10">{label}</div>
      <div className="flex-1 font-mono text-sm">{loading ? "Loading…" : short(value)}</div>
      {value && <Copy value={value} />}
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: string;
  accent: "primary" | "accent" | "success";
  icon?: string;
}) {
  const accentClass =
    accent === "success"
      ? "text-[color:var(--success)]"
      : accent === "accent"
        ? "text-accent-foreground"
        : "text-primary-foreground";
  return (
    <div className="relative overflow-hidden rounded-xl border border-panel-border bg-background/50 p-3 hover:border-primary/50 transition-colors group">
      <div className="absolute -right-4 -top-4 size-16 rounded-full bg-primary/10 blur-2xl group-hover:bg-primary/20 transition" />
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        {icon && <span className={`text-xs ${accentClass}`}>{icon}</span>}
      </div>
      <div className="text-xl font-bold tabular-nums neon-text">{value}</div>
    </div>
  );
}

function QuestCard({ title, desc, done, reward }: { title: string; desc: string; done: boolean; reward: string }) {
  return (
    <div
      className={`relative rounded-xl border p-3 transition-all ${
        done
          ? "border-[color:var(--success)]/40 bg-[color:var(--success)]/5"
          : "border-panel-border bg-background/40 hover:border-primary/40"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span
              className={`size-4 rounded-full flex items-center justify-center text-[10px] ${
                done ? "bg-[color:var(--success)] text-background" : "border border-panel-border text-muted-foreground"
              }`}
            >
              {done ? "✓" : "○"}
            </span>
            <span className="text-xs font-medium">{title}</span>
          </div>
          <div className="text-[11px] text-muted-foreground pl-6">{desc}</div>
        </div>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/15 text-primary-foreground border border-primary/30 whitespace-nowrap">
          {reward}
        </span>
      </div>
    </div>
  );
}

function GameActionCard({
  emoji,
  title,
  subtitle,
  reward,
  busy,
  disabled,
  onClick,
  txHash,
  explorer,
  smartAccount,
  direction,
}: {
  emoji: string;
  title: string;
  subtitle: string;
  reward: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  txHash: string | null;
  explorer: string;
  smartAccount: string | null;
  direction: "in" | "out";
}) {
  const dirLabel = direction === "out" ? "Action from" : "Reward to";
  return (
    <div className="relative overflow-hidden rounded-xl border border-panel-border bg-background/50 p-4 hover:border-primary/50 transition group">
      <div className="absolute -right-6 -top-6 size-24 rounded-full bg-primary/10 blur-2xl group-hover:bg-primary/20 transition" />
      <div className="flex items-start gap-3 mb-3">
        <div className="size-10 rounded-lg bg-gradient-to-br from-primary/30 to-accent/30 flex items-center justify-center text-xl">
          {emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-[11px] text-muted-foreground">{subtitle}</div>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary-foreground border border-primary/30 whitespace-nowrap">
          {reward}
        </span>
      </div>
      <button
        onClick={onClick}
        disabled={disabled}
        className="w-full rounded-lg bg-primary py-2 text-xs font-medium text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
      >
        {busy ? "Sending UserOp…" : `${emoji} ${title}`}
      </button>
      <div className="mt-2 rounded-md border border-panel-border bg-background/40 px-2 py-1.5">
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Smart Account · {dirLabel}</div>
        {smartAccount ? (
          <div className="flex items-center gap-1">
            <a
              href={`${explorer}/address/${smartAccount}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[10px] text-primary-foreground hover:underline truncate"
              title={smartAccount}
            >
              {smartAccount.slice(0, 10)}…{smartAccount.slice(-8)}
            </a>
            <Copy value={smartAccount} />
          </div>
        ) : (
          <div className="text-[10px] text-muted-foreground italic">click to derive on first run</div>
        )}
      </div>
      {txHash && (
        <a
          href={`${explorer}/tx/${txHash}`}
          target="_blank"
          rel="noreferrer"
          className="mt-2 block text-[10px] text-[color:var(--success)] hover:underline truncate font-mono"
          title={txHash}
        >
          ✓ tx {txHash.slice(0, 10)}…{txHash.slice(-6)} ↗
        </a>
      )}
    </div>
  );
}

// ---------- Landing sections (sign-in view only, UI-only) ----------

const HOW_STEPS = [
  {
    n: "01",
    title: "Connect once",
    desc: "Sign in with MetaMask or ZeroDev. A Universal smart account is bound to your EOA — same address, superpowers.",
    img: "https://images.unsplash.com/photo-1639762681485-074b7f938ba0?auto=format&fit=crop&w=900&q=70",
    alt: "Abstract crypto wallet illustration",
  },
  {
    n: "02",
    title: "One Universal balance",
    desc: "Your holdings across supported networks are unified. Paygrid routes the cheapest source and delivers the token the recipient asked for.",
    img: "https://images.unsplash.com/photo-1620321023374-d1a68fbc720d?auto=format&fit=crop&w=900&q=70",
    alt: "Interconnected network of nodes",
  },
  {
    n: "03",
    title: "Pay, split, receive",
    desc: "Send USDC or ETH, split a bill atomically in one signature, or share a QR request and get paid instantly.",
    img: "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=900&q=70",
    alt: "Mobile payment illustration",
  },
];

function LandingHowItWorks() {
  return (
    <section className="relative">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-panel-border bg-panel/60 text-[11px] text-muted-foreground mb-3">
          <span className="size-1.5 rounded-full bg-accent" />
          How it works
        </div>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
          Three steps to a{" "}
          <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            chain-agnostic wallet
          </span>
        </h2>
        <p className="mt-3 text-sm text-muted-foreground max-w-lg mx-auto">
          Paygrid layers Universal Accounts on top of your existing wallet — no new seed phrase, no bridge dance.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {HOW_STEPS.map((s, i) => (
          <div
            key={s.n}
            className="group relative overflow-hidden rounded-2xl border border-panel-border bg-panel/60 backdrop-blur hover:border-primary/60 transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl hover:shadow-primary/30 animate-fade-in"
            style={{ animationDelay: `${i * 120}ms`, animationFillMode: "backwards" }}
          >
            <div className="relative aspect-[16/10] overflow-hidden">
              <img
                src={s.img}
                alt={s.alt}
                loading="lazy"
                className="w-full h-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-110"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-panel via-panel/40 to-transparent" />
              <div className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-background/70 backdrop-blur-md border border-panel-border text-[10px] font-mono text-primary group-hover:border-primary/60 group-hover:text-accent transition-colors">
                {s.n}
              </div>
              <div
                aria-hidden
                className="absolute -inset-x-8 -bottom-8 h-24 bg-gradient-to-r from-primary/0 via-primary/40 to-accent/0 blur-2xl opacity-0 group-hover:opacity-60 transition-opacity duration-500"
              />
            </div>
            <div className="p-5">
              <div className="text-base font-semibold mb-1.5 group-hover:text-primary transition-colors">{s.title}</div>
              <div className="text-xs text-muted-foreground leading-relaxed">{s.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const LANDING_FAQ = [
  {
    q: "What is Paygrid?",
    a: "A smart-account wallet UX layered on Particle Universal Accounts. Sign in once and move value across supported chains from a single balance.",
  },
  {
    q: "Which networks are supported?",
    a: "Settlement happens on Arbitrum One (mainnet) and Arbitrum Sepolia (testnet). Funds can be sourced from any chain Particle indexes.",
  },
  {
    q: "Which tokens can I move?",
    a: "USDC and ETH. Your Universal Account picks the cheapest source assets you already hold and delivers the token the recipient asked for.",
  },
  {
    q: "Do splits require multiple signatures?",
    a: "No. A split is a single atomic Universal Account transaction — everyone settles together, in one signature.",
  },
  {
    q: "How does Receive work?",
    a: "Generate a request from the Receive tab. You get a QR code and a shareable link that opens a payer view on any wallet.",
  },
  {
    q: "What are the fees?",
    a: "Paygrid adds no protocol fee. You only pay underlying network gas plus whatever Particle needs to route funds across chains.",
  },
];

function LandingFaq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="relative">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-panel-border bg-panel/60 text-[11px] text-muted-foreground mb-3">
          <span className="size-1.5 rounded-full bg-primary" />
          FAQ
        </div>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
          Answers before you{" "}
          <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">connect</span>
        </h2>
      </div>

      <div className="max-w-3xl mx-auto grid gap-3">
        {LANDING_FAQ.map((item, i) => {
          const isOpen = open === i;
          return (
            <div
              key={item.q}
              className={`rounded-2xl border bg-panel/60 backdrop-blur transition-all duration-300 overflow-hidden animate-fade-in hover:-translate-y-0.5 ${
                isOpen
                  ? "border-primary/50 shadow-lg shadow-primary/20"
                  : "border-panel-border hover:border-primary/30 hover:shadow-md hover:shadow-primary/10"
              }`}
              style={{ animationDelay: `${i * 60}ms`, animationFillMode: "backwards" }}
            >
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : i)}
                className="w-full flex items-center justify-between gap-4 text-left px-5 py-4 cursor-pointer group"
              >
                <span className="text-sm font-semibold group-hover:text-primary transition-colors">{item.q}</span>
                <span
                  className={`shrink-0 size-7 rounded-full flex items-center justify-center border transition-all duration-300 ${
                    isOpen
                      ? "rotate-45 bg-primary/20 border-primary/50 text-primary scale-110"
                      : "bg-background/40 border-panel-border text-primary group-hover:bg-primary/10 group-hover:scale-105"
                  }`}
                >
                  +
                </span>
              </button>
              <div
                className={`grid transition-all duration-300 ease-out ${
                  isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="overflow-hidden">
                  <div className="px-5 pb-5 text-xs text-muted-foreground leading-relaxed border-t border-panel-border/60 pt-3">
                    {item.a}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
