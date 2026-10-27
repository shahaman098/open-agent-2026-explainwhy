import { PageSkeleton } from "./PageSkeleton";

/** Route fallback before the client page can render its own data skeleton. */
export function LoadingScreen() {
  return <div className="normal-app skeleton-route"><main className="shell cr normal-dashboard dashboard"><PageSkeleton variant="section" label="Loading Normal dashboard" /></main></div>;
}
