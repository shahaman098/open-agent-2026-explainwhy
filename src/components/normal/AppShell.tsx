"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { RunProvider, useRun } from "./run-context";
import { RunSelector } from "./RunSelector";
import { LoadingScreen } from "./LoadingScreen";

const NAV = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/signals", label: "Signals" },
  { href: "/dashboard/investigations", label: "Investigations" },
  { href: "/dashboard/approvals", label: "Approvals" },
  { href: "/dashboard/activity", label: "Activity" },
  { href: "/dashboard/outcomes", label: "Outcomes" },
];

function Shell({ children, title, hidePageHeading = false }: { children: ReactNode; title: string; hidePageHeading?: boolean }) {
  const pathname = usePathname();
  const { withRun, runId, unavailable, error } = useRun();
  return (
    <div className="normal-app">
      <header className="topbar normal-topbar"><div className="shell normal-topbar-inner">
        <Link href={withRun("/dashboard")} className="normal-brand brand" aria-label={`Normal · ${title}`}><Image className="normal-header-logo" src="/assets/Logo.svg" alt="" width={885} height={182} priority /></Link>
        <nav className="normal-nav" aria-label="Normal sections" data-testid="dashboard-nav">
          {NAV.map((n) => {
            const href = withRun(n.href);
            const active = pathname === n.href || (n.href !== "/dashboard" && pathname.startsWith(`${n.href}/`));
            return <Link key={n.href} href={href} className={`normal-nav-link ${active ? "active" : ""}`} aria-current={active ? "page" : undefined}>{n.label}</Link>;
          })}
        </nav>
        <div className="workspace normal-workspace"><span className="nike"><Image src="/assets/3ccd4.png" alt="" width={36} height={36} priority /></span><span className="normal-workspace-label"><strong>Nike</strong><small>Workspace</small></span><RunSelector /><span className="chevrons" aria-hidden="true">⌃<br />⌄</span></div>
      </div></header>
      <main className="shell cr normal-dashboard dashboard">
        {!hidePageHeading ? <div className="cr-head">
          <div><h1>{title}</h1><div className="muted small">Selected run · {runId ?? "No run selected"}</div></div>
        </div> : null}
        {unavailable ? <div className="alert error">The dashboard uses development/demo endpoints; it is only available in development or a configured demo mode.</div> : null}
        {error ? <div className="alert error">{error}</div> : null}
        {children}
      </main>
    </div>
  );
}

/** Unified app shell: navigation and run selection (URL `?run=`) for every dashboard page. */
export function AppShell({ children, title, hidePageHeading = false }: { children: ReactNode; title: string; hidePageHeading?: boolean }) {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <RunProvider><Shell title={title} hidePageHeading={hidePageHeading}>{children}</Shell></RunProvider>
    </Suspense>
  );
}
