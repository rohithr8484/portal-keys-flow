/**
 * SSR-safe batched split payment call builders.
 *
 * These helpers only depend on `ethers` for ABI encoding — no Particle SDK
 * imports — so they can be evaluated during server rendering or unit tests.
 *
 * The returned shape matches the `EvmCall` structure the existing Aave
 * helpers hand to `ua.createExecuteTransaction({ transactions })` /
 * `ua.createUniversalTransaction({ transactions })`.
 */
import { ethers } from "ethers";
import { decimalAmountToUnits } from "@/lib/amounts";

export type EvmCall = {
  to: string;
  data: string;
  value: string; // hex string, "0x0" when zero
};

export type SplitRecipient = {
  address: string;
  /** Human-readable amount, e.g. "1.25". */
  amount: string | number;
};

/** Supported mainnet + testnet EVM chain ids. Extend as needed. */
export const EVM_CHAINS = {
  ethereum: 1,
  optimism: 10,
  bnb: 56,
  polygon: 137,
  base: 8453,
  arbitrum: 42161,
  avalanche: 43114,
  // Testnets
  sepolia: 11155111,
  optimismSepolia: 11155420,
  bnbTestnet: 97,
  polygonAmoy: 80002,
  baseSepolia: 84532,
  arbitrumSepolia: 421614,
  avalancheFuji: 43113,
} as const;

const ERC20_IFACE = new ethers.Interface([
  "function transfer(address to, uint256 amount)",
]);

function toHexValue(v: bigint): string {
  return v === 0n ? "0x0" : "0x" + v.toString(16);
}

function assertAddress(a: string): string {
  if (!ethers.isAddress(a)) throw new Error(`Invalid EVM address: ${a}`);
  return ethers.getAddress(a);
}

function assertChain(chainId: number): number {
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(`Invalid chainId: ${chainId}`);
  }
  return chainId;
}

/**
 * Build batched native (ETH / MATIC / BNB / AVAX / …) split calls.
 * One `{to,data,value}` per recipient — atomic when sent through a
 * Universal Account execute transaction.
 */
export function buildSplitNativeCalls(params: {
  chainId: number;
  recipients: SplitRecipient[];
  /** Decimals of the chain's native token. Defaults to 18. */
  decimals?: number;
}): EvmCall[] {
  assertChain(params.chainId);
  const decimals = params.decimals ?? 18;
  if (!params.recipients?.length) throw new Error("No recipients");

  return params.recipients.map((r) => {
    const value = decimalAmountToUnits(r.amount, decimals, "ETH");
    return {
      to: assertAddress(r.address),
      data: "0x",
      value: toHexValue(value),
    };
  });
}

/**
 * Build batched ERC-20 split calls (USDC / USDT / DAI / …).
 * Each call targets the token contract with an encoded `transfer(to,amount)`.
 */
export function buildSplitERC20Calls(params: {
  chainId: number;
  tokenAddress: string;
  decimals: number;
  recipients: SplitRecipient[];
}): EvmCall[] {
  assertChain(params.chainId);
  const token = assertAddress(params.tokenAddress);
  if (!params.recipients?.length) throw new Error("No recipients");

  return params.recipients.map((r) => {
    const amount = decimalAmountToUnits(r.amount, params.decimals, "USDC");
    const data = ERC20_IFACE.encodeFunctionData("transfer", [
      assertAddress(r.address),
      amount,
    ]);
    return { to: token, data, value: "0x0" };
  });
}

