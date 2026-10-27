"use client";

import type { ReactNode } from "react";

/**
 * Explicit placeholder for a capability that is not implemented yet. It states the expected contract and never
 * pretends to show activity; any controls inside are disabled by design.
 */
export function CapabilityPlaceholder({ title, status, description, inputs, outputs, contracts, children, testId }: {
  title: string; status: "Not implemented" | "Partner integration pending"; description: string; inputs: string[]; outputs: string[]; contracts: string[]; children?: ReactNode; testId?: string;
}) {
  return (
    <div className="card" data-testid={testId} data-capability-status={status}>
      <div className="card-head"><h3>{title}</h3><span className="pill warn">{status}</span></div>
      <div className="card-body" style={{ display: "grid", gap: 8 }}>
        <span className="small">{description}</span>
        <div className="grid two">
          <div><div className="muted small">Expected input</div><ul className="small" style={{ margin: "4px 0 0 16px" }}>{inputs.map((i) => <li key={i}>{i}</li>)}</ul></div>
          <div><div className="muted small">Expected output</div><ul className="small" style={{ margin: "4px 0 0 16px" }}>{outputs.map((o) => <li key={o}>{o}</li>)}</ul></div>
        </div>
        <span className="muted small">Canonical contracts: {contracts.map((c, i) => <code key={c}>{i ? ", " : ""}{c}</code>)} in <code>packages/contracts</code>.</span>
        {children}
      </div>
    </div>
  );
}
