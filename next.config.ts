import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // The public customer tyre page is shared on tayar.zordaq.com. Serve it at the ROOT of that
      // host so the link is just https://tayar.zordaq.com (the page otherwise lives at /tayar).
      // Host-scoped: only the root path on tayar.zordaq.com is affected; every other host/path is untouched.
      { source: "/", has: [{ type: "host", value: "tayar.zordaq.com" }], destination: "/tayar" },
    ];
  },
};

export default nextConfig;
