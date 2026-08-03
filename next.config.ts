import type { NextConfig } from "next";

// cache-bust 2026-08-03: force a clean Turbopack rebuild so an edited globals.css
// (dark-mode <select> theming) is recompiled instead of restored from build cache.
const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
