import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dump — dumpster.photo",
    short_name: "Dump",
    description: "Throw every photo in. Find yourself. Gone in 72h.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f1eee4",
    theme_color: "#f1eee4",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
