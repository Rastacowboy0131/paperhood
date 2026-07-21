import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PaperHood",
    short_name: "PaperHood",
    description: "Paper trading terminal for Robinhood Chain",
    start_url: "/",
    display: "standalone",
    background_color: "#0e1013",
    theme_color: "#0e1013",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
