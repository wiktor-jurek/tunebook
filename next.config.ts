import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // The tune finder page became the landing page's microphone; old links land there.
  async redirects() {
    return [{ source: "/tunes/finder", destination: "/", permanent: true }];
  },
  serverExternalPackages: ["@yarflam/potion-base-8m"],
  outputFileTracingIncludes: {
    "/*": ["./node_modules/@yarflam/potion-base-8m/models/**/*"],
  },
};
export default nextConfig;
