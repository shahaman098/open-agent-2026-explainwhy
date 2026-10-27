import { PageSkeleton } from "./PageSkeleton";

/** Route fallback before the client page can render its own data skeleton. */
export function LoadingScreen() {
  return <div className="explainwhy-app skeleton-route"><main className="shell cr explainwhy-dashboard dashboard"><PageSkeleton variant="section" label="Loading ExplainWhy Agent dashboard" /></main></div>;
}
