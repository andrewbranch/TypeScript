import {
    readFileSync,
    writeFileSync,
} from "node:fs";
const profile = JSON.parse(readFileSync(process.argv[2], "utf8"));
const self = new Map();
const inclusive = new Map();
let total = 0;
function visit(node, stack = []) {
    const frame = node.callFrame;
    const key = `${frame.functionName || "(anonymous)"} ${frame.url}:${frame.lineNumber + 1}`;
    total += node.selfSize;
    self.set(key, (self.get(key) ?? 0) + node.selfSize);
    stack = [...stack, key];
    for (const key of new Set(stack)) inclusive.set(key, (inclusive.get(key) ?? 0) + node.selfSize);
    for (const child of node.children) visit(child, stack);
}
visit(profile.head);
const table = (map, n) =>
    [...map].sort((a, b) => b[1] - a[1]).slice(0, n)
        .map(([key, size]) => `${(size / 1048576).toFixed(2).padStart(9)} MiB ${(size / total * 100).toFixed(2).padStart(6)}% ${key}`).join("\n");
const output = `Sampled bytes ${total}\n\nSelf\n${table(self, 40)}\n\nSelf client\n${table(new Map([...self].filter(([key]) => key.includes("/packages/typescript/dist/"))), 40)}\n\nInclusive client\n${table(new Map([...inclusive].filter(([key]) => key.includes("/packages/typescript/dist/"))), 30)}`;
console.log(output);
if (process.argv[3]) writeFileSync(process.argv[3], output);
