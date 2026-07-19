import { useEffect, useMemo, useRef, useState } from "react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { amountForTokenUnits, decimalAmountToUnits, formatDisplayAmount, splitDecimalAmountEvenly } from "@/lib/amounts";
import {
  createPaymentRequest,
  listRecentRequests,
  cancelPaymentRequest,
  CHAIN_META,
  type PaymentRequestRow,
} from "@/lib/payment-requests";

type Props = {
  smartAccount: string | null;
  unifiedUsd: number | null;
  /** Which contract to write to when "Store on-chain" is clicked. */
  network?: "mainnet" | "testnet";
  onNotify?: (msg: string) => void;
  /** Single-recipient transfer through the Universal Account. */
  onPay?: (args: {
    recipient: string;
    amount: string;
    token: "USDC" | "ETH";
    memo?: string;
  }) => Promise<{ txId?: string; txUrl?: string } | void>;
  /**
   * Batched split — every recipient settles atomically in ONE Universal
   * Account transaction requiring ONE signature.
   */
  onSplitPay?: (args: {
    recipients: { address: string; amount: string }[];
    token: "USDC" | "ETH";
    memo?: string;
  }) => Promise<{ txId?: string; txUrl?: string } | void>;
};

const SETTLEMENT_TOKENS = ["USDC", "ETH"] as const;
type Token = (typeof SETTLEMENT_TOKENS)[number];
const TOKEN_DECIMALS: Record<Token, number> = { USDC: 6, ETH: 18 };

// ---- Persistence helpers ----
function usePersist<T>(key: string, initial: T) {
  const [state, setState] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {}
  }, [key, state]);
  return [state, setState] as const;
}

