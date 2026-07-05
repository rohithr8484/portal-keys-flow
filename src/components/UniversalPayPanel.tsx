import { useEffect, useMemo, useState } from "react";
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

type Props = {
  smartAccount: string | null;
  unifiedUsd: number | null;
  onNotify?: (msg: string) => void;
  /** When provided, Pay & Split and Checkout will execute a real Universal Account transfer. */
  onPay?: (args: {
    recipient: string;
    amount: number;
    token: "USDC" | "USDT" | "ETH";
    memo?: string;
  }) => Promise<{ txId?: string } | void>;
};

// ---- Static catalogues (inspired by universal-pay demo) ----
type Merchant = {
  key: string;
  name: string;
  category: string;
  icon: string;
  price: number;
  unit: string;
};

const MERCHANTS: Merchant[] = [
  { key: "netflix", name: "Netflix", category: "Streaming", icon: "🎬", price: 15.49, unit: "/mo" },
  { key: "spotify", name: "Spotify", category: "Music", icon: "🎧", price: 11.99, unit: "/mo" },
  { key: "prime", name: "Amazon Prime", category: "Shopping", icon: "📦", price: 14.99, unit: "/mo" },
  { key: "yt", name: "YouTube Premium", category: "Streaming", icon: "▶️", price: 13.99, unit: "/mo" },
  { key: "disney", name: "Disney+", category: "Streaming", icon: "🏰", price: 9.99, unit: "/mo" },
  { key: "apple", name: "Apple Music", category: "Music", icon: "🎵", price: 10.99, unit: "/mo" },
  { key: "xbox", name: "Xbox Game Pass", category: "Gaming", icon: "🎮", price: 16.99, unit: "/mo" },
  { key: "steam", name: "Steam Wallet", category: "Gaming", icon: "🕹️", price: 20.0, unit: "top-up" },
  { key: "x", name: "X Premium", category: "Social", icon: "✦", price: 8.0, unit: "/mo" },
  { key: "cart", name: "Amazon Order", category: "Shopping", icon: "🛒", price: 49.99, unit: "one-time" },
  // ---- Travel ----
  { key: "flight", name: "Flight Ticket", category: "Travel", icon: "✈️", price: 249.0, unit: "one-way" },
  { key: "hotel", name: "Hotel Night", category: "Travel", icon: "🏨", price: 129.0, unit: "/night" },
  { key: "airbnb", name: "Airbnb Stay", category: "Travel", icon: "🏡", price: 89.0, unit: "/night" },
  { key: "uber", name: "Ride Credit", category: "Travel", icon: "🚕", price: 25.0, unit: "top-up" },
  { key: "esim", name: "Travel eSIM", category: "Travel", icon: "📶", price: 12.0, unit: "10GB" },
  { key: "insurance", name: "Trip Insurance", category: "Travel", icon: "🛡️", price: 18.5, unit: "/trip" },
  { key: "rail", name: "Rail Pass", category: "Travel", icon: "🚄", price: 79.0, unit: "3-day" },
  { key: "lounge", name: "Airport Lounge", category: "Travel", icon: "🛋️", price: 45.0, unit: "/visit" },
];

const SETTLEMENT_TOKENS = ["USDC", "USDT", "ETH"] as const;
type Token = (typeof SETTLEMENT_TOKENS)[number];

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
type PayRequest = {
  id: string;
  amount: number;
  token: Token;
  note: string;
  status: "open" | "paid" | "cancelled";
  createdAt: number;
};
type Activity = {
  id: string;
  kind: "pay" | "receive" | "cart" | "request";
  label: string;
  amount: number;
  token: Token;
  at: number;
  hash?: string;
};

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

const FEATURES = [
  { key: "pay", icon: "💸", title: "Pay & split", desc: "Send to one wallet or divide a bill across many in a single tap." },
  { key: "token", icon: "🪙", title: "Any token", desc: "Pay or get paid in USDC, USDT or ETH — auto-sourced from your assets." },
  { key: "requests", icon: "🧾", title: "Requests & invoices", desc: "Trackable payment requests with shareable links and QR codes." },
  { key: "cart", icon: "🛍️", title: "Bills & shopping", desc: "Pay subscriptions and orders from one universal balance." },
  { key: "contacts", icon: "⭐", title: "Contacts", desc: "Save payees once and send to them by name, not a 0x address." },
  
] as const;

type FeatureKey = (typeof FEATURES)[number]["key"];

