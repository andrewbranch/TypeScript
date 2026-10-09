import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
    existsSync,
    readFileSync,
} from "node:fs";
import { join } from "node:path";
import {
    artifactRoot,
    runtimeRoot,
} from "./config.mjs";

const archive = join(artifactRoot, "benchmark-runtime.tar.gz");
const expected = readFileSync(join(artifactRoot, "benchmark-runtime.sha256"), "utf8").split(/\s+/)[0];
const actual = createHash("sha256").update(readFileSync(archive)).digest("hex");
if (actual !== expected) throw new Error("Benchmark archive checksum mismatch");
function run(command, args, cwd) {
    const result = spawnSync(command, args, { cwd, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
}
if (process.env.API_BENCHMARK_ROOT) throw new Error("setup-benchmark.mjs extracts only the bundled fixture; unset API_BENCHMARK_ROOT");
if (existsSync(runtimeRoot)) throw new Error(`Runtime already exists: ${runtimeRoot}. Use npm ci --prefix that directory to reinstall dependencies`);
run("tar", ["-xzf", archive, "-C", artifactRoot], artifactRoot);
run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], runtimeRoot);
