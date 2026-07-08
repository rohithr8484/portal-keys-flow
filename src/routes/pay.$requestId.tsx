import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

declare global {
  interface Window {
    ethereum?: any;
  }
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

  const connect = async () => {
    if (!window.ethereum) {
      setError("No wallet detected. Install MetaMask or a compatible wallet.");
      return;
    }
    try {
      const accounts: string[] = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      setWallet(accounts[0] ?? null);
    } catch (e: any) {
      setError(e?.message ?? "Wallet connect failed");
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
      setStatus("Awaiting signature…");
      let hash: string;
      if (tokenInfo.address === "native") {
        const tx = await signer.sendTransaction({
          to: request.recipient,
          value: ethers.parseUnits(String(request.amount), tokenInfo.decimals),
        });
        setStatus("Broadcasting…");
        setTxHash(tx.hash);
        await tx.wait();
        hash = tx.hash;
      } else {
        const contract = new ethers.Contract(tokenInfo.address, ERC20_ABI, signer);
        const tx = await contract.transfer(
          request.recipient,
          ethers.parseUnits(String(request.amount), tokenInfo.decimals),
        );
        setStatus("Broadcasting…");
        setTxHash(tx.hash);
        await tx.wait();
        hash = tx.hash;
      }
      setStatus("Confirming…");
      await markPaymentPaid(request.id, hash);
      setRequest({ ...request, status: "paid", tx_hash: hash });
      setStatus("Payment confirmed");
      router.invalidate();
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? "Payment failed");
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
            {request.amount} <span className="text-lg align-middle">{request.token}</span>
          </div>
          {request.memo && (
            <div className="text-sm text-muted-foreground mt-1">{request.memo}</div>
          )}
        </div>

        <div className="rounded-lg border border-panel-border bg-background/40 p-3 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Recipient</span>
            <span className="font-mono">{request.recipient}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Network</span>
            <span>{chain?.label ?? `chain ${request.chain_id}`}</span>
          </div>
          {request.expiry && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Expires</span>
              <span>{new Date(request.expiry).toLocaleString()}</span>
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
            <Button className="w-full" onClick={pay} disabled={disabled}>
              {busy
                ? status ?? "Working…"
                : wallet
                  ? `Pay ${request.amount} ${request.token}`
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
