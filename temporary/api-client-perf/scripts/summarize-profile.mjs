import { readFileSync } from "node:fs";

const profile = JSON.parse(readFileSync(process.argv[2], "utf8"));
const nodes = new Map(profile.nodes.map(node => [node.id, node]));
const parents = new Map();
for (const node of profile.nodes) {
    for (const child of node.children ?? []) parents.set(child, node.id);
}
const self = new Map();
const inclusive = new Map();
const categories = new Map();
const key = frame => `${frame.functionName || "(anonymous)"} ${frame.url}:${frame.lineNumber + 1}`;
let total = 0;
for (let i = 0; i < profile.samples.length; i++) {
    const delta = profile.timeDeltas[i] / 1000;
    total += delta;
    const node = nodes.get(profile.samples[i]);
    const label = key(node.callFrame);
    self.set(label, (self.get(label) ?? 0) + delta);
    const seen = new Set();
    const stack = [];
    for (let id = node.id; id !== undefined; id = parents.get(id)) {
        const frame = nodes.get(id).callFrame;
        stack.push(frame);
        const label = key(frame);
        if (!seen.has(label)) inclusive.set(label, (inclusive.get(label) ?? 0) + delta);
        seen.add(label);
    }
    const url = node.callFrame.url;
    const category = node.callFrame.functionName === "(garbage collector)" ? "GC"
        : url.includes("syncChannel.js") || stack.some(frame => frame.functionName === "fillReadBuffer" || frame.functionName === "writeAllBuf") ? "Transport (includes blocking I/O)"
        : url.includes("/packages/typescript/dist/") ? "API client"
        : url.includes("/typescript-eslint/") || /\/runtime\/packages\/(?:typescript-eslint|typescript-estree|eslint-plugin|parser|utils|type-utils|scope-manager|types|visitor-keys|project-service|tsconfig-utils)\//.test(url) ? "typescript-eslint"
        : url.startsWith("node:") ? "Node builtins"
        : url.includes("eslint") ? "ESLint"
        : "Other";
    categories.set(category, (categories.get(category) ?? 0) + delta);
}
function table(map, limit) {
    return [...map].sort((a, b) => b[1] - a[1]).slice(0, limit)
        .map(([label, ms]) => `${ms.toFixed(1).padStart(9)} ms ${(ms / total * 100).toFixed(2).padStart(6)}% ${label}`).join("\n");
}
console.log(`Sampled wall time: ${total.toFixed(1)} ms`);
console.log("\nCategories\n" + table(categories, 20));
console.log("\nSelf\n" + table(self, 50));
console.log("\nInclusive client\n" + table(new Map([...inclusive].filter(([label]) => label.includes("/packages/typescript/dist/"))), 50));
console.log("\nSelf client\n" + table(new Map([...self].filter(([label]) => label.includes("/packages/typescript/dist/"))), 50));
