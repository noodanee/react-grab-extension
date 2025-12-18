import { defineConfig } from "vite";
import path from "node:path";

type BuildTarget = "content" | "inject" | "background" | "popup";

const resolveTarget = (): BuildTarget => {
  const raw = process.env.TARGET;
  if (raw === "inject") return "inject";
  if (raw === "background") return "background";
  if (raw === "popup") return "popup";
  return "content";
};

const target = resolveTarget();

const entryByTarget: Record<BuildTarget, string> = {
  content: "src/content.ts",
  inject: "src/inject.ts",
  background: "src/background.ts",
  popup: "src/popup.ts",
};

const fileNameByTarget: Record<BuildTarget, string> = {
  content: "content.js",
  inject: "inject.js",
  background: "background.js",
  popup: "popup.js",
};

const entry = entryByTarget[target];
const fileName = fileNameByTarget[target];
const emptyOutDir = target === "content";

export default defineConfig({
  publicDir: "public",
  build: {
    target: "es2019",
    sourcemap: false,
    assetsDir: "",
    outDir: "dist",
    emptyOutDir,
    lib: {
      entry: path.resolve(__dirname, entry),
      formats: ["iife"],
      name: "ReactGrab",
      fileName: () => fileName,
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});
