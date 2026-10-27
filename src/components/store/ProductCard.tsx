"use client";

import { CATEGORY_LABEL, money } from "@/lib/format";
import type { StoreProduct } from "@/components/store/types";

export function stockClass(units: number): "out" | "low" | "ok" {
  return units <= 0 ? "out" : units <= 10 ? "low" : "ok";
}
export function stockLabel(units: number): string {
  return units <= 0 ? "Sold out" : units <= 10 ? `Only ${units} left` : `${units} in stock`;
}
export function mark(name: string): string {
  const words = name.replace(/^Nike\s+/i, "").split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

export function ProductCard({ product, onOpen }: { product: StoreProduct; onOpen: () => void }) {
  const cls = stockClass(product.availableUnits);
  return (
    <button className="product" onClick={onOpen} data-testid={`product-${product.productId}`} aria-label={`${product.name}, ${money(product.priceMinor)}`}>
      <div className={`tile ${product.category}`}>
        <span className="mark" aria-hidden>{mark(product.name)}</span>
        <span className="cat">{CATEGORY_LABEL[product.category] ?? product.category}</span>
      </div>
      <div className="info">
        <span className="name">{product.name}</span>
        <span className="sub">{product.subtitle}</span>
        <div className="price-row">
          <span className="price">{money(product.priceMinor)}</span>
          <span className={`stock ${cls}`}>{stockLabel(product.availableUnits)}</span>
        </div>
      </div>
    </button>
  );
}
