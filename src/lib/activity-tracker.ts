// On-chain activity tracker bindings.
// Contracts implement DAppActivityTracker (logActivity/getAllActivities).
// Testnet:  Arbitrum Sepolia (421614)
// Mainnet:  Arbitrum One      (42161)

import { BrowserProvider, Contract } from "ethers";

export type TrackerNetwork = "mainnet" | "testnet";

type TrackerConfig = {
  address: `0x${string}`;
  chainId: number;
  chainIdHex: string;
  chainName: string;
  rpcUrl: string;
  explorer: string;
};

export const TRACKERS: Record<TrackerNetwork, TrackerConfig> = {
  testnet: {
    address: "0x25bbdF712ce03D6Aa1090b912A9AF06F6deBBd47",
    chainId: 421614,
    chainIdHex: "0x66eee",
    chainName: "Arbitrum Sepolia",
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    explorer: "https://sepolia.arbiscan.io",
  },
  mainnet: {
    address: "0x26cf943D673396aA29C3c3875d46e228186f8533",
    chainId: 42161,
    chainIdHex: "0xa4b1",
    chainName: "Arbitrum One",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    explorer: "https://arbiscan.io",
  },
};

const ABI = [
  "function logActivity(string,string)",
  "function getActivity(uint256) view returns(address,string,string,uint256)",
  "function getTotalActivities() view returns(uint256)",
  "event ActivityLogged(address indexed userAddress,string name,string activityType,uint256 timestamp)",
];

async function ensureChain(cfg: TrackerConfig) {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("No wallet detected. Install MetaMask.");
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
            chainName: cfg.chainName,
            rpcUrls: [cfg.rpcUrl],
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            blockExplorerUrls: [cfg.explorer],
          },
        ],
      });
    } else {
      throw err;
    }
  }
}

export async function storeActivityOnChain(
  network: TrackerNetwork,
  name: string,
  activityType: string,
): Promise<{ hash: string; explorer: string }> {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("No wallet detected. Install MetaMask.");
  const cfg = TRACKERS[network];
  await eth.request({ method: "eth_requestAccounts" });
  await ensureChain(cfg);
  const provider = new BrowserProvider(eth);
  const signer = await provider.getSigner();
  const contract = new Contract(cfg.address, ABI, signer);
  const safeName = (name || "activity").slice(0, 120);
  const safeType = (activityType || "unknown").slice(0, 60);
  const tx = await contract.logActivity(safeName, safeType);
  await tx.wait();
  return { hash: tx.hash as string, explorer: `${cfg.explorer}/tx/${tx.hash}` };
}
