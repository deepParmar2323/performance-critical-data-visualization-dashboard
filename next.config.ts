import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack is the default bundler in Next.js 16.
  // An empty turbopack config confirms we're using it intentionally.
  // Web Workers are instantiated with `new Worker(new URL(...), { type: 'module' })`
  // which Turbopack handles natively — no special configuration required.
  turbopack: {},
};

export default nextConfig;
