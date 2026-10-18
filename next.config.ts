import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp", "mongodb", "pg", "onnxruntime-node"],
  experimental: {
    // Backstop for any other body that still passes through middleware. The upload route
    // itself is excluded from the matcher (see middleware.ts): raising this limit did not
    // stop Next from cloning video bodies and returning 500.
    middlewareClientMaxBodySize: "160mb",
  },
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
