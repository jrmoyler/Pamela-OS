import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pamela OS — A Cup of Compassion",
    short_name: "Pamela OS",
    description: "Everything for A Cup of Compassion in one place: people, pipelines, meetings, calls, campaigns, studios and RJ.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#6a1b9a",
    theme_color: "#6a1b9a",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    shortcuts: [
      { name: "Today", url: "/" },
      { name: "Approvals", url: "/approvals" },
      { name: "Record a meeting", url: "/meetings/new" },
      { name: "Ask RJ", url: "/rj" },
    ],
  };
}
