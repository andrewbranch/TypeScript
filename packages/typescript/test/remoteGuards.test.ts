import * as asyncAPI from "@typescript/typescript/unstable/async";
import * as syncAPI from "@typescript/typescript/unstable/sync";
import assert from "node:assert/strict";
import test from "node:test";
import { cloneNode } from "../src/ast/factory.generated.ts";
import * as ast from "../src/ast/index.ts";
import { spawnAPI as spawnAsyncAPI } from "./async/api.testUtils.ts";
import { spawnAPI as spawnSyncAPI } from "./sync/api.testUtils.ts";

test("remote guard companions are exposed only by API modes", () => {
    const sharedGuards = new Map<string, unknown>(Object.entries(ast));
    const syncGuards = new Map<string, unknown>(Object.entries(syncAPI));
    const names: string[] = [];
    for (const [name, guard] of Object.entries(asyncAPI)) {
        if (typeof guard !== "function" || !("Remote" in guard)) continue;
        names.push(name);
        const shared = sharedGuards.get(name);
        const sync = syncGuards.get(name);
        assert.ok(typeof shared === "function", name);
        assert.equal("Remote" in shared, false, name);
        assert.ok(typeof sync === "function" && "Remote" in sync, name);
        assert.equal(typeof guard.Remote, "function", name);
        assert.equal(typeof sync.Remote, "function", name);
        assert.notStrictEqual(guard, shared, name);
        assert.notStrictEqual(sync, shared, name);
        if ("Handle" in shared) {
            assert.ok("Handle" in guard && "Handle" in sync, name);
            assert.strictEqual(guard.Handle, shared.Handle, name);
            assert.strictEqual(sync.Handle, shared.Handle, name);
        }
    }
    assert.ok(names.includes("isFunctionDeclaration"));
    assert.ok(names.includes("isTypeNode"));
    assert.deepEqual(
        names.sort(),
        Object.entries(syncAPI).filter(([, guard]) => typeof guard === "function" && "Remote" in guard).map(([name]) => name).sort(),
    );
});

test("mode-specific guards recover API mode without mutating shared guards", async () => {
    assert.equal("Remote" in ast.isFunctionDeclaration, false);
    await using async = spawnAsyncAPI();
    using sync = spawnSyncAPI();
    await using asyncFile = await async.createSourceFile("/async.ts", "function asyncFunction(value: number) {}");
    using syncFile = sync.createSourceFile("/sync.ts", "function syncFunction(value: number) {}");
    const asyncNode: ast.Node = asyncFile.sourceFile.statements[0];
    const syncNode: ast.Node = syncFile.sourceFile.statements[0];
    assert.ok(asyncAPI.isRemoteNode(asyncNode));
    assert.equal(asyncAPI.isRemoteNode(syncNode), false);
    assert.ok(syncAPI.isRemoteNode(syncNode));
    assert.equal(syncAPI.isRemoteNode(asyncNode), false);
    assert.ok(asyncAPI.isFunctionDeclaration.Remote(asyncNode));
    assert.equal(syncAPI.isFunctionDeclaration.Remote(asyncNode), false);
    assert.ok(syncAPI.isFunctionDeclaration.Remote(syncNode));
    assert.equal(asyncAPI.isFunctionDeclaration.Remote(syncNode), false);
    assert.equal((await asyncNode.getSymbol()).name, "asyncFunction");
    assert.equal(syncNode.getSymbol().name, "syncFunction");
    assert.equal(sync.batch(syncNode.getSymbol.gen())[0].name, "syncFunction");
    const clone = cloneNode(syncNode);
    assert.ok(syncAPI.isFunctionDeclaration(clone));
    assert.ok(asyncAPI.isFunctionDeclaration(clone));
    assert.equal(syncAPI.isFunctionDeclaration.Remote(clone), false);
    assert.equal(asyncAPI.isFunctionDeclaration.Remote(clone), false);
    assert.equal(syncAPI.isRemoteNode(clone), false);
    assert.equal(asyncAPI.isRemoteNode(clone), false);
    assert.equal("Remote" in ast.isFunctionDeclaration, false);
    assert.notStrictEqual(asyncAPI.isFunctionDeclaration, ast.isFunctionDeclaration);
    assert.notStrictEqual(syncAPI.isFunctionDeclaration, ast.isFunctionDeclaration);
    assert.notStrictEqual(asyncAPI.isFunctionDeclaration, syncAPI.isFunctionDeclaration);
    assert.strictEqual(syncAPI.isFunctionDeclaration.Handle, ast.isFunctionDeclaration.Handle);
    assert.strictEqual(asyncAPI.isFunctionDeclaration.Handle, ast.isFunctionDeclaration.Handle);
    const handle = ast.isFunctionDeclaration(syncNode) && sync.getSymbol(syncNode).declarations[0];
    assert.ok(handle);
    assert.ok(syncAPI.isFunctionDeclaration.Handle(handle));
});
