import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { amountForTokenUnits, formatDisplayAmount } from "@/lib/amounts";
import {
  getPaymentRequest,
  markPaymentPaid,
  TOKEN_ADDRESSES,
  CHAIN_META,
  type PaymentRequestRow,
} from "@/lib/payment-requests";

export const Route = createFileRoute("/pay/$requestId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Pay · Universal Account" },
      { name: "description", content: "Complete a payment request." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PayRequestPage,
  errorComponent: ({ error }: { error: Error }) => (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-2">
        <h1 className="text-xl font-semibold">Couldn't load payment request</h1>
        <p className="text-sm text-muted-foreground">{error.message}</p>
      </div>
    </div>
  ),
  notFoundComponent: () => (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-2">
        <h1 className="text-xl font-semibold">Payment request not found</h1>
        <p className="text-sm text-muted-foreground">This link may have expired.</p>
      </div>
    </div>
  ),
});

const ERC20_IFACE = new ethers.Interface([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);

declare global {
  interface Window {
    ethereum?: any;
  }
}

function formatTokenUnits(value: bigint, decimals: number): string {
  return formatDisplayAmount(ethers.formatUnits(value, decimals));
}

async function readErc20Balance(tokenAddress: string, account: string): Promise<bigint> {
  const data = ERC20_IFACE.encodeFunctionData("balanceOf", [account]);
  const result = await window.ethereum.request({
    method: "eth_call",
    params: [{ to: tokenAddress, data }, "latest"],
  });
  const decoded = ERC20_IFACE.decodeFunctionResult("balanceOf", result);
  const balance = decoded[0];
  return typeof balance === "bigint" ? balance : BigInt(balance.toString());
}

async function sendInjectedWalletTransaction(tx: {
  from: string;
  to: string;
  value?: string;
  data?: string;
}): Promise<string> {
  const hash = await window.ethereum.request({
    method: "eth_sendTransaction",
    params: [tx],
  });
  return String(hash);
}

function collectErrorMessages(value: unknown, out: string[] = [], seen = new Set<object>()): string[] {
  if (!value) return out;
  if (typeof value === "string") {
    out.push(value);
    if ((value.startsWith("{") && value.endsWith("}")) || (value.startsWith("[") && value.endsWith("]"))) {
      try {
        collectErrorMessages(JSON.parse(value), out, seen);
      } catch {}
    }
    return out;
  }
  if (typeof value !== "object") return out;
  if (seen.has(value)) return out;
  seen.add(value);
  const record = value as Record<string, unknown>;
  for (const key of ["shortMessage", "reason", "message", "data", "error", "info", "body", "cause"]) {
    collectErrorMessages(record[key], out, seen);
  }
  return out;
}

function walletErrorMessage(error: unknown, token: string, chainLabel: string): string {
  const messages = collectErrorMessages(error);
  const readable = messages.find((msg) => /transfer amount exceeds balance/i.test(msg))
    ?? messages.find((msg) => /insufficient funds|insufficient balance/i.test(msg))
    ?? messages.find((msg) => !/could not coalesce error/i.test(msg));

  if (readable && /transfer amount exceeds balance/i.test(readable)) {
    return `Connected wallet does not have enough ${token} on ${chainLabel}. Switch to the funded account or add ${token}, then try again.`;
  }
  if (readable && /insufficient funds|insufficient balance/i.test(readable)) {
    return `Connected wallet does not have enough funds on ${chainLabel}. Add funds or switch accounts, then try again.`;
  }
  if (readable) return readable;
  return "Wallet returned an unreadable RPC error. Please reconnect the funded wallet and try again.";
}

function PayRequestPage() {
  const { requestId } = Route.useParams();
  const router = useRouter();
  const [request, setRequest] = useState<PaymentRequestRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await getPaymentRequest(requestId);
        if (cancelled) return;
        if (!r) setNotFound(true);
        else setRequest(r);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  const chain = request ? CHAIN_META[request.chain_id] : undefined;
  const tokenInfo = useMemo(() => {
    if (!request) return null;
    const chainTokens = TOKEN_ADDRESSES[request.chain_id];
    return chainTokens?.[request.token] ?? null;
  }, [request]);

  const expired = useMemo(() => {
    if (!request?.expiry) return false;
    return new Date(request.expiry).getTime() < Date.now();
  }, [request]);

  const displayAmount = useMemo(() => {
    if (!request) return "0";
    return formatDisplayAmount(request.amount);
  }, [request]);

  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum?.on) return;
    const onAccountsChanged = (accounts: string[]) => {
      setWallet(accounts[0] ? ethers.getAddress(accounts[0]) : null);
      setError(null);
      setStatus(accounts[0] ? "Wallet connected. Review payment, then tap Pay." : null);
    };
    ethereum.on("accountsChanged", onAccountsChanged);
    return () => {
      ethereum.removeListener?.("accountsChanged", onAccountsChanged);
    };
  }, []);

  const connect = async (): Promise<string | null> => {
    setError(null);
    setStatus("Connecting wallet…");
    if (!window.ethereum) {
      // Mobile browsers without an injected provider: hand off to the
      // MetaMask (or compatible) mobile app via its deeplink. The app opens
      // this page inside its in-app browser where window.ethereum exists.
      const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
      const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
      if (isMobile && typeof window !== "undefined") {
        const host = window.location.host;
        const path = window.location.pathname + window.location.search;
        window.location.href = `https://metamask.app.link/dapp/${host}${path}`;
        return null;
      }
      setError(
        "No wallet detected. Open this link inside your MetaMask mobile app browser, or install a wallet extension.",
      );
      setStatus(null);
      return null;
    }
    try {
      const accounts: string[] = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      const account = accounts[0] ? ethers.getAddress(accounts[0]) : null;
      setWallet(account);
      setStatus(account ? "Wallet connected. Review payment, then tap Pay." : null);
      return account;
    } catch (e: any) {
      setError(e?.message ?? "Wallet connect failed");
      setStatus(null);
      return null;
    }
  };

  const ensureChain = async () => {
    if (!chain || !window.ethereum) throw new Error("Wallet not ready");
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chain.chainIdHex }],
      });
    } catch (err: any) {
      if (err?.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: chain.chainIdHex,
              chainName: chain.label,
              rpcUrls: [chain.rpcUrl],
              nativeCurrency: { name: "Ether", symbol: chain.symbol, decimals: 18 },
              blockExplorerUrls: [chain.explorer],
            },
          ],
        });
      } else {
        throw err;
      }
    }
  };

  const pay = async () => {
    if (!request || !tokenInfo || !chain) return;
    if (!wallet) {
      await connect();
      return;
    }
    setBusy(true);
    setError(null);
    setStatus("Switching network…");
    try {
      await ensureChain();
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const payer = ethers.getAddress(await signer.getAddress());
      setWallet(payer);
      setStatus("Awaiting signature…");
      let hash: string;
      const amountInUnits = amountForTokenUnits(request.amount, tokenInfo.decimals);
      const amountWei = ethers.parseUnits(amountInUnits, tokenInfo.decimals);
      const recipient = ethers.getAddress(request.recipient);
      if (tokenInfo.address === "native") {
        const nativeBalance = await provider.getBalance(payer);
        if (nativeBalance < amountWei) {
          throw new Error(
            `Connected wallet has ${formatTokenUnits(nativeBalance, tokenInfo.decimals)} ${request.token} on ${chain.label}. Request needs ${displayAmount} ${request.token}.`,
          );
        }
        const txHash = await sendInjectedWalletTransaction({
          from: payer,
          to: recipient,
          value: ethers.toQuantity(amountWei),
        });
        setStatus("Broadcasting…");
        setTxHash(txHash);
        await provider.waitForTransaction(txHash);
        hash = txHash;
      } else {
        const tokenBalance = await readErc20Balance(tokenInfo.address, payer);
        if (tokenBalance < amountWei) {
          throw new Error(
            `Connected wallet has ${formatTokenUnits(tokenBalance, tokenInfo.decimals)} ${request.token} on ${chain.label}. Request needs ${displayAmount} ${request.token}. Switch to the funded account or add ${request.token}, then try again.`,
          );
        }
        // Use the injected wallet RPC directly for ERC-20 sends. This avoids
        // ethers v6 wrapping wallet/RPC failures as "could not coalesce error"
        // and lets MetaMask own gas estimation/signing after our balance check.
        const data = ERC20_IFACE.encodeFunctionData("transfer", [
          recipient,
          amountWei,
        ]);
        const txHash = await sendInjectedWalletTransaction({
          from: payer,
          to: tokenInfo.address,
          data,
        });
        setStatus("Broadcasting…");
        setTxHash(txHash);
        await provider.waitForTransaction(txHash);
        hash = txHash;
      }
      setStatus("Confirming…");
      await markPaymentPaid(request.id, hash);
      setRequest({ ...request, status: "paid", tx_hash: hash });
      setStatus("Payment confirmed");
      router.invalidate();
    } catch (e: any) {
      setError(walletErrorMessage(e, request.token, chain.label));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-sm text-muted-foreground">
        Loading payment request…
      </div>
    );
  }

  if (notFound || !request) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-2">
          <h1 className="text-xl font-semibold">Payment request not found</h1>
          <p className="text-sm text-muted-foreground">This link may have expired.</p>
        </div>
      </div>
    );
  }

  const alreadyPaid = request.status === "paid";
  const cancelled = request.status === "cancelled";
  const disabled = busy || alreadyPaid || cancelled || expired || !tokenInfo;

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border border-panel-border bg-panel/70 backdrop-blur p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Payment request
          </div>
          <Badge variant={alreadyPaid ? "default" : "secondary"}>{request.status}</Badge>
        </div>

        <div className="text-center">
          <div className="text-4xl font-bold neon-text">
            {displayAmount} <span className="text-lg align-middle">{request.token}</span>
          </div>
          {request.memo && (
            <div className="text-sm text-muted-foreground mt-1">{request.memo}</div>
          )}
        </div>

        <div className="rounded-lg border border-panel-border bg-background/40 p-3 text-xs space-y-2">
          <div className="grid grid-cols-[5.5rem_1fr] gap-3 items-start">
            <span className="text-muted-foreground">Recipient</span>
            <span className="font-mono text-right break-all leading-relaxed">
              {request.recipient}
            </span>
          </div>
          <div className="grid grid-cols-[5.5rem_1fr] gap-3 items-start">
            <span className="text-muted-foreground">Network</span>
            <span className="text-right">{chain?.label ?? `chain ${request.chain_id}`}</span>
          </div>
          {request.expiry && (
            <div className="grid grid-cols-[5.5rem_1fr] gap-3 items-start">
              <span className="text-muted-foreground">Expires</span>
              <span className="text-right">{new Date(request.expiry).toLocaleString()}</span>
            </div>
          )}
        </div>

        {!tokenInfo && (
          <div className="text-xs text-destructive">
            Token {request.token} isn't supported on this network.
          </div>
        )}

        {alreadyPaid && request.tx_hash && chain && (
          <a
            href={`${chain.explorer}/tx/${request.tx_hash}`}
            target="_blank"
            rel="noreferrer"
            className="block text-center text-xs text-primary hover:underline break-all"
          >
            View transaction ↗
          </a>
        )}

        {expired && !alreadyPaid && (
          <div className="text-xs text-destructive text-center">
            This request has expired.
          </div>
        )}

        {!alreadyPaid && !cancelled && !expired && (
          <>
            {wallet ? (
              <div className="text-xs text-muted-foreground text-center">
                Paying from {wallet.slice(0, 6)}…{wallet.slice(-4)}
              </div>
            ) : null}
            <Button className="w-full" onClick={wallet ? pay : connect} disabled={disabled}>
              {busy
                ? status ?? "Working…"
                : wallet
                  ? `Pay ${displayAmount} ${request.token}`
                  : "Connect wallet"}
            </Button>
          </>
        )}

        {txHash && chain && (
          <div className="text-[11px] text-center break-all">
            <a
              href={`${chain.explorer}/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline font-mono"
            >
              {txHash}
            </a>
          </div>
        )}

        {status && !error && (
          <div className="text-xs text-center text-muted-foreground">{status}</div>
        )}
        {error && <div className="text-xs text-center text-destructive">{error}</div>}
      </div>
    </main>
  );
}
