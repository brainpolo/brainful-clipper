import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  manifest: {
    name: "brainful clipper",
    description: "clip links, media, and notes to brainful",
    version: "1.0.0",
    permissions: ["activeTab", "storage", "contextMenus", "notifications", "scripting"],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'none';",
    },
    icons: {
      16: "icons/icon-16.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    },
    host_permissions: [
      "https://brainful.one/*",
      "https://beta.brainful.one/*",
      "<all_urls>",
    ],
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
