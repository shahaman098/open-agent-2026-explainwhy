import type { ReactNode } from "react";

type Variant = "overview" | "section" | "workspace" | "pipeline" | "panel" | "catalogue" | "campaign";

function Line({ width = "100%", tall = false }: { width?: string; tall?: boolean }) {
  return <div className={`skeleton-block${tall ? " skeleton-block-tall" : ""}`} style={{ width }} />;
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`skeleton-card ${className}`} aria-hidden="true">{children}</div>;
}

export function PageSkeleton({ variant = "section", label = "Loading page data" }: { variant?: Variant; label?: string }) {
  if (variant === "overview") return <div className="normal-overview" role="status" aria-label={label} data-testid="page-skeleton">
    <div className="layout normal-overview-grid page-skeleton skeleton-overview">
      <section className="left-column top-column"><Card className="card risk-card skeleton-risk"><Line width="52%" tall /><div className="skeleton-gauge" /><Line width="70%" /></Card></section>
      <section className="right-column top-column"><Card className="card signals-card top-signals-card skeleton-signals"><Line width="37%" tall />{[0, 1, 2].map((n) => <div className="skeleton-list-row" key={n}><Line width="12%" /><div><Line width="82%" /><Line width="58%" /></div></div>)}</Card></section>
      <section className="left-column bottom-column"><Card className="card revenue-card skeleton-revenue"><Line width="48%" tall /><Line width="66%" tall /><div className="skeleton-chart">{[42, 66, 54, 82, 72, 90, 60].map((height, n) => <div className="skeleton-bar" style={{ height: `${height}%` }} key={n} />)}</div></Card></section>
      <section className="right-column bottom-column">
        <Card className="card metric-card skeleton-metrics"><div className="skeleton-stat-grid">{[0, 1, 2, 3].map((n) => <div key={n}><Line width="70%" /><Line width="48%" tall /></div>)}</div></Card>
        <Card className="card activity-card skeleton-activity"><Line width="52%" tall />{[0, 1, 2, 3].map((n) => <div className="skeleton-list-row" key={n}><Line width="10%" /><div><Line width="80%" /><Line width="60%" /></div></div>)}</Card>
        <Card className="card campaign-card skeleton-campaigns"><Line width="75%" tall /><div className="skeleton-campaign-images">{[0, 1, 2].map((n) => <div className="skeleton-image" key={n}><Line width="55%" /><Line width="78%" tall /></div>)}</div></Card>
      </section>
    </div>
  </div>;

  if (variant === "catalogue") return <div className="page-skeleton skeleton-catalogue" role="status" aria-label={label} data-testid="page-skeleton">
    {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => <Card key={n}><div className="skeleton-product-image" /><Line width="72%" tall /><Line width="45%" /></Card>)}
  </div>;

  if (variant === "campaign") return <div className="page-skeleton skeleton-campaign-page" role="status" aria-label={label} data-testid="page-skeleton">
    <Card><Line width="55%" tall /><Line width="32%" /></Card>
    <div className="skeleton-stat-grid">{[0, 1, 2, 3].map((n) => <Card key={n}><Line width="68%" /><Line width="46%" tall /></Card>)}</div>
    <Card><Line width="30%" tall />{[0, 1, 2, 3, 4].map((n) => <div className="skeleton-table-row" key={n}><Line width="36%" /><Line width="18%" /><Line width="22%" /></div>)}</Card>
  </div>;

  if (variant === "panel") return <div className="page-skeleton skeleton-panel" role="status" aria-label={label} data-testid="page-skeleton"><Card><Line width="38%" tall /><Line width="92%" /><Line width="74%" /><div className="skeleton-table-row"><Line width="22%" /><Line width="42%" /><Line width="20%" /></div></Card></div>;

  return <div className={`page-skeleton skeleton-${variant}`} role="status" aria-label={label} data-testid="page-skeleton">
    <Line width="54%" />
    {variant !== "pipeline" ? <div className="skeleton-stat-grid">{[0, 1, 2, 3].map((n) => <Card key={n}><Line width="68%" /><Line width="43%" tall /></Card>)}</div> : null}
    <Card><Line width="37%" tall />{[0, 1, 2, 3, 4].map((n) => <div className="skeleton-table-row" key={n}><Line width="35%" /><Line width="22%" /><Line width="16%" /></div>)}</Card>
    {variant === "workspace" || variant === "pipeline" ? <Card><Line width="42%" tall /><Line width="84%" /><Line width="66%" /><Line width="75%" /></Card> : null}
  </div>;
}
