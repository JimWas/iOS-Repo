import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.STANDALONE_EXPORT === "1" ? "export" : undefined,
};

export default nextConfig;
