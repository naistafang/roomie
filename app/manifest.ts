import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Roomie",
    short_name: "Roomie",
    description: "Private property and booking calendar",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f7fb",
    theme_color: "#607b9c",
    icons: [
      { src: "https://roomie-icon-miru.myla0319.chatgpt.site/roomie-icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
