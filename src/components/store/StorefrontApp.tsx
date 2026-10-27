"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CATEGORY_LABEL, money, shortDate, virtualDate } from "@/lib/format";
import { ProductCard } from "@/components/store/ProductCard";
import { ProductDrawer } from "@/components/store/ProductDrawer";
import { CartDrawer } from "@/components/store/CartDrawer";
import { NormalLogo } from "@/components/normal/NormalLogo";
import { PageSkeleton } from "@/components/normal/PageSkeleton";
import type { CartLine, StoreCatalogue, StoreOrder, StoreProduct } from "@/components/store/types";

const CART_KEY = "normal.demo-store.cart.v1";
const ORDER_KEYS_KEY = "normal.demo-store.order-keys.v1";
const CATEGORIES = ["running", "basketball", "lifestyle", "football", "apparel"];

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeStorage(key: string, value: unknown): void {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: keep in-memory state */ }
}
function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface CartState { lines: CartLine[]; idempotencyKey: string; couponCode: string }

export function StorefrontApp() {
  const [catalogue, setCatalogue] = useState<StoreCatalogue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState<StoreProduct | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [cart, setCart] = useState<CartState>({ lines: [], idempotencyKey: "", couponCode: "" });
  const [orderKeys, setOrderKeys] = useState<string[]>([]);
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const loadCatalogue = useCallback(async () => {
    try {
      const res = await fetch("/api/demo-store/products", { cache: "no-store" });
      if (!res.ok) throw new Error(`Catalogue request failed (${res.status})`);
      setCatalogue((await res.json()) as StoreCatalogue);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the catalogue");
    }
  }, []);

  const loadOrders = useCallback(async (keys: string[]) => {
    if (keys.length === 0) { setOrders([]); return; }
    const res = await fetch(`/api/demo-store/orders?keys=${encodeURIComponent(keys.join(","))}`, { cache: "no-store" });
    if (res.ok) setOrders(((await res.json()) as { orders: StoreOrder[] }).orders);
  }, []);

  useEffect(() => {
    // Hydrate per-viewer conveniences (cart, own order keys) from localStorage after mount,
    // then load server data. Runs once; storage is optional and may be unavailable.
    let cancelled = false;
    const bootstrap = async () => {
      const storedCart = readStorage<CartState>(CART_KEY, { lines: [], idempotencyKey: newKey(), couponCode: "" });
      if (!storedCart.idempotencyKey) storedCart.idempotencyKey = newKey();
      const keys = readStorage<string[]>(ORDER_KEYS_KEY, []);
      await Promise.resolve();
      if (cancelled) return;
      setCart(storedCart);
      setOrderKeys(keys);
      setHydrated(true);
      await Promise.all([loadCatalogue(), loadOrders(keys)]);
    };
    void bootstrap();
    return () => { cancelled = true; };
  }, [loadCatalogue, loadOrders]);

  useEffect(() => { if (hydrated) writeStorage(CART_KEY, cart); }, [cart, hydrated]);
  useEffect(() => { if (hydrated) writeStorage(ORDER_KEYS_KEY, orderKeys); }, [orderKeys, hydrated]);

  const products = useMemo(() => {
    const list = catalogue?.products ?? [];
    const q = query.trim().toLowerCase();
    return list.filter((p) => (!category || p.category === category) && (!q || `${p.name} ${p.subtitle} ${CATEGORY_LABEL[p.category]}`.toLowerCase().includes(q)));
  }, [catalogue, query, category]);

  const productById = useMemo(() => new Map((catalogue?.products ?? []).map((p) => [p.productId, p])), [catalogue]);
  const cartCount = cart.lines.reduce((a, l) => a + l.quantity, 0);

  const addToCart = (productId: string, quantity: number) => {
    setCart((c) => {
      const existing = c.lines.find((l) => l.productId === productId);
      const product = productById.get(productId);
      const max = Math.min(5, product?.availableUnits ?? 5);
      const lines = existing
        ? c.lines.map((l) => (l.productId === productId ? { ...l, quantity: Math.min(max, l.quantity + quantity) } : l))
        : [...c.lines, { productId, quantity: Math.min(max, quantity) }];
      return { ...c, lines };
    });
    setSelected(null);
    setCartOpen(true);
  };
  const setQuantity = (productId: string, quantity: number) => {
    setCart((c) => ({ ...c, lines: quantity <= 0 ? c.lines.filter((l) => l.productId !== productId) : c.lines.map((l) => (l.productId === productId ? { ...l, quantity } : l)) }));
  };

  const onOrderPlaced = (key: string) => {
    const keys = [key, ...orderKeys.filter((k) => k !== key)].slice(0, 20);
    setOrderKeys(keys);
    setCart({ lines: [], idempotencyKey: newKey(), couponCode: "" });
    void loadCatalogue();
    void loadOrders(keys);
  };

  return (
    <>
      <header className="topbar">
        <div className="shell topbar-inner">
          <Link href="/" className="brand normal-legacy-brand"><NormalLogo /><small>· Demo store</small></Link>
          <div className="row">
            {catalogue?.virtualTime ? <span className="pill" title="Simulated clock of the active run">Virtual time · {virtualDate(catalogue.virtualTime)}</span> : null}
            <button className="btn cart-btn" onClick={() => setCartOpen(true)} aria-label={`Open cart, ${cartCount} items`}>
              Cart {cartCount > 0 ? <span className="count">{cartCount}</span> : null}
            </button>
          </div>
        </div>
      </header>

      <main className="shell">
        <section className="store-hero">
          <h1>Shop the simulated Nike range.</h1>
          <p>Seventeen real Nike products at their publicly listed UK prices, backed by a live digital twin. Every purchase here reserves synthetic stock, creates a canonical order event and shows up in the control room.</p>
          {catalogue?.banners.map((b) => (
            <div key={b.bannerId} className="banner" data-testid="storefront-banner">
              <span className="pill">Storefront</span>
              <span>{b.message}</span>
              {b.promoCode ? <span className="pill">Code {b.promoCode}</span> : null}
            </div>
          ))}
          {catalogue?.notice ? <div className="alert info">{catalogue.notice} <Link href="/dev/simulator" style={{ textDecoration: "underline" }}>Open the control room</Link>.</div> : null}
          {error ? <div className="alert error">{error}</div> : null}
        </section>

        <div className="filters" role="search">
          <input className="input" placeholder="Search products" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search products" />
          <button className={`chip ${category === null ? "active" : ""}`} onClick={() => setCategory(null)}>All</button>
          {CATEGORIES.map((c) => (
            <button key={c} className={`chip ${category === c ? "active" : ""}`} onClick={() => setCategory(c)}>{CATEGORY_LABEL[c]}</button>
          ))}
        </div>

        {catalogue === null && !error ? <PageSkeleton variant="catalogue" label="Loading product catalogue" /> : null}
        {catalogue && products.length === 0 ? <div className="empty">No products match.</div> : null}
        <section className="grid product-grid" aria-label="Products">
          {products.map((p) => <ProductCard key={p.productId} product={p} onOpen={() => setSelected(p)} />)}
        </section>

        {orders.length > 0 ? (
          <section className="card" style={{ marginBottom: 48 }} data-testid="your-orders">
            <div className="card-head"><h3>Your simulated orders</h3><span>Persisted in MongoDB · refresh keeps them</span></div>
            <div className="card-body orders">
              {orders.map((o) => (
                <div key={o.orderId} className="order">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <strong className="mono">{o.orderId}</strong>
                    <span className={`pill ${o.shipment?.status === "delayed" || o.shipment?.status === "lost" ? "warn" : o.shipment?.status === "delivered" ? "ok" : ""}`}>{o.shipment?.status ?? o.status}</span>
                  </div>
                  <span className="muted">{o.lines.map((l) => `${l.quantity}× ${l.name}`).join(", ")}</span>
                  <span>Total {money(o.netRevenueMinor)}{o.discountMinor > 0 ? ` (saved ${money(o.discountMinor)})` : ""} · placed {shortDate(o.placedAt)} virtual time{o.shipment ? ` · promised ${shortDate(o.shipment.promisedAt)}` : ""}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <footer className="muted small" style={{ padding: "24px 0 48px" }}>
          Catalogue served from {catalogue?.servedFrom ?? "…"}. Reference prices observed on nike.com/gb on {catalogue?.products[0]?.reference ? shortDate(catalogue.products[0].reference.retrievedAt) : "—"} and may since have changed.
        </footer>
      </main>

      {selected ? <ProductDrawer product={selected} onClose={() => setSelected(null)} onAdd={addToCart} /> : null}
      {cartOpen ? (
        <CartDrawer
          lines={cart.lines} productById={productById} couponCode={cart.couponCode} idempotencyKey={cart.idempotencyKey}
          onCoupon={(code) => setCart((c) => ({ ...c, couponCode: code }))}
          onQuantity={setQuantity} onClose={() => setCartOpen(false)} onPlaced={onOrderPlaced}
          onRotateKey={() => setCart((c) => ({ ...c, idempotencyKey: newKey() }))}
        />
      ) : null}
    </>
  );
}
