import { spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    readFileSync,
    statSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    caseRoot,
    checkVariant,
    eslintCLI,
    outputRoot,
} from "./config.mjs";
import { verifyReport } from "./verify-report.mjs";

const [mode, variant = "baseline"] = process.argv.slice(2);
if (!["cpu", "allocations", "wire", "counters", "deopts", "maps"].includes(mode)) throw new Error("Usage: node capture.mjs <cpu|allocations|wire|counters|deopts|maps> [variant]");
checkVariant(variant);
mkdirSync(outputRoot, { recursive: true });
const name = `${mode}-${variant}`;
const prefix = join(outputRoot, name);
const flags = [];
const env = {
    ...process.env,
    TYPESCRIPT_ESLINT_NATIVE_BINARY: "",
    TSRS_NAPI: "",
    TSRS_BINARY: "",
    API_VARIANT: variant === "baseline" ? "" : variant,
    API_INSTRUMENT: ["allocations", "wire", "counters"].includes(mode) ? "1" : "0",
    API_WIRE: mode === "wire" ? "1" : "0",
    API_COMPACT_ESTIMATE: mode === "wire" ? "1" : "0",
    API_TIMING: mode === "wire" ? "1" : "0",
    API_TIMING_OUTPUT: `${prefix}-timing.json`,
    API_ALLOCATIONS: mode === "allocations" ? "1" : "0",
    API_ALLOCATIONS_OUTPUT: `${prefix}.heapprofile`,
    API_METRICS_OUTPUT: `${prefix}-metrics.json`,
};
if (mode === "cpu") flags.push("--cpu-prof", `--cpu-prof-dir=${outputRoot}`, `--cpu-prof-name=${name}.cpuprofile`);
if (mode === "deopts" || mode === "maps") {
    flags.push("--log-code", "--log-ic", "--log-deopt", "--log-source-code", "--log-source-position", "--trace-file-names", "--no-logfile-per-isolate", `--logfile=${prefix}-v8.log`);
    if (mode === "maps") flags.push("--log-maps");
}
const outputs = [`${prefix}-lint.json`, `${prefix}-metrics.json`];
if (mode === "cpu") outputs.push(`${prefix}.cpuprofile`);
if (mode === "allocations") outputs.push(`${prefix}.heapprofile`);
if (mode === "wire") outputs.push(`${prefix}-timing.json`);
if (mode === "deopts" || mode === "maps") outputs.push(`${prefix}-v8.log`);
for (const path of outputs) {
    if (existsSync(path)) unlinkSync(path);
}
const result = spawnSync(process.execPath, [
    ...flags,
    "--import",
    fileURLToPath(new URL("./profile-loader.mjs", import.meta.url)),
    eslintCLI(),
    "src",
    "-f",
    "json",
    "-o",
    `${prefix}-lint.json`,
], { cwd: caseRoot, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
writeFileSync(`${prefix}-trace.txt`, `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
if (result.error) throw result.error;
if (result.status !== 1) throw new Error(`ESLint exited ${result.status}; see ${prefix}-trace.txt`);
for (const path of outputs) {
    if (!existsSync(path) || statSync(path).size === 0) throw new Error(`Missing or empty capture output: ${path}`);
}
const digest = verifyReport(`${prefix}-lint.json`);
const metrics = JSON.parse(readFileSync(`${prefix}-metrics.json`, "utf8"));
console.log(JSON.stringify({ mode, variant, digest, sourceDigest: metrics.sourceDigest, output: prefix }, null, 2));
