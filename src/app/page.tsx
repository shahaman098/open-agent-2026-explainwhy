import Link from "next/link";
import { ExplainWhyLogo } from "@/components/explainwhy/ExplainWhyLogo";

export default function Home() {
  return (
    <div className="explainwhy-app explainwhy-standalone">
      <header className="topbar explainwhy-topbar">
        <div className="shell explainwhy-topbar-inner">
          <Link href="/" className="explainwhy-brand brand"><ExplainWhyLogo /></Link>
          <nav className="explainwhy-nav" aria-label="ExplainWhy Agent sections">
            <Link href="/" className="explainwhy-nav-link active" aria-current="page">Home</Link>
            <Link href="/dashboard" className="explainwhy-nav-link">Overview</Link>
            <Link href="/dev/simulator" className="explainwhy-nav-link">Control room</Link>
            <Link href="/dev/monitor" className="explainwhy-nav-link">Anomaly monitor</Link>
            <Link href="/demo-store" className="explainwhy-nav-link">Demo store</Link>
          </nav>
        </div>
      </header>
      <main className="shell home">
        <div style={{ display: "grid", gap: 16 }}>
          <span className="pill accent">Open Agent Hackathon 2026 · ExplainWhy</span>
          <h1>Evidence-backed operations investigation.</h1>
          <p className="lead">
            ExplainWhy Agent watches a business, detects operational problems, investigates likely causes and hands approved fixes to specialised agents.
            This build runs a digital twin of a Nike-style ecommerce operation so the whole loop can be exercised end to end.
          </p>
        </div>
        <div className="grid home-cards">
          <Link href="/dashboard" className="card">
            <span className="pill accent">Operations</span>
            <h2>Operations dashboard</h2>
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
    </div>
  );
}
