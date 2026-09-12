import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(new URL("../dist/", import.meta.url));
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(new URL("../public/", import.meta.url), output, { recursive: true });
await cp(new URL("../LICENSE", import.meta.url), new URL("../dist/LICENSE", import.meta.url));

await build({
  absWorkingDir: root,
  entryPoints: {
    "popup/index": "src/popup/index.ts",
    "background/service-worker": "src/background/service-worker.ts"
  },
  outdir: output,
  bundle: true,
  format: "esm",
  target: "chrome106",
  sourcemap: true,
  logLevel: "info"
});

await build({
  absWorkingDir: root,
  entryPoints: {
    "content/index": "src/content/index.ts",
    "platforms/netflix/page": "src/platforms/netflix/page.ts"
  },
  outdir: output,
  bundle: true,
  format: "iife",
  target: "chrome106",
  sourcemap: true,
  logLevel: "info"
});
