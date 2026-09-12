import type { NextConfig } from "next";

const MARKDOWN_FILE = /\.md/;

const nextConfig: NextConfig = {
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
