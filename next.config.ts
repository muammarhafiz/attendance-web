import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      // beforeFiles: runs BEFORE filesystem routes. '/' has a real page (the staff home), so an
      // afterFiles rewrite would never fire for it — beforeFiles makes the host rewrite win.
      beforeFiles: [
        // The public customer tyre page is shared on tayar.zordaq.com. Serve it at the ROOT of that
        // host so the link is just https://tayar.zordaq.com. Only tayar.zordaq.com's root is affected.
        { source: "/", has: [{ type: "host", value: "tayar.zordaq.com" }], destination: "/tayar" },
      ],
    };
  },
};

export default nextConfig;
