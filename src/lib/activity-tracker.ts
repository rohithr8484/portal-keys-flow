// On-chain activity tracker (DAppActivityTracker.sol) bindings.
//
// Testnet: Arbitrum Sepolia  (421614)  0x25bbdF712ce03D6Aa1090b912A9AF06F6deBBd47
// Mainnet: Arbitrum One      (42161)   0x26cf943D673396aA29C3c3875d46e228186f8533
//
// Best-effort helper: callers fire-and-forget. Errors surface via onNotify
// but never block the local activity feed.

import { BrowserProvider, Contract } from "ethers";

export type ActivityNetwork = "mainnet" | "testnet";

type NetCfg = {
  address: string;
  chainId: number;
  chainIdHex: string;
  label: string;
  rpcUrl: string;
  explorer: string;
  nativeSymbol: string;
};

export const ACTIVITY_NETWORKS: Record<ActivityNetwork, NetCfg> = {
  testnet: {
    address: "0x25bbdF712ce03D6Aa1090b912A9AF06F6deBBd47",
    chainId: 421614,
    chainIdHex: "0x66eee",
    label: "Arbitrum Sepolia",
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    explorer: "https://sepolia.arbiscan.io",
    nativeSymbol: "ETH",
  },
  mainnet: {
    address: "0x26cf943D673396aA29C3c3875d46e228186f8533",
    chainId: 42161,
    chainIdHex: "0xa4b1",
    label: "Arbitrum One",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    explorer: "https://arbiscan.io",
    nativeSymbol: "ETH",
  },
};

const ABI = [
  "function logActivity(string,string)",
  "function getActivity(uint256) view returns(address,string,string,uint256)",
  "function getTotalActivities() view returns(uint256)",
  "function getAllActivities() view returns((address userAddress,string name,string activityType,uint256 timestamp)[])",
  "event ActivityLogged(address indexed userAddress,string name,string activityType,uint256 timestamp)",
];

declare global {
  interface Window {
    ethereum?: any;
  }
}

async function ensureChain(cfg: NetCfg) {
  const eth = window.ethereum;
  if (!eth) throw new Error("Wallet not detected");
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: cfg.chainIdHex }],
    });
  } catch (err: any) {
    if (err?.code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: cfg.chainIdHex,
            chainName: cfg.label,
            rpcUrls: [cfg.rpcUrl],
            nativeCurrency: { name: "Ether", symbol: cfg.nativeSymbol, decimals: 18 },
            blockExplorerUrls: [cfg.explorer],
          },
        ],
      });
    } else {
      throw err;
    }
  }
}

async function getContract(network: ActivityNetwork) {
  const cfg = ACTIVITY_NETWORKS[network];
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("Wallet not detected");
  }
  await ensureChain(cfg);
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  return { contract: new Contract(cfg.address, ABI, signer), cfg };
}

/** Fire-and-forget log; resolves with tx hash on success, throws on failure. */
export async function logOnchainActivity(
  network: ActivityNetwork,
  name: string,
  activityType: string,
): Promise<{ hash: string; explorerUrl: string }> {
  const { contract, cfg } = await getContract(network);
  const tx = await (contract as any).logActivity(
    name.slice(0, 120) || "unnamed",
    activityType.slice(0, 60) || "event",
  );
  await tx.wait();
  return { hash: tx.hash as string, explorerUrl: `${cfg.explorer}/tx/${tx.hash}` };
}

export async function getAllOnchainActivities(network: ActivityNetwork) {
  const { contract } = await getContract(network);
  const rows: any[] = await (contract as any).getAllActivities();
  return rows.map((r) => ({
    userAddress: r.userAddress as string,
    name: r.name as string,
    activityType: r.activityType as string,
    timestamp: Number(r.timestamp),
  }));
}

export async function getTotalOnchainActivities(network: ActivityNetwork) {
  const { contract } = await getContract(network);
  return Number(await (contract as any).getTotalActivities());
}
