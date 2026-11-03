import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // npm workspaces hoist node_modules to the monorepo root, so trace from there.
  // The standalone server then sits at .next/standalone/apps/web/server.js.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  // The tune finder page became the landing page's microphone; old links land there.
  async redirects() {
    return [{ source: "/tunes/finder", destination: "/", permanent: true }];
  },
  serverExternalPackages: ["@yarflam/potion-base-8m"],
  outputFileTracingIncludes: {
    "/*": ["../../node_modules/@yarflam/potion-base-8m/models/**/*"],
  },
};
export default nextConfig;
