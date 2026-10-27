import Link from "next/link";

export default function Home() {
  return (
    <>
      <main className="shell home">
        <div style={{ display: "grid", gap: 16 }}>
          <span className="pill accent">Normal · Mubit Night Shift</span>
          <h1>Making seamless operations the new normal.</h1>
          <p className="lead">
            Normal watches a business, detects operational problems, investigates likely causes and hands approved fixes to specialised agents.
            This build runs a digital twin of a Nike-style ecommerce operation so the whole loop can be exercised end to end.
          </p>
        </div>
        <div className="grid home-cards">
          <Link href="/dashboard" className="card">
            <span className="pill accent">Operations</span>
            <h2>Normal dashboard</h2>
            <p className="muted">One place to follow the pipeline — metrics, monitoring health, detected incidents, autonomous evidence retrieval and what is still to come.</p>
          </Link>
          <Link href="/demo-store" className="card">
            <span className="pill">Shopper view</span>
            <h2>Demo store</h2>
            <p className="muted">Browse real Nike product names at their public list prices and complete a synthetic purchase that changes inventory and revenue in the twin.</p>
          </Link>
          <Link href="/dev/simulator" className="card">
            <span className="pill">Operator view</span>
            <h2>Business control room</h2>
            <p className="muted">Advance virtual time, inject incidents such as ad fatigue or delivery delays, and watch metrics computed from the canonical event ledger.</p>
          </Link>
        </div>
      </main>
    </>
  );
}
