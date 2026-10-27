"use client";

import { useEffect, useState } from "react";
import { money } from "@/lib/format";
import type { CartLine, StoreOrder, StoreProduct } from "@/components/store/types";

interface Props {
  lines: CartLine[];
  productById: Map<string, StoreProduct>;
  couponCode: string;
  idempotencyKey: string;
  onCoupon: (code: string) => void;
  onQuantity: (productId: string, quantity: number) => void;
  onClose: () => void;
  onPlaced: (idempotencyKey: string) => void;
  onRotateKey: () => void;
}

type Phase = { kind: "idle" } | { kind: "submitting" } | { kind: "done"; order: StoreOrder; replayed: boolean } | { kind: "failed"; message: string };

export function CartDrawer({ lines, productById, couponCode, idempotencyKey, onCoupon, onQuantity, onClose, onPlaced, onRotateKey }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [device] = useState<"desktop" | "ios" | "android" | "other">(() => {
    if (typeof navigator === "undefined") return "desktop";
    const ua = navigator.userAgent;
    return /iPhone|iPad/.test(ua) ? "ios" : /Android/.test(ua) ? "android" : "desktop";
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const subtotal = lines.reduce((a, l) => a + (productById.get(l.productId)?.priceMinor ?? 0) * l.quantity, 0);

  const placeOrder = async () => {
    setPhase({ kind: "submitting" });
    try {
      const res = await fetch("/api/demo-store/checkout", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey, device, items: lines, ...(couponCode.trim() ? { couponCode: couponCode.trim().toUpperCase() } : {}) }),
      });
      const body = await res.json();
      if (res.status === 201 || res.status === 200) {
        setPhase({ kind: "done", order: body.order as StoreOrder, replayed: body.status === "replayed" });
        onPlaced(idempotencyKey);
        return;
      }
      if (res.status === 409) {
        setPhase({ kind: "failed", message: body.message ?? "Checkout could not be completed." });
        onRotateKey();
        return;
      }
      setPhase({ kind: "failed", message: body?.error?.message ?? `Checkout failed (${res.status})` });
      onRotateKey();
    } catch (e) {
      setPhase({ kind: "failed", message: e instanceof Error ? e.message : "Network error" });
    }
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Cart" data-testid="cart-drawer">
        <div className="drawer-head">
          <h2>{phase.kind === "done" ? "Order confirmed" : "Your cart"}</h2>
          <button className="btn sm" onClick={onClose}>Close</button>
        </div>
        <div className="drawer-body">
          {phase.kind === "done" ? (
            <>
              <div className="alert ok" data-testid="order-confirmation">
                {phase.replayed ? "This order had already been placed; here is the original." : "Synthetic order placed and persisted."} Order <strong className="mono">{phase.order.orderId}</strong>.
              </div>
              {phase.order.lines.map((l) => (
                <div key={l.productId} className="line"><span>{l.quantity}× {l.name}</span><span>{money(l.lineTotalMinor)}</span></div>
              ))}
              {phase.order.discountMinor > 0 ? <div className="line muted"><span>Discount</span><span>−{money(phase.order.discountMinor)}</span></div> : null}
              <div className="total"><span>Total</span><span>{money(phase.order.netRevenueMinor)}</span></div>
              <p className="muted small">No payment was taken: this is a simulation. Inventory has been reduced and an <code>order.completed</code> event is now in the ledger.</p>
            </>
          ) : lines.length === 0 ? (
            <div className="empty">Your cart is empty.</div>
          ) : (
            <>
              {lines.map((l) => {
                const p = productById.get(l.productId);
                if (!p) return null;
                const max = Math.min(5, p.availableUnits);
                return (
                  <div key={l.productId} className="line" data-testid={`cart-line-${l.productId}`}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      <div className="muted small">{money(p.priceMinor)} each{p.availableUnits < l.quantity ? " · not enough stock" : ""}</div>
                    </div>
                    <div className="qty">
                      <button onClick={() => onQuantity(l.productId, l.quantity - 1)} aria-label={`Decrease ${p.name}`}>−</button>
                      <span>{l.quantity}</span>
                      <button onClick={() => onQuantity(l.productId, Math.min(max, l.quantity + 1))} disabled={l.quantity >= max} aria-label={`Increase ${p.name}`}>+</button>
                    </div>
                  </div>
                );
              })}
              <label className="field">Promo code (optional)
                <input className="input" value={couponCode} onChange={(e) => onCoupon(e.target.value)} placeholder="e.g. AUTUMN15" />
              </label>
              <div className="total"><span>Subtotal</span><span>{money(subtotal)}</span></div>
              <p className="muted small">Discounts are computed server-side at checkout. No card or personal details are requested, ever.</p>
              {phase.kind === "failed" ? <div className="alert error" data-testid="checkout-error">{phase.message}</div> : null}
            </>
          )}
        </div>
        <div className="drawer-foot">
          {phase.kind === "done" ? (
            <button className="btn primary block" onClick={() => { setPhase({ kind: "idle" }); onClose(); }}>Continue shopping</button>
          ) : (
            <button className="btn primary block" disabled={lines.length === 0 || phase.kind === "submitting"} onClick={placeOrder} data-testid="place-order">
              {phase.kind === "submitting" ? <><span className="spinner" /> Placing order…</> : "Place simulated order"}
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
