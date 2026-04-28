import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TQQQ Strategy",
    short_name: "TQQQ",
    description: "Schwab account holdings tracker",
    start_url: "/",
    display: "standalone",
    background_color: "#1a1b1e",
    theme_color: "#1a1b1e",
    orientation: "portrait",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