export function UniversalPayPanel({ smartAccount, unifiedUsd, onNotify }: Props) {
  const address = smartAccount ?? "";
  const [tab, setTab] = useState<FeatureKey>("pay");

  const [contacts, setContacts] = usePersist<Contact[]>("up_contacts", []);
  const [requests, setRequests] = usePersist<PayRequest[]>("up_requests", []);
  const [activity, setActivity] = usePersist<Activity[]>("up_activity", []);
  const [cart, setCart] = usePersist<Record<string, number>>("up_cart", {});

  const [contactOpen, setContactOpen] = useState(false);

  const pushActivity = (a: Omit<Activity, "id" | "at">) =>
    setActivity((prev) =>
      [{ ...a, id: crypto.randomUUID(), at: Date.now() }, ...prev].slice(0, 30),
    );

  const requireAddress = () => {
    if (!address) {
      onNotify?.("Connect a wallet first");
      return false;
    }
    return true;
  };

  // ---------- Pay & Split state ----------
  const [payToken, setPayToken] = useState<Token>("USDC");
  const [payRecipients, setPayRecipients] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [paySplit, setPaySplit] = useState(true);
  const payPreview = useMemo(() => {
    const list = payRecipients
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const valid = list.filter((s) => ethers.isAddress(s));
    const total = Number(payAmount || "0");
    const each = paySplit && valid.length ? total / valid.length : total;
    return { list, valid, total, each };
  }, [payRecipients, payAmount, paySplit]);

  const submitPay = () => {
    if (!requireAddress()) return;
    if (payPreview.valid.length === 0 || payPreview.total <= 0) {
      onNotify?.("Add a valid recipient and amount");
      return;
    }
    pushActivity({
      kind: "pay",
      label: paySplit
        ? `Split to ${payPreview.valid.length} recipients`
        : `Sent to ${shortAddr(payPreview.valid[0])}`,
      amount: payPreview.total,
      token: payToken,
    });
    setPayAmount("");
    setPayRecipients("");
    onNotify?.("Payment queued");
  };

  // ---------- Requests state ----------
  const [reqAmount, setReqAmount] = useState("");
  const [reqToken, setReqToken] = useState<Token>("USDC");
  const [reqNote, setReqNote] = useState("");
  const createRequest = () => {
    if (!requireAddress()) return;
    const amt = Number(reqAmount || "0");
    if (amt <= 0) {
      onNotify?.("Enter an amount");
      return;
    }
    const r: PayRequest = {
      id: crypto.randomUUID(),
      amount: amt,
      token: reqToken,
      note: reqNote,
      status: "open",
      createdAt: Date.now(),
    };
    setRequests((prev) => [r, ...prev]);
    pushActivity({ kind: "request", label: `Request · ${reqNote || "no memo"}`, amount: amt, token: reqToken });
    setReqAmount("");
    setReqNote("");
    onNotify?.("Request created");
  };
  const requestLink = (r: PayRequest) => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const p = new URLSearchParams({
      to: address,
      amount: String(r.amount),
      asset: r.token,
      id: r.id,
    });
    if (r.note) p.set("note", r.note);
    return `${origin}/?pay=1&${p.toString()}`;
  };
  const updateReq = (id: string, status: PayRequest["status"]) =>
    setRequests((prev) => prev.map((x) => (x.id === id ? { ...x, status } : x)));

  // ---------- Cart state ----------
  const cartLines = useMemo(
    () =>
      Object.entries(cart)
        .map(([k, qty]) => {
          const m = MERCHANTS.find((mm) => mm.key === k);
          return m ? { m, qty } : null;
        })
        .filter(Boolean) as { m: Merchant; qty: number }[],
    [cart],
  );
  const cartTotal = cartLines.reduce((s, l) => s + l.m.price * l.qty, 0);
  const bumpCart = (k: string, delta: number) =>
    setCart((prev) => {
      const next = { ...prev, [k]: Math.max(0, (prev[k] ?? 0) + delta) };
      if (next[k] === 0) delete next[k];
      return next;
    });
  const checkoutCart = () => {
    if (!requireAddress()) return;
    if (cartTotal <= 0) return;
    pushActivity({
      kind: "cart",
      label: `Checkout · ${cartLines.length} item(s)`,
      amount: cartTotal,
      token: "USDC",
    });
    setCart({});
    onNotify?.("Cart settled in USDC");
  };

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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-5">
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
                    {payPreview.each.toFixed(4)} {payToken}
                  </span>
                </span>
              </div>
              <Button onClick={submitPay} className="w-full">
                {paySplit ? "Split payment" : "Send payment"}
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

        {/* ANY TOKEN — reuses balance panel */}
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

        {/* REQUESTS */}
        <TabsContent value="requests" className="mt-0">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-panel-border bg-background/40 p-4 space-y-3">
              <div className="text-sm font-semibold">New request</div>
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
                  value={reqToken}
                  onChange={(e) => setReqToken(e.target.value as Token)}
                >
                  {SETTLEMENT_TOKENS.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <Input
                placeholder="Memo (optional)"
                value={reqNote}
                onChange={(e) => setReqNote(e.target.value)}
              />
              <Button onClick={createRequest} className="w-full">
                Create request
              </Button>
            </div>

            <div className="rounded-xl border border-panel-border bg-background/40 p-4 space-y-2">
              <div className="text-sm font-semibold">Open requests</div>
              {requests.length === 0 && (
                <div className="text-xs text-muted-foreground">
                  No requests yet.
                </div>
              )}
              <div className="space-y-2 max-h-72 overflow-auto pr-1">
                {requests.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-lg border border-panel-border bg-background/60 p-3 flex items-start gap-3"
                  >
                    <div className="rounded bg-white p-1">
                      <QRCodeSVG value={requestLink(r)} size={56} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold">
                        {r.amount} {r.token}{" "}
                        <Badge
                          variant={r.status === "paid" ? "default" : "secondary"}
                          className="ml-1"
                        >
                          {r.status}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {r.note || "no memo"}
                      </div>
                      <div className="flex gap-2 mt-1">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            navigator.clipboard.writeText(requestLink(r));
                            onNotify?.("Link copied");
                          }}
                        >
                          Copy link
                        </Button>
                        {r.status === "open" && (
                          <>
                            <Button
                              size="sm"
                              onClick={() => updateReq(r.id, "paid")}
                            >
                              Mark paid
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => updateReq(r.id, "cancelled")}
                            >
                              Cancel
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* CART */}
        <TabsContent value="cart" className="mt-0">
          <div className="grid md:grid-cols-3 gap-4">
            <div className="md:col-span-2 rounded-xl border border-panel-border bg-background/40 p-4">
              <div className="text-sm font-semibold mb-3">Subscriptions & shops</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {MERCHANTS.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => bumpCart(m.key, 1)}
                    className="rounded-lg border border-panel-border bg-background/60 p-3 text-left hover:border-primary/50 cursor-pointer"
                  >
                    <div className="text-lg">{m.icon}</div>
                    <div className="text-xs font-semibold mt-1">{m.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      ${m.price.toFixed(2)} {m.unit}
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-panel-border bg-background/40 p-4 space-y-2">
              <div className="text-sm font-semibold">Cart</div>
              {cartLines.length === 0 && (
                <div className="text-xs text-muted-foreground">Empty.</div>
              )}
              {cartLines.map(({ m, qty }) => (
                <div
                  key={m.key}
                  className="flex items-center justify-between text-xs border-b border-panel-border py-1"
                >
                  <span>
                    {m.icon} {m.name}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => bumpCart(m.key, -1)}
                    >
                      −
                    </Button>
                    <span className="w-6 text-center">{qty}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => bumpCart(m.key, 1)}
                    >
                      +
                    </Button>
                  </div>
                </div>
              ))}
              <div className="flex justify-between text-sm font-semibold pt-2">
                <span>Total</span>
                <span>${cartTotal.toFixed(2)}</span>
              </div>
              <Button
                className="w-full"
                onClick={checkoutCart}
                disabled={cartTotal <= 0}
              >
                Checkout in USDC
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* CONTACTS */}
        <TabsContent value="contacts" className="mt-0">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-panel-border bg-background/40 p-4 space-y-3">
              <div className="text-sm font-semibold">Save a contact</div>
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
              <Button onClick={addContact} className="w-full">
                Add contact
              </Button>
            </div>
            <div className="rounded-xl border border-panel-border bg-background/40 p-4 space-y-2">
              <div className="text-sm font-semibold">Saved</div>
              {contacts.length === 0 && (
                <div className="text-xs text-muted-foreground">
                  No contacts yet.
                </div>
              )}
              {contacts.map((c) => (
                <div
                  key={c.address}
                  className="flex items-center justify-between border-b border-panel-border py-1 text-xs"
                >
                  <div>
                    <div className="font-semibold">{c.name}</div>
                    <div className="font-mono text-muted-foreground">
                      {shortAddr(c.address)}
                    </div>
                  </div>
                  <div className="flex gap-1">
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

        {/* RECEIVE */}
        <TabsContent value="receive" className="mt-0">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-panel-border bg-background/40 p-4 flex flex-col items-center gap-3">
              <div className="text-sm font-semibold self-start">
                Your deposit QR
              </div>
              <div className="rounded-xl bg-white p-3">
                <QRCodeSVG value={address || "not-connected"} size={192} />
              </div>
              <div className="font-mono text-xs break-all text-center">
                {address || "Connect a wallet"}
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  if (!address) return;
                  navigator.clipboard.writeText(address);
                  onNotify?.("Address copied");
                }}
              >
                Copy address
              </Button>
            </div>
            <div className="rounded-xl border border-panel-border bg-background/40 p-4 space-y-3">
              <div className="text-sm font-semibold">Cross-chain top-ups</div>
              <div className="grid grid-cols-2 gap-2 text-center text-xs">
                {["Ethereum", "Base", "Optimism", "Polygon", "BSC", "Arbitrum"].map(
                  (c) => (
                    <div
                      key={c}
                      className="rounded-md border border-panel-border bg-background/60 py-2"
                    >
                      {c}
                    </div>
                  ),
                )}
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Deposit from any of these networks — the Universal Account
                consolidates the balance on Arbitrum automatically.
              </p>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Activity feed */}
      <div className="mt-6">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
          Recent activity
        </div>
        {activity.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            Your payment history will appear here.
          </div>
        ) : (
          <div className="space-y-1 max-h-40 overflow-auto pr-1">
            {activity.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between text-xs border-b border-panel-border py-1"
              >
                <span>
                  <Badge variant="secondary" className="mr-2">
                    {a.kind}
                  </Badge>
                  {a.label}
                </span>
                <span className="text-muted-foreground">
                  {a.amount} {a.token} ·{" "}
                  {new Date(a.at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))}
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
