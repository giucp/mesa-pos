import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.MESA_LOCAL_DIST || ".next",
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: ["@prisma/client", "prisma"],
  env: {
    MESA_ISOLATED_DEMO: process.env.MESA_ISOLATED_DEMO || "",
  },
  outputFileTracingIncludes: {
    "/**": [
      "./prisma/schema.prisma",
      "./prisma/schema.sqlite.prisma",
      "./prisma/migrations",
      "./prisma/mesa-demo.db",
      "./prisma/fase3-test-log.txt",
      "./prisma/fase3-isolated-note.json",
      "./prisma/fase4-evidence.json",
      "./prisma/fase6-evidence.json",
    ],
  },
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, no-cache, must-revalidate" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/app", destination: "/floor", permanent: false },
      { source: "/app/salon", destination: "/floor", permanent: false },
      { source: "/app/salon/:id", destination: "/table/:id", permanent: false },
      { source: "/app/caja", destination: "/floor", permanent: false },
      { source: "/app/caja/:id", destination: "/pay/:id", permanent: false },
      { source: "/app/cocina", destination: "/kds", permanent: false },
      { source: "/app/menu", destination: "/menu/admin", permanent: false },
      { source: "/app/reportes", destination: "/reports/day", permanent: false },
      { source: "/app/ajustes", destination: "/settings", permanent: false },
      { source: "/app/fiscal", destination: "/reports/day", permanent: false },
    ];
  },
};

export default nextConfig;
