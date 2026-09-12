import type { NextConfig } from "next";

const MARKDOWN_FILE = /\.md/;

const nextConfig: NextConfig = {
  cacheComponents: true,
  distDir: process.env.INSTANT_NAV_TEST === "1" ? ".next-instant" : ".next",
  experimental: {
    exposeTestingApiInProductionBuild: process.env.INSTANT_NAV_TEST === "1",
    staleTimes: { dynamic: 30 },
  },
  images: {
    unoptimized: true,
  },
  reactCompiler: true,
  serverExternalPackages: ["@mastra/*"],
  turbopack: {
    rules: {
      "*.md": {
        as: "*.js",
        loaders: ["raw-loader"],
      },
    },
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  webpack(config) {
    config.module.rules.push({
      test: MARKDOWN_FILE,
      type: "asset/source",
    });
    return config;
  },
};

export default nextConfig;
