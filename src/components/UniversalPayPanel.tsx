import { useMemo, useState } from "react";
import { ethers } from "ethers";
import { QRCodeSVG } from "qrcode.react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  smartAccount: string | null;
  unifiedUsd: number | null;
  onNotify?: (msg: string) => void;
};

type FeatureKey =
  | "pay-split"
  | "any-token"
  | "requests"
  | "cross-chain"
  | "one-balance"
  | "qr-scan";

const FEATURES: Array<{
  key: FeatureKey;
  icon: string;
  title: string;
  desc: string;
}> = [
  {
    key: "pay-split",
    icon: "💸",
    title: "Pay & split",
    desc: "Send to a single wallet or divide a bill across many friends in one confirmation.",
  },
  {
    key: "any-token",
    icon: "🪙",
    title: "Any token",
    desc: "Settle and receive in USDC, USDT or ETH — sourced from whatever asset you already hold.",
  },
  {
    key: "requests",
    icon: "🧾",
    title: "Requests & invoices",
    desc: "Mint trackable payment requests as shareable links or scannable codes.",
  },
  {
    key: "cross-chain",
    icon: "🌉",
    title: "Cross-chain deposit",
    desc: "Fund from any network you use; balances consolidate onto Arbitrum automatically.",
  },
  {
    key: "one-balance",
    icon: "⚖️",
    title: "One balance",
    desc: "An EIP-7702 smart account turns every chain into a single spendable figure.",
  },
  {
    key: "qr-scan",
    icon: "🔳",
    title: "QR & scan",
    desc: "Show a code to collect at a counter, or scan a code to settle instantly.",
  },
];

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function UniversalPayPanel({ smartAccount, unifiedUsd, onNotify }: Props) {
  const [open, setOpen] = useState<FeatureKey | null>(null);
  const address = smartAccount ?? "";

  // Pay & split state
  const [splitRecipients, setSplitRecipients] = useState("");
  const [splitAmount, setSplitAmount] = useState("");
  const splitPreview = useMemo(() => {
    const list = splitRecipients
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => ethers.isAddress(s));
    const total = Number(splitAmount || "0");
    const each = list.length > 0 ? total / list.length : 0;
    return { list, total, each };
  }, [splitRecipients, splitAmount]);

  // Requests state
  const [reqAmount, setReqAmount] = useState("");
  const [reqAsset, setReqAsset] = useState("USDC");
  const [reqNote, setReqNote] = useState("");
  const requestLink = useMemo(() => {
    if (!address) return "";
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://app";
    const p = new URLSearchParams({
      to: address,
      amount: reqAmount || "0",
      asset: reqAsset,
    });
    if (reqNote) p.set("note", reqNote);
    return `${origin}/?pay=1&${p.toString()}`;
  }, [address, reqAmount, reqAsset, reqNote]);

  const copy = async (text: string, label = "Copied") => {
    try {
      await navigator.clipboard.writeText(text);
      onNotify?.(label);
    } catch {
      onNotify?.("Copy failed");
    }
  };

  const openFeature = (k: FeatureKey) => {
    if (!address) {
      onNotify?.("Connect a wallet first");
      return;
    }
    setOpen(k);
  };

  return (
    <section className="mb-8 rounded-2xl border border-panel-border bg-panel/70 backdrop-blur p-6">
      <div className="flex items-end justify-between mb-5 flex-wrap gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Universal Pay
          </div>
          <h2 className="text-2xl font-bold tracking-tight neon-text">
            Move value, anywhere
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Payment primitives built on the smart account you already connected.
          </p>
        </div>
        <span className="text-[11px] px-2.5 py-1 rounded-full border border-panel-border bg-background/40 text-muted-foreground">
          {address ? shortAddr(address) : "Not connected"} · Arbitrum
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {FEATURES.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => openFeature(f.key)}
            className="group text-left relative rounded-xl border border-panel-border bg-background/40 p-4 hover:border-primary/50 hover:bg-background/60 transition-colors cursor-pointer"
          >
            <div className="absolute -right-6 -top-6 size-20 rounded-full bg-primary/10 blur-2xl group-hover:bg-primary/25 transition" />
            <div className="size-9 rounded-lg bg-gradient-to-br from-primary/25 to-accent/25 flex items-center justify-center text-lg mb-3">
              {f.icon}
            </div>
            <div className="text-sm font-semibold mb-1 flex items-center justify-between">
              <span>{f.title}</span>
              <span className="text-[10px] text-primary opacity-0 group-hover:opacity-100 transition">
                Open →
              </span>
            </div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              {f.desc}
            </div>
          </button>
        ))}
      </div>

      {/* Pay & split */}
      <Dialog open={open === "pay-split"} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pay & split</DialogTitle>
            <DialogDescription>
              Paste one or more recipient addresses. The total is divided evenly.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              rows={4}
              placeholder="0xabc…, 0xdef… (comma or newline separated)"
              value={splitRecipients}
              onChange={(e) => setSplitRecipients(e.target.value)}
            />
            <div className="flex gap-2 items-center">
              <Input
                type="number"
                min="0"
                step="0.0001"
                placeholder="Total amount"
                value={splitAmount}
                onChange={(e) => setSplitAmount(e.target.value)}
              />
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                USDC
              </span>
            </div>
            <div className="text-xs text-muted-foreground border border-panel-border rounded-lg p-3 bg-background/40">
              <div>
                Valid recipients:{" "}
                <span className="text-foreground">{splitPreview.list.length}</span>
              </div>
              <div>
                Each receives:{" "}
                <span className="text-foreground">
                  {splitPreview.each.toFixed(4)} USDC
                </span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setOpen(null)}
              type="button"
            >
              Close
            </Button>
            <Button
              disabled={splitPreview.list.length === 0 || splitPreview.total <= 0}
              onClick={() => {
                onNotify?.(
                  `Prepared split of ${splitPreview.total} USDC to ${splitPreview.list.length} recipient(s)`
                );
                setOpen(null);
              }}
            >
              Prepare payout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Any token */}
      <Dialog open={open === "any-token"} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Any token, any chain</DialogTitle>
            <DialogDescription>
              Your Universal Account routes across supported assets automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-2">
            {["USDC", "USDT", "ETH"].map((t) => (
              <div
                key={t}
                className="rounded-lg border border-panel-border bg-background/40 p-3 text-center"
              >
                <div className="text-lg mb-1">🪙</div>
                <div className="text-sm font-semibold">{t}</div>
                <div className="text-[10px] text-muted-foreground">
                  spend & receive
                </div>
              </div>
            ))}
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            Pick the settlement asset when creating a request or a payment — the
            source asset is bridged for you.
          </div>
        </DialogContent>
      </Dialog>

      {/* Requests & invoices */}
      <Dialog open={open === "requests"} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Payment request</DialogTitle>
            <DialogDescription>
              Generate a shareable link and QR to collect funds into your smart
              account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="Amount"
                value={reqAmount}
                onChange={(e) => setReqAmount(e.target.value)}
              />
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={reqAsset}
                onChange={(e) => setReqAsset(e.target.value)}
              >
                <option>USDC</option>
                <option>USDT</option>
                <option>ETH</option>
              </select>
            </div>
            <Input
              placeholder="Optional memo"
              value={reqNote}
              onChange={(e) => setReqNote(e.target.value)}
            />
            {requestLink && (
              <div className="flex gap-3 items-start">
                <div className="rounded-lg bg-white p-2">
                  <QRCodeSVG value={requestLink} size={112} />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="text-[11px] break-all text-muted-foreground bg-background/40 border border-panel-border rounded p-2 font-mono">
                    {requestLink}
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => copy(requestLink, "Link copied")}
                  >
                    Copy link
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Cross-chain deposit */}
      <Dialog
        open={open === "cross-chain"}
        onOpenChange={(v) => !v && setOpen(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cross-chain deposit</DialogTitle>
            <DialogDescription>
              Send from any chain you use — funds consolidate on Arbitrum
              automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
              {["Ethereum", "Base", "Optimism", "Polygon"].map((c) => (
                <div
                  key={c}
                  className="rounded-md border border-panel-border bg-background/40 py-2"
                >
                  {c}
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-panel-border bg-background/40 p-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                Deposit address
              </div>
              <div className="font-mono text-xs break-all">{address}</div>
              <Button
                size="sm"
                variant="secondary"
                className="mt-2"
                onClick={() => copy(address, "Address copied")}
              >
                Copy address
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* One balance */}
      <Dialog
        open={open === "one-balance"}
        onOpenChange={(v) => !v && setOpen(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unified balance</DialogTitle>
            <DialogDescription>
              Every network you hold assets on, expressed as a single figure.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-panel-border bg-background/40 p-6 text-center">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Spendable
            </div>
            <div className="text-4xl font-bold neon-text mt-1">
              ${(unifiedUsd ?? 0).toFixed(2)}
            </div>
            <div className="text-xs text-muted-foreground mt-2">
              Powered by the EIP-7702 smart account
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* QR & scan */}
      <Dialog open={open === "qr-scan"} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Receive by QR</DialogTitle>
            <DialogDescription>
              Show this code to collect a payment into your smart account.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-xl bg-white p-3">
              <QRCodeSVG value={address} size={192} />
            </div>
            <div className="font-mono text-xs break-all text-center max-w-full">
              {address}
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => copy(address, "Address copied")}
            >
              Copy address
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
