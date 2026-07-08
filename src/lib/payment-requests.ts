import { supabase } from "@/integrations/supabase/client";

export type PaymentRequestRow = {
  id: string;
  recipient: string;
  amount: number;
  token: string;
  chain_id: number;
  expiry: string | null;
  status: "pending" | "paid" | "cancelled" | "expired";
  tx_hash: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
};

export type CreatePaymentRequestInput = {
  recipient: string;
  amount: number;
  token: string;
  chainId: number;
  expiryMinutes?: number;
  memo?: string;
};

export async function createPaymentRequest(
  input: CreatePaymentRequestInput,
): Promise<PaymentRequestRow> {
  const expiry =
    input.expiryMinutes && input.expiryMinutes > 0
      ? new Date(Date.now() + input.expiryMinutes * 60_000).toISOString()
      : null;

  const { data, error } = await supabase
    .from("payment_requests")
    .insert({
      recipient: input.recipient,
      amount: input.amount,
      token: input.token,
      chain_id: input.chainId,
      expiry,
      memo: input.memo ?? null,
      status: "pending",
    })
    .select()
    .single();

  if (error) throw error;
  return data as PaymentRequestRow;
}

export async function getPaymentRequest(
  id: string,
): Promise<PaymentRequestRow | null> {
  const { data, error } = await supabase
    .from("payment_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as PaymentRequestRow | null) ?? null;
}

export async function markPaymentPaid(id: string, txHash: string) {
  const { error } = await supabase
    .from("payment_requests")
    .update({ status: "paid", tx_hash: txHash, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function cancelPaymentRequest(id: string) {
  const { error } = await supabase
    .from("payment_requests")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function listRecentRequests(
  recipient: string,
  limit = 20,
): Promise<PaymentRequestRow[]> {
  const { data, error } = await supabase
    .from("payment_requests")
    .select("*")
    .eq("recipient", recipient)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as PaymentRequestRow[];
}

/** ERC20 addresses per chain for the tokens supported by the receive flow. */
export const TOKEN_ADDRESSES: Record<
  number,
  Record<string, { address: string | "native"; decimals: number }>
> = {
  // Arbitrum One
  42161: {
    ETH: { address: "native", decimals: 18 },
    USDC: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
    USDT: { address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
  },
  // Arbitrum Sepolia
  421614: {
    ETH: { address: "native", decimals: 18 },
    USDC: { address: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", decimals: 6 },
  },
};

export const CHAIN_META: Record<
  number,
  { label: string; explorer: string; rpcUrl: string; chainIdHex: string; symbol: string }
> = {
  42161: {
    label: "Arbitrum One",
    explorer: "https://arbiscan.io",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    chainIdHex: "0xa4b1",
    symbol: "ETH",
  },
  421614: {
    label: "Arbitrum Sepolia",
    explorer: "https://sepolia.arbiscan.io",
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    chainIdHex: "0x66eee",
    symbol: "ETH",
  },
};
