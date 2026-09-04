import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output is for Docker deployments only; Vercel handles its own serverless output
  ...(process.env.DOCKER_BUILD === "1" || process.env.STANDALONE === "1" ? { output: "standalone" } : {}),
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;