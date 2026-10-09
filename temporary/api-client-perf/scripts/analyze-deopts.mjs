import { spawn } from "node:child_process";
import {
    createReadStream,
    writeFileSync,
} from "node:fs";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import {
    join,
    resolve,
} from "node:path";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import {
    outputRoot,
    repoRoot,
} from "./config.mjs";
const require = createRequire(import.meta.url);
const { processLogContent } = require("../tooling/node_modules/deoptigate");
if (!process.argv[2]) throw new Error("Usage: node analyze-deopts.mjs <v8.log[.gz|.xz]> [output.json]");
let input;
if (process.argv[2].endsWith(".xz")) {
    const child = spawn("xz", ["-dc", "--", process.argv[2]], { stdio: ["ignore", "pipe", "inherit"] });
    child.on("error", error => {
        throw error;
    });
    child.on("close", status => {
        if (status !== 0) throw new Error(`xz exited ${status}`);
    });
    input = child.stdout;
}
else {
    const stream = createReadStream(process.argv[2]);
    stream.on("error", error => {
        throw error;
    });
    input = process.argv[2].endsWith(".gz") ? stream.pipe(createGunzip()) : stream;
}
input.on("error", error => {
    throw error;
});
const lines = createInterface({ input, crlfDelay: Infinity });
let mapCounts = {};
let dictionaryCounts = {};
let mapExamples = {};
async function* selectedLines() {
    for await (const line of lines) {
        if (line.startsWith("map-details,")) {
            const name = /constructor: [^\n]*<JSFunction (\w+)/.exec(line)?.[1];
            if (name && ["TypeObject", "Symbol", "Signature", "RemoteNode", "RemoteNodeList", "NodeHandle"].includes(name)) {
                mapCounts[name] = (mapCounts[name] ?? 0) + 1;
                if (line.includes("dictionary_map")) dictionaryCounts[name] = (dictionaryCounts[name] ?? 0) + 1;
                mapExamples[name] = line.slice(0, 4000);
            }
        }
        if (/^(code-creation|code-move|code-delete|sfi-move|code-deopt|LoadIC|StoreIC|KeyedLoadIC|KeyedStoreIC|StoreInArrayLiteralIC),/.test(line)) {
            yield line.replace(/^code-creation,JS,/, "code-creation,LazyCompile,")
                .replace(/^((?:LoadIC|StoreIC|KeyedLoadIC|KeyedStoreIC|StoreInArrayLiteralIC),0x[0-9a-f]+),\d+,/, "$1,")
                .replaceAll("file://", "").replaceAll(",deopt-eager,", ",eager,")
                .replaceAll(",deopt-lazy,", ",lazy,").replaceAll(",get ", ",get_").replaceAll(",set ", ",set_")
                .replace(/,\^'?$/, ",").replace(/,\+'?$/, ",*");
        }
    }
}
const processor = await processLogContent(selectedLines(), repoRoot);
const result = processor.toObject();
const client = text => JSON.stringify(text).includes("/packages/typescript/dist/");
const summary = {
    counts: { deopts: result.deopts.length, ics: result.ics.length, codes: result.codes.length },
    clientDeopts: result.deopts.filter(client),
    clientICs: result.ics.filter(client),
    clientCodes: result.codes.filter(client),
    mapCounts,
    dictionaryCounts,
    mapExamples,
};
mkdirSync(outputRoot, { recursive: true });
writeFileSync(process.argv[3] ? resolve(process.argv[3]) : join(outputRoot, "deoptigate-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(
    {
        counts: summary.counts,
        clientDeopts: summary.clientDeopts,
        clientICCount: summary.clientICs.length,
        mapCounts,
        dictionaryCounts,
        icExamples: summary.clientICs.slice(0, 5),
    },
    null,
    2,
));
