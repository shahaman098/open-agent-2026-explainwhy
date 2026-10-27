import type { NextConfig } from "next";

const cloudflareBuild = process.env.EXPLAINWHY_CF_BUILD === "true";

const nextConfig: NextConfig = {
  distDir: process.env.EXPLAINWHY_NEXT_DIST_DIR ?? ".next",
  /* Composable cache / PPR break on the Workers runtime (OpenNext); disable for cf:build only. */
  cacheComponents: cloudflareBuild ? false : true,
  partialPrefetching: cloudflareBuild ? false : true,
};

export default nextConfig;
