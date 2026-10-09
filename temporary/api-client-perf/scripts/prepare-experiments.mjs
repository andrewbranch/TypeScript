import {
    mkdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import {
    generatedRoot,
    repoRoot,
} from "./config.mjs";

const root = `${repoRoot}/packages/typescript/dist/`;
mkdirSync(generatedRoot, { recursive: true });
const read = path => readFileSync(root + path, "utf8");
const write = (name, text) => writeFileSync(join(generatedRoot, `${name}.js`), text);
function replaceOnce(text, from, to) {
    if (!text.includes(from) || text.indexOf(from) !== text.lastIndexOf(from)) throw new Error(`Expected exactly one occurrence: ${from}`);
    return text.replace(from, to);
}
const nav = read("ast/astnav.js");
const scannerExpression = "createScanner(/*skipTrivia*/ true, sourceFile.languageVariant, sourceFile.text)";
const start = nav.indexOf("function createChildren(node, sourceFile) {");
if (start < 0 || !nav.includes(`const scanner = ${scannerExpression};`, start)) throw new Error("Unexpected scanner source");
let pool = nav.replace(
    "function createChildren(node, sourceFile) {",
    `const scannerPools = new WeakMap();
function createChildren(node, sourceFile) {
    let pool = scannerPools.get(sourceFile);
    if (!pool) scannerPools.set(sourceFile, pool = []);
    const scanner = pool.pop() ?? ${scannerExpression};
    try {
        return createChildrenWithScanner(node, sourceFile, scanner);
    }
    finally {
        pool.push(scanner);
    }
}
function createChildrenWithScanner(node, sourceFile, scanner) {`,
);
const scannerPos = pool.indexOf(`const scanner = ${scannerExpression};`, pool.indexOf("function createChildrenWithScanner"));
pool = pool.slice(0, scannerPos) + pool.slice(scannerPos + `const scanner = ${scannerExpression};`.length);
write("scanner-pool", pool);

write("pooled-buffers", replaceOnce(read("api/syncChannel.js"), "Buffer.allocUnsafeSlow(length)", "Buffer.allocUnsafe(length)"));

let handles = read("api/node/node.js");
handles = replaceOnce(
    handles,
    "export function parseNodeHandleFromCompiler(handle) {",
    `const parsedHandleCache = new Map();
export function parseNodeHandleFromCompiler(handle) {
    const cached = parsedHandleCache.get(handle);
    if (cached !== undefined) return { ...cached };
    const parsed = parseUncachedNodeHandle(handle);
    parsedHandleCache.set(handle, parsed);
    return { ...parsed };
}
function parseUncachedNodeHandle(handle) {`,
);
write("handle-cache", handles);

let strings = read("api/node/node.generated.js");
strings = replaceOnce(
    strings,
    "    getString(index) {",
    `    getString(index) {
        let cache = decodedStringCaches.get(this.sourceFile);
        if (!cache) decodedStringCaches.set(this.sourceFile, cache = []);
        let value = cache[index];
        if (value === undefined) {
            value = this.decodeString(index);
            cache[index] = value;
        }
        return value;
    }
    decodeString(index) {`,
);
if (!strings.includes("decodeString(index)")) throw new Error("Missing getString");
write("string-cache", "const decodedStringCaches = new WeakMap();\n" + strings);

const api = read("api/sync/api.js");
const ast = ts.createSourceFile("api.js", api, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const edits = [];
const boundEdits = [];
const hoisted = [];
const namedMethods = [];
for (const statement of ast.statements) {
    if (!ts.isClassDeclaration(statement)) continue;
    for (const member of statement.members) {
        if (!ts.isGetAccessorDeclaration(member) || !member.body || !member.body.getText(ast).includes("cacheGeneratorMethod(")) continue;
        const name = member.name.getText(ast);
        edits.push({ start: member.body.getStart(ast) + 1, end: member.body.getStart(ast) + 1, text: `\nconst cached = getCachedGeneratorMethod(this, ${JSON.stringify(name)}); if (cached) return cached;\n` });
        const returned = member.body.statements.at(-1);
        if (!ts.isReturnStatement(returned) || !returned.expression || !ts.isCallExpression(returned.expression)) throw new Error(`Unexpected getter return: ${name}`);
        const call = returned.expression;
        if (call.expression.getText(ast) !== "cacheGeneratorMethod" || call.arguments.length !== 4) throw new Error(`Unexpected cacheGeneratorMethod: ${name}`);
        const sync = call.arguments[2];
        const gen = call.arguments[3];
        if (ts.isIdentifier(sync) && ts.isIdentifier(gen)) {
            namedMethods.push(name);
            continue;
        }
        if (member.body.statements.length !== 2) throw new Error(`Unexpected inline getter body: ${name}`);
        if (!ts.isFunctionExpression(sync) || !ts.isFunctionExpression(gen)) throw new Error(`Unexpected method functions: ${name}`);
        for (const [kind, fn] of [["sync", sync], ["gen", gen]]) {
            const sharedName = `shared_${statement.name.text}_${name}_${kind}`;
            const parameters = fn.parameters.map(parameter => parameter.getText(ast).replaceAll(/\bowner\b/g, "this")).join(", ");
            const body = fn.body.getText(ast);
            hoisted.push(`function${fn.asteriskToken ? "*" : ""} ${sharedName}(${parameters}) {\nconst owner = this;\n${body.slice(1, -1)}\n}`);
            boundEdits.push({ start: fn.getStart(ast), end: fn.end, text: `${sharedName}.bind(owner)` });
        }
    }
}
let sidecar = api;
for (const edit of edits.sort((a, b) => b.start - a.start)) sidecar = sidecar.slice(0, edit.start) + edit.text + sidecar.slice(edit.end);
if (!edits.length || boundEdits.length / 2 + namedMethods.length !== edits.length) throw new Error("Incomplete generator-method transformation");
sidecar = replaceOnce(sidecar, "cacheGeneratorMethod,", "cacheGeneratorMethod,\ngetCachedGeneratorMethod,");
write("method-sidecar-api", sidecar);
let support = read("api/sync/generatorSupport.js");
support = `const generatorMethodCaches = new WeakMap();
export function getCachedGeneratorMethod(owner, name) {
    return generatorMethodCaches.get(owner)?.[name];
}
` + replaceOnce(
    support,
    "Object.defineProperty(owner, name, { configurable: true, value: method });",
    `let cache = generatorMethodCaches.get(owner);
    if (!cache) generatorMethodCaches.set(owner, cache = Object.create(null));
    cache[name] = method;`,
);
write("method-sidecar-support", support);
let bound = api;
for (const edit of boundEdits.sort((a, b) => b.start - a.start)) bound = bound.slice(0, edit.start) + edit.text + bound.slice(edit.end);
write("bound-methods", bound + "\n" + hoisted.join("\n"));
console.log(`Prepared experiments: ${edits.length} sidecar getters, ${boundEdits.length / 2} hoisted inline method pairs; left named pairs unchanged: ${namedMethods.join(", ")}.`);
