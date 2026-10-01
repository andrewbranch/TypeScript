import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

test("remote declaration quick info uses named interfaces", () => {
    for (const mode of ["async", "sync"]) {
        const fileName = fileURLToPath(new URL("remoteHover.virtual.ts", import.meta.url));
        const source = `
import type { ClassDeclaration } from "../src/ast/index.ts";
import { isRemoteNode, isClassDeclaration } from "../src/api/${mode}/api.ts";
declare const decl: ClassDeclaration;
if (isRemoteNode(decl)) { decl; }
if (isClassDeclaration.Remote(decl)) { decl; }
`;
        const readFile = (name: string): string | undefined => name === fileName ? source : ts.sys.readFile(name);
        const host: ts.LanguageServiceHost = {
            getCompilationSettings: () => ({
                target: ts.ScriptTarget.ESNext,
                module: ts.ModuleKind.NodeNext,
                moduleResolution: ts.ModuleResolutionKind.NodeNext,
                allowImportingTsExtensions: true,
                noEmit: true,
                strict: true,
                skipLibCheck: true,
                customConditions: ["@typescript/source"],
            }),
            getScriptFileNames: () => [fileName],
            getScriptVersion: () => "0",
            getScriptSnapshot: name => {
                const text = readFile(name);
                return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
            },
            getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
            getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
            fileExists: name => name === fileName || ts.sys.fileExists(name),
            readFile,
            readDirectory: ts.sys.readDirectory,
        };
        const service = ts.createLanguageService(host);
        try {
            assert.deepEqual(service.getSemanticDiagnostics(fileName).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")), []);
            const positions = [
                source.indexOf("isRemoteNode(decl)"),
                source.indexOf("if (isRemoteNode(decl)) { ") + "if (isRemoteNode(decl)) { ".length,
                source.indexOf("if (isClassDeclaration.Remote(decl)) { ") + "if (isClassDeclaration.Remote(decl)) { ".length,
            ];
            for (const position of positions) {
                const info = service.getQuickInfoAtPosition(fileName, position);
                assert.ok(info);
                const display = ts.displayPartsToString(info.displayParts);
                assert.match(display, /RemoteClassDeclaration/);
                assert.doesNotMatch(display, /Omit</);
                assert.ok(display.length < 300, `${mode} quick info is too long: ${display}`);
            }
        }
        finally {
            service.dispose();
        }
    }
});
