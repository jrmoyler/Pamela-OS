import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  // Migrations are applied at boot, so they must ship with every serverless function.
  outputFileTracingIncludes: { "/**": ["./drizzle/**"] },
  experimental: { serverActions: { bodySizeLimit: "200mb" } },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
