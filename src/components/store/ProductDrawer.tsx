"use client";

import { useEffect, useState } from "react";
import { CATEGORY_LABEL, money, shortDate } from "@/lib/format";
import { mark, stockClass, stockLabel } from "@/components/store/ProductCard";
import type { StoreProduct } from "@/components/store/types";

export function ProductDrawer({ product, onClose, onAdd }: { product: StoreProduct; onClose: () => void; onAdd: (productId: string, quantity: number) => void }) {
  const [qty, setQty] = useState(1);
  const max = Math.min(5, product.availableUnits);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={product.name} data-testid="product-drawer">
        <div className="drawer-head">
          <h2>{product.name}</h2>
          <button className="btn sm" onClick={onClose}>Close</button>
        </div>
        <div className="drawer-body">
          <div className={`tile ${product.category}`} style={{ borderRadius: 12, aspectRatio: "1 / 0.6" }}>
            <span className="mark" aria-hidden>{mark(product.name)}</span>
            <span className="cat">{CATEGORY_LABEL[product.category]}</span>
          </div>
          <div>
            <div className="muted">{product.subtitle}</div>
            <div className="total" style={{ marginTop: 6 }}><span>{money(product.priceMinor)}</span><span className={`stock ${stockClass(product.availableUnits)}`}>{stockLabel(product.availableUnits)}</span></div>
          </div>
          {product.reference?.description ? <p style={{ fontSize: 14, color: "var(--ink-2)" }}>{product.reference.description}</p> : null}
          <div className="provenance">
            <strong style={{ color: "var(--ink-2)" }}>Where this comes from</strong>
            <span>Name and {product.priceOrigin === "official_public_list_price" ? "list price are public references" : "price are synthetic placeholders"}{product.reference ? <> observed on <a href={product.reference.sourceUrl} target="_blank" rel="noreferrer noopener">nike.com/gb</a> on {shortDate(product.reference.retrievedAt)}{product.reference.styleCode ? ` (style ${product.reference.styleCode})` : ""}</> : null}.</span>
            <span>Stock level, sales and reviews are simulated by Normal and are not Nike data.</span>
          </div>
          <label className="field">Quantity
            <div className="qty">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease quantity">−</button>
              <span>{qty}</span>
              <button onClick={() => setQty((q) => Math.min(max, q + 1))} aria-label="Increase quantity" disabled={qty >= max}>+</button>
            </div>
          </label>
        </div>
        <div className="drawer-foot">
          <button className="btn primary block" disabled={product.availableUnits <= 0 || !product.active} onClick={() => onAdd(product.productId, qty)} data-testid="add-to-cart">
            {product.availableUnits <= 0 ? "Sold out" : `Add ${qty} to cart · ${money(product.priceMinor * qty)}`}
          </button>
        </div>
      </aside>
    </>
  );
}
