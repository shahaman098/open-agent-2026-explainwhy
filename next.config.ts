import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NORMAL_NEXT_DIST_DIR ?? ".next",
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
