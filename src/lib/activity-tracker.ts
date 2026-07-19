// On-chain activity tracker bindings.
// Contracts implement DAppActivityTracker (logActivity/getAllActivities).
// Testnet:  Arbitrum Sepolia (421614)
// Mainnet:  Arbitrum One      (42161)
//
// We deliberately AVOID using ethers' Contract.send here. On Arbitrum Sepolia
// some wallets (e.g. MetaMask smart-account / EIP-7702 delegated accounts)
// route calls through a UserOp simulator that fails opaquely with
// "Interaction failed" when ethers' gas estimation trips. Encoding the call
// ourselves + a raw eth_sendTransaction with an explicit gas ceiling and a
// preflight eth_call gives us both a stable path and a readable revert reason.

import { Interface, isAddress } from "ethers";

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

const IFACE = new Interface([
  "function logActivity(string,string)",
  "function getTotalActivities() view returns(uint256)",
]);

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

async function rpcCall(rpcUrl: string, method: string, params: unknown[]): Promise<any> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const json = await res.json();
  if (json.error) {
    const msg = json.error?.message || "RPC error";
    throw new Error(msg);
  }
  return json.result;
}

export async function storeActivityOnChain(
  network: TrackerNetwork,
  name: string,
  activityType: string,
): Promise<{ hash: string; explorer: string }> {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("No wallet detected. Install MetaMask.");
  const cfg = TRACKERS[network];

  const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
  const from = accounts?.[0];
  if (!from || !isAddress(from)) throw new Error("Could not read wallet account.");

  await ensureChain(cfg);

  const safeName = (name || "activity").slice(0, 120);
  const safeType = (activityType || "unknown").slice(0, 60);
  const data = IFACE.encodeFunctionData("logActivity", [safeName, safeType]);

  // Preflight simulate against the public RPC so we surface real revert
  // reasons instead of the wallet's generic "Interaction failed".
  try {
    await rpcCall(cfg.rpcUrl, "eth_call", [
      { from, to: cfg.address, data },
      "latest",
    ]);
  } catch (err: any) {
    const raw = String(err?.message ?? err ?? "");
    throw new Error(
      `Simulation reverted on ${cfg.chainName}. The contract rejected logActivity. ${raw}`.trim(),
    );
  }

  // Estimate gas via public RPC; fall back to a safe ceiling if it fails.
  let gasHex = "0x186a0"; // 100_000 fallback
  try {
    const est: string = await rpcCall(cfg.rpcUrl, "eth_estimateGas", [
      { from, to: cfg.address, data },
    ]);
    // pad 40% to survive wallet re-simulation variance
    const padded = (BigInt(est) * 140n) / 100n;
    gasHex = "0x" + padded.toString(16);
  } catch {
    // keep fallback
  }

  const txParams: Record<string, string> = {
    from,
    to: cfg.address,
    data,
    gas: gasHex,
    value: "0x0",
  };

  let hash: string;
  try {
    hash = await eth.request({
      method: "eth_sendTransaction",
      params: [txParams],
    });
  } catch (err: any) {
    const msg = err?.data?.message ?? err?.message ?? "Wallet rejected the transaction.";
    throw new Error(msg);
  }
  return { hash: String(hash), explorer: `${cfg.explorer}/tx/${hash}` };
}
