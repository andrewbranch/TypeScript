import { spawnSync } from "node:child_process";
import {
    cpSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import {
    basename,
    dirname,
    join,
    resolve,
} from "node:path";
import { runtimeRoot } from "./config.mjs";

const [checkoutArg, caseArg, frozenArg] = process.argv.slice(2);
if (!checkoutArg || !caseArg) throw new Error("Usage: node snapshot-benchmark.mjs <adapter-checkout> <benchmark-case> [frozen-estree-dist]");
const checkout = resolve(checkoutArg);
const benchmark = resolve(caseArg);
if (existsSync(runtimeRoot)) throw new Error(`Snapshot destination already exists: ${runtimeRoot}`);
const json = path => JSON.parse(readFileSync(path, "utf8"));
const writeJSON = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
const packages = new Map();
for (const directory of readdirSync(join(checkout, "packages"))) {
    const path = join(checkout, "packages", directory);
    if (existsSync(join(path, "package.json"))) {
        const manifest = json(join(path, "package.json"));
        packages.set(manifest.name, { path, manifest });
    }
}
function installedVersion(name, from) {
    let directory = dirname(createRequire(join(from, "package.json")).resolve(name));
    while (true) {
        const path = join(directory, "package.json");
        if (existsSync(path)) {
            const manifest = json(path);
            if (manifest.version) return manifest.version;
        }
        const parent = dirname(directory);
        if (parent === directory) throw new Error(`Cannot locate installed version of ${name} from ${from}`);
        directory = parent;
    }
}
mkdirSync(join(runtimeRoot, "packages"), { recursive: true });
const captured = new Set();
function capture(name) {
    if (captured.has(name)) return;
    const entry = packages.get(name);
    if (!entry) throw new Error(`Missing workspace package: ${name}`);
    captured.add(name);
    const { path, manifest: original } = entry;
    const manifest = { ...original };
    for (const field of ["scripts", "devDependencies", "packageManager", "nx", "pnpm"]) delete manifest[field];
    for (const field of ["dependencies", "optionalDependencies"]) {
        if (!manifest[field]) continue;
        manifest[field] = { ...manifest[field] };
        for (const dependency of Object.keys(manifest[field])) {
            if (packages.has(dependency)) {
                manifest[field][dependency] = packages.get(dependency).manifest.version;
                capture(dependency);
            }
            else {
                manifest[field][dependency] = installedVersion(dependency, path);
            }
        }
        if (manifest.peerDependencies) {
            manifest.peerDependencies = { ...manifest.peerDependencies };
            for (const [dependency, range] of Object.entries(manifest.peerDependencies)) {
                if (range.startsWith("workspace:")) {
                    if (!packages.has(dependency)) throw new Error(`Missing peer workspace: ${dependency}`);
                    manifest.peerDependencies[dependency] = packages.get(dependency).manifest.version;
                    capture(dependency);
                }
            }
        }
    }
    const destination = join(runtimeRoot, "packages", basename(path));
    mkdirSync(destination);
    const dist = name === "@typescript-eslint/typescript-estree" && frozenArg ? resolve(frozenArg) : join(path, "dist");
    cpSync(dist, join(destination, "dist"), { recursive: true });
    cpSync(join(checkout, "LICENSE"), join(destination, "LICENSE"));
    writeJSON(join(destination, "package.json"), manifest);
}
capture("typescript-eslint");
const destination = join(runtimeRoot, "cases", basename(benchmark));
mkdirSync(destination, { recursive: true });
for (const name of ["src", "eslint.config.js", "tsconfig.json"]) cpSync(join(benchmark, name), join(destination, name), { recursive: true });
writeJSON(join(destination, "package.json"), { name: "recommended-rules-fixture", private: true, type: "module" });
cpSync(join(checkout, "LICENSE"), join(runtimeRoot, "LICENSE-typescript-eslint"));
cpSync(resolve(benchmark, "../../LICENSE.md"), join(runtimeRoot, "LICENSE-performance.md"));
writeJSON(join(runtimeRoot, "package.json"), {
    name: "api-client-perf-benchmark",
    private: true,
    type: "module",
    workspaces: ["packages/*"],
    dependencies: Object.fromEntries(["eslint", "@eslint/js", "typescript"].map(name => [name, installedVersion(name, benchmark)])),
    engines: { node: ">=24.18.0" },
});
function revision(path) {
    const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: path, encoding: "utf8" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
}
writeJSON(join(runtimeRoot, "provenance.json"), {
    adapterRevision: revision(checkout),
    performanceRevision: revision(benchmark),
    packages: [...captured].sort(),
    frozenEstree: Boolean(frozenArg),
    note: "Compiled local runtime snapshot, not a clean checkout build. Manifests omit development-only dependencies/scripts and pin installed runtime dependencies. Frozen estree includes local adapter changes; see handoff README.",
});
console.log(`Captured ${captured.size} workspace packages and ${basename(benchmark)} into ${runtimeRoot}`);
