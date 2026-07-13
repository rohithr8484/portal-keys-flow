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
  const [testnetSignedIn, setTestnetSignedIn] = useState<boolean>(false);
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
    setTestnetSignedIn(false);
  }, [network]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("ua_testnet_method", testnetMethod);
    }
    setSmartAccountAddress(null);
    setStatus(null);
    setError(null);
    setTestnetSignedIn(false);
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
  }, []);

  // Testnet sign-in — derives smart account for the chosen method without sending.
  const signInTestnet = useCallback(
    async (method: TestnetMethod) => {
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
        setStatus("Signed in.");
      } catch (e: any) {
        setError(e?.shortMessage || e?.message || "Sign in failed");
      } finally {
        setSigningIn(false);
      }
    },
    [],
  );



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
        <p className="mt-4 text-muted-foreground max-w-xl mx-auto text-sm sm:text-base">One wallet. Every chain.</p>

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
        onNotify={(msg: string) => setStatus(msg)}
        onPay={async ({ recipient, amount, token }) => {
          const { buildSplitNativeCalls, buildSplitERC20Calls, EVM_CHAINS } = await import("@/lib/split");

          // ---- Testnet path: gasless kernel userop (send-to-pool style) ----
          if (isTestnet) {
            const { kernelClient } = await buildKernelClient();
            const chainId = EVM_CHAINS.arbitrumSepolia;
            const calls =
              token === "ETH"
                ? buildSplitNativeCalls({
                    chainId,
                    recipients: [{ address: recipient, amount }],
                  })
                : buildSplitNativeCalls({
                    chainId,
                    recipients: [{ address: recipient, amount }],
                  });
            const userOpHash = await (kernelClient as any).sendUserOperation({
              callData: await kernelClient.account!.encodeCalls(
                calls.map((c) => ({
                  to: c.to as `0x${string}`,
                  value: BigInt(c.value),
                  data: c.data as `0x${string}`,
                })),
              ),
            });
            const receipt = await kernelClient.waitForUserOperationReceipt({
              hash: userOpHash,
            });
            const txId = receipt.receipt.transactionHash;
            awardXp(25);
            return { txId, txUrl: `${ARB_SEPOLIA.explorer}/tx/${txId}` };
          }

          // ---- Mainnet: single-recipient transfer via Universal Account.
          // Follows the `sell-evm.ts` pattern: createTransferTransaction →
          // sign(rootHash) → sendTransaction. Native ETH uses the zero
          // address per `buy-evm.ts` ("if you want to buy native token,
          // the address is 0x000...000"). ----
          if (!(ua && eoa)) throw new Error("Connect a wallet first");
          const { CHAIN_ID } = await loadSdk();
          const NATIVE = "0x0000000000000000000000000000000000000000";
          const TOKENS: Record<"USDC" | "ETH", string> = {
            // Native (Circle) USDC on Arbitrum One
            USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
            ETH: NATIVE,
          };
          const tx = await ua.createTransferTransaction({
            token: {
              chainId: CHAIN_ID.ARBITRUM_MAINNET_ONE,
              address: TOKENS[token],
            },
            amount: amount.toString(),
            receiver: recipient,
          });
          const provider = new ethers.BrowserProvider(window.ethereum);
          const signer = await provider.getSigner();
          const signature = await signer.signMessage(ethers.getBytes(tx.rootHash));
          const result = await ua.sendTransaction(tx, signature);
          const txId = getSubmittedTxHash(result);
          return {
            txId,
            txUrl: getTxUrl(txId, ARBITRUM_MAINNET.explorer),
          };
        }}
        onSplitPay={async ({ recipients, token }) => {
          const { buildSplitNativeCalls, buildSplitERC20Calls, EVM_CHAINS } = await import("@/lib/split");

          // ---- Testnet path: ONE gasless kernel userop batches every leg ----
          if (isTestnet) {
            const { kernelClient } = await buildKernelClient();
            const chainId = EVM_CHAINS.arbitrumSepolia;
            // Testnet split follows the Send-to-Pool path: native ETH calls are
            // encoded in one Kernel UserOp, preserving duplicate recipients.
            const calls = buildSplitNativeCalls({ chainId, recipients });
            const userOpHash = await (kernelClient as any).sendUserOperation({
              callData: await kernelClient.account!.encodeCalls(
                calls.map((c) => ({
                  to: c.to as `0x${string}`,
                  value: BigInt(c.value),
                  data: c.data as `0x${string}`,
                })),
              ),
            });
            const receipt = await kernelClient.waitForUserOperationReceipt({
              hash: userOpHash,
            });
            const txId = receipt.receipt.transactionHash;
            awardXp(50);
            return { txId, txUrl: `${ARB_SEPOLIA.explorer}/tx/${txId}` };
          }

          // ---- Mainnet: batch every leg into ONE Universal Account tx.
          // Uses the createUniversalTransaction + expectTokens pattern from
          // the Particle reference `custom-transaction-evm-no-money.ts`, so
          // the UA sources the exact token amount from any chain the user
          // holds (native USDC on Arbitrum One by default). ----
          if (!(ua && eoa)) throw new Error("Connect a wallet first");
          const { CHAIN_ID, SUPPORTED_TOKEN_TYPE } = await loadSdk();
          const chainId = EVM_CHAINS.arbitrum;
          const TOKENS: Record<"USDC", { address: string; decimals: number; type: any }> = {
            USDC: {
              // Native (Circle) USDC on Arbitrum One
              address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
              decimals: 6,
              type: SUPPORTED_TOKEN_TYPE?.USDC,
            },
          };
          const totalAmount = recipients.reduce((s, r) => s + Number(r.amount || 0), 0);
          const transactions =
            token === "ETH"
              ? buildSplitNativeCalls({ chainId, recipients })
              : buildSplitERC20Calls({
                  chainId,
                  tokenAddress: TOKENS[token].address,
                  decimals: TOKENS[token].decimals,
                  recipients,
                });

          const createUniversal = ua.createUniversalTransaction?.bind(ua) ?? ua.createExecuteTransaction?.bind(ua);
          if (!createUniversal) {
            throw new Error("Universal Account SDK missing createUniversalTransaction");
          }
          const uaChainId = CHAIN_ID.ARBITRUM_MAINNET_ONE ?? chainId;
          const expectType = token === "ETH" ? SUPPORTED_TOKEN_TYPE?.ETH : TOKENS[token].type;
          const tx = await createUniversal({
            chainId: uaChainId,
            // Tell the UA how much of `token` to source across the user's
            // primary assets to fund every batched leg atomically.
            ...(expectType != null
              ? {
                  expectTokens: [{ type: expectType, amount: totalAmount.toString() }],
                }
              : {}),
            transactions: transactions.map((c) => ({
              to: c.to,
              data: c.data,
              value: c.value,
            })),
          });
          const provider = new ethers.BrowserProvider(window.ethereum);
          const signer = await provider.getSigner();
          const signature = await signer.signMessage(ethers.getBytes(tx.rootHash));
          const result = await ua.sendTransaction(tx, signature);
          const txId = getSubmittedTxHash(result);
          return {
            txId,
            txUrl: getTxUrl(txId, ARBITRUM_MAINNET.explorer),
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
        <div className="mb-6 rounded-xl border border-panel-border bg-panel/60 p-4 text-sm text-muted-foreground space-y-3">
          <div>
            <strong className="text-foreground">Testnet mode — Arbitrum Sepolia.</strong> Gasless UserOps via ZeroDev
            paymaster. Two signer paths:
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
              ? "Uses the EIP-7702 Kernel smart account; UserOps are sponsored, so the confirmed tx is funded by 0x4337002C... into the EntryPoint."
              : "Uses Particle Auth (social login) as the ECDSA signer for a Kernel V3.1 smart account — no MetaMask required."}
          </div>
        </div>
      )}

      {(!eoa && !isTestnet) || (isTestnet && !testnetSignedIn) ? (
        <div className="rounded-2xl border border-panel-border bg-panel/70 backdrop-blur p-10 text-center">
          <div className="mx-auto size-14 rounded-2xl bg-primary/15 flex items-center justify-center text-2xl mb-4">
            {isTestnet ? "🔐" : "🦊"}
          </div>
          <h2 className="text-xl font-medium mb-2">
            {isTestnet ? "Sign in to continue" : "Connect your wallet"}
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            {isTestnet
              ? "Pick a signing method to unlock your smart account on Arbitrum Sepolia."
              : "We'll use your EOA as the owner of a smart account."}
          </p>

          {isTestnet ? (
            <div className="flex flex-col sm:flex-row gap-3 justify-center max-w-md mx-auto">
              <button
                onClick={() => signInTestnet("zerodev-7702")}
                disabled={signingIn}
                className="flex-1 inline-flex items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
              >
                {signingIn && testnetMethod === "zerodev-7702"
                  ? "Signing in…"
                  : "Sign in with ZeroDev (EIP-7702)"}
              </button>
              <button
                onClick={() => signInTestnet("zerodev-particle")}
                disabled={signingIn}
                className="flex-1 inline-flex items-center justify-center rounded-xl border border-panel-border bg-background/60 px-5 py-3 text-sm font-medium hover:bg-background transition disabled:opacity-50"
              >
                {signingIn && testnetMethod === "zerodev-particle"
                  ? "Signing in…"
                  : "Sign in with ZeroDev + Particle"}
              </button>
            </div>
          ) : (
            <button
              onClick={connect}
              disabled={loading}
              className="inline-flex items-center justify-center rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
            >
              {loading ? "Connecting…" : "Sign in with MetaMask"}
            </button>
          )}

          {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
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
