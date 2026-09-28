import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@yarflam/potion-base-8m"],
  outputFileTracingIncludes: {
    "/*": ["./node_modules/@yarflam/potion-base-8m/models/**/*"],
  },
};
export default nextConfig;
