import { defineConfig } from "tsup";

export default defineConfig([
  // CLI entry with shebang
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    target: "node22",
    outDir: "dist",
    clean: true,
    sourcemap: true,
    dts: false,
    splitting: false,
    banner: { js: "#!/usr/bin/env node" },
  },
  // Service entry without shebang
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    target: "node22",
    outDir: "dist",
    sourcemap: true,
    dts: false,
    splitting: false,
  },
]);