type Contact = { name: string; address: string };
type Activity = {
  id: string;
  kind: "pay" | "receive" | "request";
  label: string;
  amount: string | number;
  token: Token;
  at: number;
  hash?: string;
  txUrl?: string;
};

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function shortHash(hash: string) {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

const FEATURES = [
  { key: "pay", icon: "💸", title: "Pay & split", desc: "Send to one wallet or divide a bill across many in a single tap." },
  { key: "receive", icon: "📥", title: "Receive", desc: "Generate a QR + shareable link to get paid on Arbitrum One or Sepolia." },
  { key: "hotels", icon: "🧳", title: "Tourist packages", desc: "Book curated India tours — pay in USDC or ETH from your wallet." },
  { key: "token", icon: "🪙", title: "Any token", desc: "Pay or get paid in USDC or ETH — auto-sourced from your assets." },
  { key: "contacts", icon: "⭐", title: "Contacts", desc: "Save payees once and send to them by name, not a 0x address." },
  { key: "faq", icon: "❓", title: "FAQ", desc: "How Paygrid works — fees, chains, and settlement." },
] as const;

type FeatureKey = (typeof FEATURES)[number]["key"];

export function UniversalPayPanel({ smartAccount, unifiedUsd, network, onNotify, onPay, onSplitPay }: Props) {
  const address = smartAccount ?? "";
  const activeNetwork: "mainnet" | "testnet" = network ?? "mainnet";
  const [tab, setTab] = useState<FeatureKey>("pay");
  const [storingId, setStoringId] = useState<string | null>(null);
  const [storedMap, setStoredMap] = usePersist<Record<string, { hash: string; explorer: string; network: "mainnet" | "testnet" }>>("up_stored_activity", {});

  const [contacts, setContacts] = usePersist<Contact[]>("up_contacts", []);
  
  const [activity, setActivity] = usePersist<Activity[]>("up_activity", []);

  const [contactOpen, setContactOpen] = useState(false);

  const pushActivity = (a: Omit<Activity, "id" | "at">) =>
    setActivity((prev) =>
      [{ ...a, id: crypto.randomUUID(), at: Date.now() }, ...prev].slice(0, 30),
    );

  const storeActivity = async (entry: Activity) => {
    setStoringId(entry.id);
    try {
      const { storeActivityOnChain, TRACKERS } = await import("@/lib/activity-tracker");
      const name = entry.label?.trim() || `${entry.kind} ${entry.amount} ${entry.token}`;
      const activityType = `${entry.kind}:${entry.token}`;
      const cfg = TRACKERS[activeNetwork];
      onNotify?.(`Storing on ${cfg.chainName}…`);
      const receipt = await storeActivityOnChain(activeNetwork, name, activityType);
      setStoredMap((prev) => ({
        ...prev,
        [entry.id]: { hash: receipt.hash, explorer: receipt.explorer, network: activeNetwork },
      }));
      onNotify?.(`Stored on-chain on ${cfg.chainName}.`);
    } catch (e: any) {
      onNotify?.(e?.shortMessage ?? e?.message ?? "Failed to store on-chain");
    } finally {
      setStoringId(null);
    }
  };

  const requireAddress = () => {
    if (!address) {
      onNotify?.("Connect a wallet first");
      return false;
    }
    return true;
  };

  // ---------- Pay & Split state ----------
  const [payToken, setPayToken] = useState<Token>("USDC");
  const [payName, setPayName] = useState("");
  const [payRecipients, setPayRecipients] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [paySplit, setPaySplit] = useState(true);
  const payPreview = useMemo(() => {
    const list = payRecipients
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const valid = list.filter((s) => ethers.isAddress(s));
    const decimals = TOKEN_DECIMALS[payToken];
    const amountText = payAmount.trim();
    let amounts: string[] = [];
    let error: string | null = null;
    let hasPositiveAmount = false;

    try {
      if (amountText) {
        hasPositiveAmount = decimalAmountToUnits(amountText, decimals, payToken) > 0n;
        if (valid.length) {
          amounts = paySplit
            ? splitDecimalAmountEvenly(amountText, valid.length, decimals, payToken)
            : valid.map(() => amountForTokenUnits(amountText, decimals));
        }
      }
    } catch (e: any) {
      error = e?.message ?? "Invalid amount";
    }

    return {
      list,
      valid,
      hasPositiveAmount,
      amounts,
      error,
      eachLabel: amounts[0] ? formatDisplayAmount(amounts[0]) : "0",
      totalLabel: amountText ? formatDisplayAmount(amountText) : "0",
    };
  }, [payRecipients, payAmount, paySplit, payToken]);

  const [payBusy, setPayBusy] = useState(false);
  const submitPay = async () => {
    if (!requireAddress()) return;
    if (payPreview.valid.length === 0 || !payPreview.hasPositiveAmount) {
      onNotify?.("Add a valid recipient and amount");
      return;
    }
    if (payPreview.error) {
      onNotify?.(payPreview.error);
      return;
    }

    // Batched split: one signature, one Universal Account tx.
    if (paySplit && payPreview.valid.length > 1 && onSplitPay) {
      setPayBusy(true);
      try {
        onNotify?.(
          `Batching ${payPreview.valid.length} transfers of ${payPreview.eachLabel} ${payToken}…`,
        );
        const res = await onSplitPay({
          recipients: payPreview.valid.map((address, index) => ({
            address,
            amount: payPreview.amounts[index],
          })),
          token: payToken,
        });
        pushActivity({
          kind: "pay",
          label: payName.trim()
            ? `${payName.trim()} · split × ${payPreview.valid.length}`
            : `Split × ${payPreview.valid.length} in one tx`,
          amount: payPreview.totalLabel,
          token: payToken,
          hash: res?.txId,
          txUrl: res?.txUrl,
        });
        onNotify?.(
          res?.txId
            ? `Batched split confirmed — tx ${res.txId}${res.txUrl ? ` ${res.txUrl}` : ""}`
            : "Batched split settled in one Universal Account transaction",
        );
        setPayAmount("");
        setPayRecipients("");
      } catch (e: any) {
        onNotify?.(e?.message ?? "Batched split failed");
      } finally {
        setPayBusy(false);
      }
      return;
    }

    if (onPay) {
      setPayBusy(true);
      try {
        for (const [index, to] of payPreview.valid.entries()) {
          const amount = payPreview.amounts[index];
          onNotify?.(`Signing transfer of ${formatDisplayAmount(amount)} ${payToken} → ${shortAddr(to)}…`);
          const res = await onPay({ recipient: to, amount, token: payToken });
          pushActivity({
            kind: "pay",
            label: payName.trim()
              ? `${payName.trim()} · ${shortAddr(to)}`
              : `Sent to ${shortAddr(to)}`,
            amount,
            token: payToken,
            hash: res?.txId,
            txUrl: res?.txUrl,
          });
        }
        onNotify?.("Payment broadcast via Universal Account");
        setPayAmount("");
        setPayRecipients("");
      } catch (e: any) {
        onNotify?.(e?.message ?? "Transfer failed");
      } finally {
        setPayBusy(false);
      }
      return;
    }

    // Fallback: log locally when no on-chain handler wired.
    pushActivity({
      kind: "pay",
      label: paySplit
        ? `Split to ${payPreview.valid.length} recipients`
        : `Sent to ${shortAddr(payPreview.valid[0])}`,
      amount: payPreview.totalLabel,
      token: payToken,
    });
    setPayAmount("");
    setPayRecipients("");
    onNotify?.("Payment queued");
  };

  // ---------- Requests state (removed) ----------


  // ---------- Contacts state ----------
  const [cName, setCName] = useState("");
  const [cAddr, setCAddr] = useState("");
  const addContact = () => {
    if (!cName.trim() || !ethers.isAddress(cAddr)) {
      onNotify?.("Name and valid 0x address required");
      return;
    }
    setContacts((prev) => [...prev, { name: cName.trim(), address: cAddr }]);
    setCName("");
    setCAddr("");
    onNotify?.("Contact saved");
  };
  const removeContact = (addr: string) =>
    setContacts((prev) => prev.filter((c) => c.address !== addr));
  const pickContact = (c: Contact) => {
    setPayRecipients((prev) => (prev ? `${prev}, ${c.address}` : c.address));
    setContactOpen(false);
    setTab("pay");
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
        <div className="flex items-center gap-2">
          <span className="text-[11px] px-2.5 py-1 rounded-full border border-panel-border bg-background/40 text-muted-foreground">
            Balance ${(unifiedUsd ?? 0).toFixed(2)}
          </span>
          <span className="text-[11px] px-2.5 py-1 rounded-full border border-panel-border bg-background/40 text-muted-foreground">
            {address ? shortAddr(address) : "Not connected"}
          </span>
        </div>
      </div>

      {/* Feature strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-5">
        {FEATURES.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setTab(f.key)}
            className={`text-left rounded-xl border p-3 transition-colors cursor-pointer ${
              tab === f.key
                ? "border-primary/60 bg-primary/10"
                : "border-panel-border bg-background/40 hover:border-primary/40"
            }`}
          >
            <div className="text-lg mb-1">{f.icon}</div>
            <div className="text-xs font-semibold">{f.title}</div>
            <div className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">
              {f.desc}
            </div>
          </button>
        ))}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as FeatureKey)}>
        <TabsList className="hidden">
          {FEATURES.map((f) => (
            <TabsTrigger key={f.key} value={f.key}>
              {f.title}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* PAY */}
        <TabsContent value="pay" className="mt-0">
          <div className="grid md:grid-cols-3 gap-4">
            <div className="md:col-span-2 rounded-xl border border-panel-border bg-background/40 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Pay or split</div>
                <div className="flex items-center gap-2 text-xs">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={paySplit}
                      onChange={(e) => setPaySplit(e.target.checked)}
                    />
                    Split evenly
                  </label>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setContactOpen(true)}
                    type="button"
                  >
                    From contacts
                  </Button>
                </div>
              </div>
              <Input
                placeholder="Name (e.g. Team dinner, Alice, Rent March)"
                value={payName}
                onChange={(e) => setPayName(e.target.value)}
              />
              <Textarea
                rows={3}
                placeholder="0xabc…, 0xdef… (comma or newline separated)"
                value={payRecipients}
                onChange={(e) => setPayRecipients(e.target.value)}
              />
              <div className="flex gap-2 items-center">
                <Input
                  type="number"
                  min="0"
                  step="0.0001"
                  placeholder={paySplit ? "Total amount" : "Amount each"}
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                />
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={payToken}
                  onChange={(e) => setPayToken(e.target.value as Token)}
                >
                  {SETTLEMENT_TOKENS.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="text-xs text-muted-foreground border border-panel-border rounded-lg p-3 bg-background/40 flex justify-between">
                <span>Valid recipients: {payPreview.valid.length}</span>
                <span>
                  {paySplit ? "Each" : "Send"}:{" "}
                  <span className="text-foreground">
                    {payPreview.eachLabel} {payToken}
                  </span>
                </span>
              </div>
              {payPreview.error && (
                <div className="text-xs text-destructive">{payPreview.error}</div>
              )}
              <Button onClick={submitPay} className="w-full" disabled={payBusy}>
                {payBusy ? "Broadcasting…" : paySplit ? "Split payment" : "Send payment"}
              </Button>
            </div>

            <div className="rounded-xl border border-panel-border bg-background/40 p-4">
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
                Any token, any chain
              </div>
              <div className="grid grid-cols-3 gap-2">
                {SETTLEMENT_TOKENS.map((t) => (
                  <div
                    key={t}
                    className="rounded-lg border border-panel-border bg-background/60 p-2 text-center"
                  >
                    <div className="text-lg">🪙</div>
                    <div className="text-xs font-semibold">{t}</div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
                Your Universal Account sources funds from any asset you hold and
                settles the recipient in the token you pick above.
              </p>
            </div>
          </div>
        </TabsContent>

        {/* HOTELS */}
        <TabsContent value="hotels" className="mt-0">
          <HotelsTab
            onNotify={onNotify}
            onPay={onPay}
            pushActivity={pushActivity}
          />
        </TabsContent>

        {/* RECEIVE */}
        <TabsContent value="receive" className="mt-0">
          <ReceiveTab
            address={address}
            onNotify={onNotify}
            pushActivity={pushActivity}
          />
        </TabsContent>


        <TabsContent value="token" className="mt-0">
          <div className="rounded-xl border border-panel-border bg-background/40 p-6 text-center">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Unified spendable
            </div>
            <div className="text-4xl font-bold neon-text mt-1">
              ${(unifiedUsd ?? 0).toFixed(2)}
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4 text-xs">
              {SETTLEMENT_TOKENS.map((t) => (
                <div
                  key={t}
                  className="rounded-lg border border-panel-border bg-background/60 py-3"
                >
                  <div className="text-lg">🪙</div>
                  <div className="font-semibold">{t}</div>
                  <div className="text-[10px] text-muted-foreground">
                    spend & receive
                  </div>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>


        {/* CONTACTS */}
        <TabsContent value="contacts" className="mt-0">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-panel-border bg-panel/60 p-5 space-y-3">
              <div className="flex items-center gap-3">
                <img
                  src={`https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(cName || cAddr || "new")}&backgroundType=gradientLinear`}
                  alt="Avatar preview"
                  className="size-14 rounded-full border border-panel-border bg-background/60"
                />
                <div>
                  <div className="text-sm font-semibold">Save a contact</div>
                  <div className="text-[11px] text-muted-foreground">
                    A unique avatar is generated from name & address.
                  </div>
                </div>
              </div>
              <Input
                placeholder="Name"
                value={cName}
                onChange={(e) => setCName(e.target.value)}
              />
              <Input
                placeholder="0x address"
                value={cAddr}
                onChange={(e) => setCAddr(e.target.value)}
              />
              <div className="flex items-center gap-2">
                <div className="flex -space-x-2">
                  {["alpha", "nova", "kite", "lumen", "orbit"].map((seed) => (
                    <img
                      key={seed}
                      src={`https://api.dicebear.com/9.x/shapes/svg?seed=${seed}&backgroundType=gradientLinear`}
                      alt=""
                      className="size-7 rounded-full border-2 border-panel/80"
                    />
                  ))}
                </div>
                <span className="text-[10px] text-muted-foreground">
                  Sample avatars
                </span>
              </div>
              <Button onClick={addContact} className="w-full">
                Add contact
              </Button>
            </div>
            <div className="rounded-xl border border-panel-border bg-panel/60 p-5 space-y-2">
              <div className="text-sm font-semibold">Saved</div>
              {contacts.length === 0 && (
                <div className="text-xs text-muted-foreground">
                  No contacts yet.
                </div>
              )}
              {contacts.map((c) => (
                <div
                  key={c.address}
                  className="flex items-center justify-between border-b border-panel-border py-2 text-xs"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={`https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(c.name + c.address)}&backgroundType=gradientLinear`}
                      alt=""
                      className="size-9 rounded-full border border-panel-border shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{c.name}</div>
                      <div className="font-mono text-muted-foreground truncate">
                        {shortAddr(c.address)}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" onClick={() => pickContact(c)}>
                      Pay
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeContact(c.address)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* FAQ */}
        <TabsContent value="faq" className="mt-0">
          <FaqTab />
        </TabsContent>


      </Tabs>

      {/* Activity feed */}
      <div className="mt-8 rounded-2xl border border-panel-border bg-panel/70 p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Activity
            </div>
            <div className="text-sm font-semibold">Recent transactions</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-2 py-0.5 rounded-full border border-primary/30 text-primary/90">
              Store target: {activeNetwork === "mainnet" ? "Arbitrum One" : "Arbitrum Sepolia"}
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full border border-panel-border text-muted-foreground">
              {activity.length} event{activity.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        {activity.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-8 border border-dashed border-panel-border rounded-lg">
            Your payment history will appear here.
          </div>
        ) : (
          <div className="space-y-2 max-h-72 overflow-auto pr-1">
            {activity.map((a) => {
              const kindIcon =
                a.kind === "pay" ? "↗" : a.kind === "receive" ? "↘" : "🧾";
              const kindColor =
                a.kind === "pay"
                  ? "text-primary"
                  : a.kind === "receive"
                  ? "text-[color:var(--success)]"
                  : "text-accent";
              return (
                <div
                  key={a.id}
                  className="flex items-center gap-3 rounded-lg border border-panel-border bg-background/40 px-3 py-2.5 hover:border-primary/40 transition-colors"
                >
                  <div className={`size-9 rounded-lg bg-background/60 border border-panel-border flex items-center justify-center text-base ${kindColor}`}>
                    {kindIcon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="uppercase text-[9px]">
                        {a.kind}
                      </Badge>
                      <span className="text-xs font-medium truncate">
                        {a.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-0.5">
                      <span>
                        {new Date(a.at).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {a.hash && (
                        <a
                          href={a.txUrl ?? "#"}
                          target={a.txUrl ? "_blank" : undefined}
                          rel={a.txUrl ? "noreferrer" : undefined}
                          className="font-mono text-[color:var(--success)] hover:underline"
                          title={a.hash}
                          onClick={(event) => {
                            if (!a.txUrl) event.preventDefault();
                          }}
                        >
                          ✓ {shortHash(a.hash)} ↗
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                    <div>
                      <div className="text-sm font-semibold">{a.amount}</div>
                      <div className="text-[10px] text-muted-foreground">{a.token}</div>
                    </div>
                    {storedMap[a.id] ? (
                      <a
                        href={storedMap[a.id].explorer}
                        target="_blank"
                        rel="noreferrer"
                        className="group inline-flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-md border border-[color:var(--success)]/50 bg-[color:var(--success)]/10 text-[color:var(--success)] hover:bg-[color:var(--success)]/20 hover:shadow-[0_0_12px_-2px_var(--success)] transition"
                        title={`Stored on ${storedMap[a.id].network}`}
                      >
                        <span className="size-1.5 rounded-full bg-[color:var(--success)] animate-pulse" />
                        On-chain
                        <span className="opacity-70 group-hover:translate-x-0.5 transition">↗</span>
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => storeActivity(a)}
                        disabled={storingId === a.id}
                        className="inline-flex items-center gap-1.5 text-[10px] font-medium px-2.5 py-1 rounded-md border border-primary/50 bg-primary/10 text-primary hover:bg-primary/20 hover:shadow-[0_0_14px_-2px_hsl(var(--primary)/0.55)] disabled:opacity-50 disabled:cursor-not-allowed transition"
                        title={`Store this entry on ${activeNetwork === "mainnet" ? "Arbitrum One" : "Arbitrum Sepolia"}`}
                      >
                        {storingId === a.id ? (
                          <>
                            <span className="size-2 rounded-full border border-primary border-t-transparent animate-spin" />
                            Storing…
                          </>
                        ) : (
                          <>
                            <span>⛓</span>
                            Store on-chain
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>


      {/* Contact picker */}
      <Dialog open={contactOpen} onOpenChange={setContactOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pick a contact</DialogTitle>
            <DialogDescription>
              Adds the wallet address to the recipient list.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1 max-h-72 overflow-auto">
            {contacts.length === 0 && (
              <div className="text-xs text-muted-foreground">
                Save contacts in the Contacts tab first.
              </div>
            )}
            {contacts.map((c) => (
              <button
                key={c.address}
                type="button"
                onClick={() => pickContact(c)}
                className="w-full text-left rounded border border-panel-border p-2 hover:bg-background/60 cursor-pointer"
              >
                <div className="text-sm font-semibold">{c.name}</div>
                <div className="text-[11px] font-mono text-muted-foreground">
                  {c.address}
                </div>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setContactOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// -------- Receive tab: create payment request + QR + share link --------

const RECEIVE_TOKENS = ["ETH", "USDC"] as const;
type ReceiveToken = (typeof RECEIVE_TOKENS)[number];

function ReceiveTab({
  address,
  onNotify,
  pushActivity,
}: {
  address: string;
  onNotify?: (msg: string) => void;
  pushActivity: (a: Omit<Activity, "id" | "at">) => void;
}) {
  const [chainId, setChainId] = useState<number>(42161); // Arbitrum One
  const [token, setToken] = useState<ReceiveToken>("USDC");
  const [invoiceType, setInvoiceType] = useState<string>("Invoice");
  const [amount, setAmount] = useState("");
  const memo = "";
  const [expiryMinutes, setExpiryMinutes] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [request, setRequest] = useState<PaymentRequestRow | null>(null);
  const [recent, setRecent] = useState<PaymentRequestRow[]>([]);
  const qrRef = useRef<SVGSVGElement | null>(null);

  const chain = CHAIN_META[chainId];

  const refresh = async () => {
    if (!address) return;
    try {
      const rows = await listRecentRequests(address, 10);
      setRecent(rows);
    } catch {}
  };
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, request?.id]);

  const payUrl = useMemo(() => {
    if (!request) return "";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/pay/${request.id}`;
  }, [request]);

  const create = async () => {
    if (!address) {
      onNotify?.("Connect a wallet first");
      return;
    }
    const amt = Number(amount);
    if (!(amt > 0)) {
      onNotify?.("Enter an amount");
      return;
    }
    setBusy(true);
    try {
      const composedMemo = memo
        ? `[${invoiceType}] ${memo}`
        : `[${invoiceType}]`;
      const row = await createPaymentRequest({
        recipient: address,
        amount: amt,
        token,
        chainId,
        memo: composedMemo,
        expiryMinutes: Number(expiryMinutes) || undefined,
      });
      setRequest(row);
      pushActivity({
        kind: "request",
        label: `Receive · ${memo || "no memo"}`,
        amount: amt,
        token: token as Activity["token"],
      });
      onNotify?.("Payment request created");
    } catch (e: any) {
      onNotify?.(e?.message ?? "Failed to create request");
    } finally {
      setBusy(false);
    }
  };

  const copy = (v: string, label: string) => {
    navigator.clipboard.writeText(v);
    onNotify?.(`${label} copied`);
  };

  const downloadQr = () => {
    const svg = qrRef.current;
    if (!svg) return;
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svg);
    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payment-${request?.id?.slice(0, 8) ?? "request"}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const cancel = async (id: string) => {
    try {
      await cancelPaymentRequest(id);
      onNotify?.("Request cancelled");
      if (request?.id === id) setRequest({ ...request, status: "cancelled" });
      refresh();
    } catch (e: any) {
      onNotify?.(e?.message ?? "Cancel failed");
    }
  };

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="rounded-xl border border-panel-border bg-background/40 p-4 space-y-3">
        <div className="text-sm font-semibold">Request a payment</div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground space-y-1">
            Network
            <select
              className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={chainId}
              onChange={(e) => setChainId(Number(e.target.value))}
            >
              <option value={42161}>Arbitrum One (mainnet)</option>
              <option value={421614}>Arbitrum Sepolia (testnet)</option>
            </select>
          </label>
          <label className="text-xs text-muted-foreground space-y-1">
            Token
            <select
              className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={token}
              onChange={(e) => setToken(e.target.value as ReceiveToken)}
            >
              {RECEIVE_TOKENS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="text-xs text-muted-foreground space-y-1 block">
          Invoice type
          <select
            className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={invoiceType}
            onChange={(e) => setInvoiceType(e.target.value)}
          >
            {["Invoice", "Amount", "Deposit", "Donation", "Subscription", "Refund", "Tip"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="number"
            min="0"
            step="0.0001"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Input
            type="number"
            min="0"
            placeholder="Expiry (min, blank = never)"
            value={expiryMinutes}
            onChange={(e) => setExpiryMinutes(e.target.value)}
          />
        </div>
        <Button onClick={create} className="w-full" disabled={busy || !address}>
          {busy ? "Generating…" : "Generate payment request"}
        </Button>
        <div className="text-[11px] text-muted-foreground">
          Funds settle to your smart account on {chain?.label}.
        </div>
      </div>

      <div className="rounded-xl border border-panel-border bg-background/40 p-4 space-y-3">
        {request ? (
          <>
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Share this request</div>
              <Badge variant={request.status === "pending" ? "secondary" : "default"}>
                {request.status}
              </Badge>
            </div>
            <div className="flex justify-center bg-white rounded-lg p-3">
              <QRCodeSVG
                ref={qrRef as any}
                value={payUrl}
                size={168}
                includeMargin
              />
            </div>
            <div className="text-xs text-muted-foreground text-center break-all">
              {formatDisplayAmount(request.amount)} {request.token} → {shortAddr(request.recipient)}
              <div className="mt-1">{chain?.label}</div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button size="sm" variant="secondary" onClick={() => copy(payUrl, "Link")}>
                Copy link
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => copy(request.recipient, "Address")}
              >
                Copy address
              </Button>
              <Button size="sm" variant="secondary" onClick={downloadQr}>
                Download QR
              </Button>
            </div>
            {request.status === "pending" && (
              <Button
                size="sm"
                variant="ghost"
                className="w-full"
                onClick={() => cancel(request.id)}
              >
                Cancel request
              </Button>
            )}
          </>
        ) : (
          <div className="text-xs text-muted-foreground text-center py-12">
            Generate a request to see the QR code, share link, and payer view.
          </div>
        )}
      </div>

      {recent.length > 0 && (
        <div className="md:col-span-2 rounded-xl border border-panel-border bg-background/40 p-4">
          <div className="text-sm font-semibold mb-2">Recent requests</div>
          <div className="space-y-1 max-h-64 overflow-auto pr-1">
            {recent.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between text-xs border-b border-panel-border py-2"
              >
                <div className="min-w-0 pr-2">
                  <div className="font-semibold">
                    {formatDisplayAmount(r.amount)} {r.token}{" "}
                    <Badge variant="secondary" className="ml-1">
                      {r.status}
                    </Badge>
                  </div>
                  <div className="text-muted-foreground truncate">
                    {r.memo || "no memo"} · chain {r.chain_id}
                  </div>
                </div>
                <div className="flex gap-1">
                  <a
                    href={`/pay/${r.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    Open ↗
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// -------- Tourist packages tab: curated India tours with wallet-pay in ETH --------

type Hotel = {
  id: string;
  name: string;
  city: string;
  tagline: string;
  usdc: string;
  eth: string;
  image: string;
  bookingAddress: string;
};

// Demo settlement address (platform treasury).
const HOTEL_BOOKING_ADDRESS = "0x24A1C7477Bda0BBa179E40Eb9f538fbB719448Fb";

const HOTEL_LISTINGS: Hotel[] = [
  {
    id: "golden-triangle",
    name: "The Golden Triangle (5D/4N)",
    city: "Delhi → Agra → Jaipur",
    tagline: "Taj Mahal, Agra Fort, Amber Fort and Qutub Minar in one loop.",
    usdc: "1.80",
    eth: "0.00062",
    image: "https://images.unsplash.com/photo-1564507592333-c60657eea523?w=800&auto=format&fit=crop",
    bookingAddress: HOTEL_BOOKING_ADDRESS,
  },
  {
    id: "enchanting-kerala",
    name: "Enchanting Kerala (7D/6N)",
    city: "Cochin → Munnar → Thekkady → Alleppey",
    tagline: "Backwater houseboats, tea gardens and Periyar Wildlife Sanctuary.",
    usdc: "2.40",
    eth: "0.00088",
    image: "https://images.unsplash.com/photo-1602216056096-3b40cc0c9944?w=800&auto=format&fit=crop",
    bookingAddress: HOTEL_BOOKING_ADDRESS,
  },
  {
    id: "kashmir-valley",
    name: "Kashmir Valley Retreat (6D/5N)",
    city: "Srinagar → Gulmarg → Pahalgam",
    tagline: "Dal Lake shikaras, the Gulmarg Gondola and Betaab Valley.",
    usdc: "2.10",
    eth: "0.00078",
    image: "https://images.unsplash.com/photo-1566837945700-30057527ade0?w=800&auto=format&fit=crop",
    bookingAddress: HOTEL_BOOKING_ADDRESS,
  },
  {
    id: "spiritual-temple",
    name: "Spiritual & Temple Circuit",
    city: "Varanasi → Prayagraj → Ayodhya",
    tagline: "Ganga Aarti, Kashi Vishwanath and the new Ram Mandir.",
    usdc: "1.55",
    eth: "0.00058",
    image: "https://images.unsplash.com/photo-1561361513-2d000a50f0dc?w=800&auto=format&fit=crop",
    bookingAddress: HOTEL_BOOKING_ADDRESS,
  },
  {
    id: "rajasthan-royal",
    name: "Rajasthan Royal Tour (6D/5N)",
    city: "Jaipur → Jodhpur → Udaipur",
    tagline: "Mehrangarh Fort, City Palace and sunset on Lake Pichola.",
    usdc: "2.00",
    eth: "0.00074",
    image: "https://images.unsplash.com/photo-1477587458883-47145ed94245?w=800&auto=format&fit=crop",
    bookingAddress: HOTEL_BOOKING_ADDRESS,
  },
  {
    id: "goa-beach",
    name: "Goa Beach Escape (4D/3N)",
    city: "North & South Goa",
    tagline: "Beaches, water sports, nightlife and Portuguese heritage.",
    usdc: "1.30",
    eth: "0.00048",
    image: "https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?w=800&auto=format&fit=crop",
    bookingAddress: HOTEL_BOOKING_ADDRESS,
  },
  {
    id: "north-east",
    name: "North East Explorer (6D/5N)",
    city: "Gangtok → Pelling → Darjeeling",
    tagline: "Himalayan panoramas, monasteries and tea estates.",
    usdc: "1.90",
    eth: "0.00070",
    image: "https://images.unsplash.com/photo-1544735716-392fe2489ffa?w=800&auto=format&fit=crop",
    bookingAddress: HOTEL_BOOKING_ADDRESS,
  },
  {
    id: "andaman",
    name: "Andaman Island Getaway (5D/4N)",
    city: "Port Blair → Havelock → Neil Island",
    tagline: "Radhanagar Beach, snorkeling and scuba diving.",
    usdc: "2.60",
    eth: "0.00096",
    image: "https://images.unsplash.com/photo-1586500036706-41963de24d8b?w=800&auto=format&fit=crop",
    bookingAddress: HOTEL_BOOKING_ADDRESS,
  },
];


function HotelsTab({
  onNotify,
  onPay,
  pushActivity,
}: {
  onNotify?: (msg: string) => void;
  onPay?: Props["onPay"];
  pushActivity: (a: Omit<Activity, "id" | "at">) => void;
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const bookHotel = async (hotel: Hotel, token: Token) => {
    if (!onPay) {
      onNotify?.("Connect a wallet first");
      return;
    }
    const amount = token === "USDC" ? hotel.usdc : hotel.eth;
    const key = `${hotel.id}:${token}`;
    setBusyKey(key);
    onNotify?.(
      `Withdrawing ${amount} ${token} from your wallet to book ${hotel.name}…`,
    );
    try {
      const res = await onPay({
        recipient: hotel.bookingAddress,
        amount,
        token,
        memo: `Package booking · ${hotel.name}`,
      });
      pushActivity({
        kind: "pay",
        label: `Booked ${hotel.name}`,
        amount,
        token,
        hash: res?.txId,
        txUrl: res?.txUrl,
      });
      onNotify?.(
        res?.txId
          ? `Booking confirmed — tx ${res.txId}`
          : `Booking submitted for ${hotel.name}`,
      );
    } catch (e: any) {
      onNotify?.(e?.message ?? "Booking failed");
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-panel-border bg-panel/60 p-4">
        <div className="text-sm font-semibold mb-1">Curated tourist packages across India</div>
        <div className="text-[11px] text-muted-foreground">
          Every itinerary settles instantly to the operator's booking wallet
          when you pay with ETH.
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {HOTEL_LISTINGS.map((hotel) => {
          const ethBusy = busyKey === `${hotel.id}:ETH`;
          const anyBusy = busyKey !== null;
          return (
            <div
              key={hotel.id}
              className="rounded-xl border border-panel-border bg-panel/60 overflow-hidden flex flex-col hover:border-primary/50 transition-colors"
            >
              <div className="aspect-[16/10] overflow-hidden bg-background/60 relative">
                <img
                  src={hotel.image}
                  alt={hotel.name}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent" />
              </div>
              <div className="p-4 flex-1 flex flex-col gap-2">
                <div className="text-sm font-semibold leading-snug">
                  {hotel.name}
                </div>
                <div className="text-[11px] text-primary font-medium">
                  {hotel.city}
                </div>
                <div className="text-[11px] text-muted-foreground leading-relaxed">
                  {hotel.tagline}
                </div>
                <div className="text-[10px] font-mono text-muted-foreground truncate">
                  → {shortAddr(hotel.bookingAddress)}
                </div>
                <div className="mt-auto pt-2">
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => bookHotel(hotel, "ETH")}
                    disabled={anyBusy}
                  >
                    {ethBusy ? "Paying…" : `Pay ${hotel.eth} ETH`}
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// -------- FAQ tab --------

const FAQ_ITEMS = [
  {
    q: "What is Paygrid?",
    a: "Paygrid is a smart-account wallet UX layered on Particle Universal Accounts. You sign in once, then send, split, and receive value across supported chains with a single balance.",
  },
  {
    q: "Which networks are supported?",
    a: "Payments and requests settle on Arbitrum One in mainnet mode and Arbitrum Sepolia in testnet mode. The Universal Account can source funds from any chain Particle indexes.",
  },
  {
    q: "Which tokens can I move?",
    a: "USDC and ETH are the two settlement tokens. Your Universal Account picks the cheapest source assets you already hold and delivers the token the recipient asked for.",
  },
  {
    q: "Do splits require multiple signatures?",
    a: "No. A split is a single atomic Universal Account transaction. Everyone in the list settles together or nothing settles — one signature covers the batch.",
  },
  {
    q: "How does Receive work?",
    a: "Generate a request from the Receive tab. You get a QR code and a share link that opens a payer view where the sender pays directly from their wallet on the chosen chain.",
  },
  {
    q: "Are the tourist packages real bookings?",
    a: "The listings are demo itineraries wired to a platform treasury address so you can experience the end-to-end pay flow. Extending them to a real operator only requires swapping the booking address.",
  },
  {
    q: "What are the fees?",
    a: "Paygrid does not add a protocol fee. You pay the underlying network gas plus whatever Particle needs to source funds across chains when routing is required.",
  },
  {
    q: "Where does my activity live?",
    a: "The activity feed is stored locally in your browser. On-chain transactions remain independently verifiable on Arbiscan through the tx link on each entry.",
  },
];

function FaqTab() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="rounded-xl border border-panel-border bg-panel/60 p-5">
      <div className="text-sm font-semibold mb-1">Frequently asked questions</div>
      <div className="text-[11px] text-muted-foreground mb-4">
        Everything you need to know about Paygrid, in one place.
      </div>
      <div className="space-y-2">
        {FAQ_ITEMS.map((item, i) => {
          const isOpen = open === i;
          return (
            <div
              key={item.q}
              className="rounded-lg border border-panel-border bg-background/40 overflow-hidden"
            >
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : i)}
                className="w-full flex items-center justify-between gap-3 text-left px-4 py-3 hover:bg-background/60 transition-colors cursor-pointer"
              >
                <span className="text-sm font-medium">{item.q}</span>
                <span className={`text-primary transition-transform ${isOpen ? "rotate-45" : ""}`}>
                  +
                </span>
              </button>
              {isOpen && (
                <div className="px-4 pb-4 text-xs text-muted-foreground leading-relaxed border-t border-panel-border/60 pt-3">
                  {item.a}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}



