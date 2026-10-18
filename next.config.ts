import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp", "mongodb", "pg", "onnxruntime-node"],
  experimental: {
    // middleware.ts runs on every request, uploads included, and Next only hands the route the
    // first 10MB of a body that passes through middleware. Videos are bigger than that, so the
    // form arrived cut off and never parsed. Allow the 150MB upload cap plus multipart overhead.
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
