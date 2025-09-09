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
        { src: "src/pages/popup/index.html", dest: "popup" }, // copy popup HTML to dist/popup/
      ],
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        // Background script entry point
        background: resolve(__dirname, "src/background/index.ts"),
        // Content script entry point
        content: resolve(__dirname, "src/content/index.ts"),
        // Firebase utilities entry point
        firebase: resolve(__dirname, "src/firebase/firebase.ts"),
        // Popup script entry point
        "popup/main": resolve(__dirname, "src/pages/popup/main.tsx"),
      },
      output: {
        // Disable inlineDynamicImports to support multiple entry points
        inlineDynamicImports: false,
        entryFileNames: (chunk) => {
          // Background script
          if (chunk.name === "background") return "background.js";
          // Content script
          if (chunk.name === "content") return "content.js";
          // Firebase utilities
          if (chunk.name === "firebase") return "firebase.js";
          // Popup script
          if (chunk.name === "popup/main") return "popup/main.js";
          // Default pattern
          return "[name].js";
        },
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: (assetInfo) => {
          // Handle different asset types
          if (assetInfo.name?.endsWith('.css')) {
            return 'assets/[name].[ext]';
          }
          return 'assets/[name]-[hash].[ext]';
        },
        format: "es", // Use ES modules for code-splitting compatibility
        manualChunks: undefined
      },
    },
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020", // Ensure compatibility with Chrome extensions
    minify: false, // Keep readable for debugging
    // Disable sourcemaps for production builds
    sourcemap: false
  },
  esbuild: {
    target: "es2020",
  },
});
