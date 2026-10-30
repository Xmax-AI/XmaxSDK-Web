import { defineConfig } from "tsup";
import { copyFile } from "node:fs/promises";

export default defineConfig({
  entry: { index: "src/index.ts" },
  outDir: "dist/browser",
  format: ["esm"],
  platform: "browser",
  target: "es2020",
  splitting: true,
  noExternal: [/.*/],
  minify: true,
  sourcemap: false,
  dts: false,
  clean: true,
  esbuildOptions(
    options
  ) {
    options.chunkNames = "chunks/[name]-[hash]";
  },
  async onSuccess() {
    await copyFile(
      "LICENSE",
      "dist/browser/LICENSE"
    );
  },
});
