import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    viteStaticCopy({
      targets: [
        { src: "public/manifest.json", dest: "." }, // copy manifest
        { src: "public/*", dest: "." }, // copy icons, images
      ],
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "index.html"),
        contentScript: resolve(__dirname, "src/content/index.ts"),
        background: resolve(__dirname, "src/background/index.js"),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === "contentScript") return "contentScript.js";
          if (chunk.name === "background") return "background.js";
          return "[name].js";
        },
        chunkFileNames: "[name].js",
        assetFileNames: "[name].[ext]",
        format: "es",
      },
    },
    outDir: "dist",
    emptyOutDir: true,
  },
});
