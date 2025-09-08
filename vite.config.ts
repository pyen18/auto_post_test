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
        { src: "src/manifest.json", dest: "." }, // copy manifest from src to dist root
      ],
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "index.html"),
        contentScript: resolve(__dirname, "src/content/index.ts"),
        background: resolve(__dirname, "src/background/index.ts"),
        firebase: resolve(__dirname, "src/firebase/firebase.ts"),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === "contentScript") return "contentScript.js";
          if (chunk.name === "background") return "background.js";
          if (chunk.name === "firebase") return "firebase.js";
          return "[name].js";
        },
        chunkFileNames: "[name].js",
        assetFileNames: "[name].[ext]",
        format: "es",
      },
    },
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020", // Ensure compatibility with Chrome extensions
    minify: false, // Keep readable for debugging
  },
  esbuild: {
    target: "es2020",
  },
});
