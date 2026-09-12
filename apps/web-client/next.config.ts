import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  reactCompiler: true,
  serverExternalPackages: ["@mastra/*"],
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
