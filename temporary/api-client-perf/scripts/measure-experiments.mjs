import { spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    readFileSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    caseRoot as cwd,
    checkVariant,
    eslintCLI,
    outputRoot,
} from "./config.mjs";
import { verifyReport } from "./verify-report.mjs";
const directory = fileURLToPath(new URL(".", import.meta.url));
const variants = process.argv.slice(2);
if (!variants.length) variants.push("baseline", "scanner-pool", "bound-methods", "scanner-pool,bound-methods");
for (const variant of variants) checkVariant(variant);
if (variants[0] !== "baseline") throw new Error("List baseline first to establish the diagnostic and source reference");
const runs = Number(process.env.API_RUNS ?? 5);
if (!Number.isSafeInteger(runs) || runs < 1) throw new Error("API_RUNS must be a positive integer");
for (const flag of ["API_INSTRUMENT", "API_WIRE", "API_ALLOCATIONS", "API_TIMING"]) {
    if (process.env[flag] === "1") throw new Error(`Do not mix ${flag} with clean timing runs; use capture.mjs`);
}
mkdirSync(outputRoot, { recursive: true });
let expected;
let expectedSources;
const results = [];
function run(variant, index) {
    const prefix = join(outputRoot, `measure-${variant}-${index}`);
    for (const path of [`${prefix}-lint.json`, `${prefix}.json`]) {
        if (existsSync(path)) unlinkSync(path);
    }
    const started = performance.now();
    const result = spawnSync(process.execPath, [
        "--import",
        `${directory}profile-loader.mjs`,
        eslintCLI(),
        "src",
        "-f",
        "json",
        "-o",
        `${prefix}-lint.json`,
    ], {
        cwd,
        env: {
            ...process.env,
            TYPESCRIPT_ESLINT_NATIVE_BINARY: "",
            TSRS_NAPI: "",
            TSRS_BINARY: "",
            API_VARIANT: variant === "baseline" ? "" : variant,
            API_METRICS_OUTPUT: `${prefix}.json`,
        },
        encoding: "utf8",
    });
    if (result.error) throw result.error;
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.status !== 1) throw new Error(`${variant} exited ${result.status}: ${result.stderr}`);
    const digest = verifyReport(`${prefix}-lint.json`);
    expected ??= digest;
    if (digest !== expected) throw new Error(`${variant}: diagnostic mismatch`);
    const metrics = JSON.parse(readFileSync(`${prefix}.json`, "utf8"));
    expectedSources ??= metrics.sourceDigest;
    if (metrics.sourceDigest !== expectedSources) throw new Error(`${variant}: benchmark sources changed`);
    const row = {
        variant,
        index,
        wallMs: performance.now() - started,
        userMs: metrics.cpu.user / 1000,
        systemMs: metrics.cpu.system / 1000,
        maxRSSMiB: metrics.resourceUsage.maxRSS / 1024,
        heapUsedMiB: metrics.memory.heapUsed / 1048576,
        digest,
        sourceDigest: metrics.sourceDigest,
    };
    results.push(row);
    writeFileSync(join(outputRoot, `${process.env.API_RESULTS_NAME ?? "measure-results"}.json`), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(row));
}
for (const variant of variants) run(variant, "warmup");
for (let i = 0; i < runs; i++) {
    const order = i % 2 ? [...variants].reverse() : [...variants.slice(i % variants.length), ...variants.slice(0, i % variants.length)];
    for (const variant of order) run(variant, i);
}
for (const variant of variants) {
    const rows = results.filter(row => row.variant === variant && row.index !== "warmup");
    const median = key => {
        const values = rows.map(row => row[key]).sort((a, b) => a - b);
        const middle = Math.floor(values.length / 2);
        return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    };
    console.log(`${variant}: median wall ${median("wallMs").toFixed(1)} ms, user ${median("userMs").toFixed(1)} ms, system ${median("systemMs").toFixed(1)} ms, peak RSS ${median("maxRSSMiB").toFixed(1)} MiB`);
}
