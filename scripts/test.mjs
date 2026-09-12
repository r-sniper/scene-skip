import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const testFiles = (await readdir(new URL("../tests/", import.meta.url))).filter(file => file.endsWith(".test.ts"));
const compiledTestsDirectory = fileURLToPath(new URL("../.artifacts/tests/", import.meta.url));

await build({
  absWorkingDir: projectRoot,
  entryPoints: testFiles.map(file => `tests/${file}`),
  outdir: compiledTestsDirectory,
  bundle: true,
  external: ["esbuild"],
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: "inline"
});

const compiledTestPaths = testFiles.map(file => `${compiledTestsDirectory}/${file.replace(/\.ts$/, ".js")}`);
const testRun = spawnSync(process.execPath, ["--test", ...compiledTestPaths], { stdio: "inherit" });
if (testRun.error) throw testRun.error;
if (testRun.status === null) throw new Error(`Test process terminated by ${testRun.signal}.`);
process.exitCode = testRun.status;
