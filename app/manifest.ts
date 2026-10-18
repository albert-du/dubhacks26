import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "dump — dumpster.photo",
    short_name: "dump",
    description: "One shared photo pile for your event. It burns after 24, 48 or 72 hours.",
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
