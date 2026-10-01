import test from "node:test";
import type {
    API as AsyncAPI,
    Remote as AsyncRemote,
    Symbol as AsyncSymbol,
} from "../src/api/async/api.ts";
import { getSymbol as getAsyncSymbol } from "../src/api/async/api.ts";
import * as asyncGuards from "../src/api/async/api.ts";
import type {
    API as SyncAPI,
    Remote as SyncRemote,
    Symbol as SyncSymbol,
} from "../src/api/sync/api.ts";
import { getSymbol as getSyncSymbol } from "../src/api/sync/api.ts";
import * as syncGuards from "../src/api/sync/api.ts";
import { cloneNode } from "../src/ast/factory.generated.ts";
import type {
    ClassDeclaration,
    ClassElement,
    ClassExpression,
    ClassLikeDeclaration,
    ConstructorDeclaration,
    Declaration,
    DotToken,
    FunctionDeclaration,
    Identifier,
    Node,
    SourceFile,
    TypeElement,
} from "../src/ast/index.ts";
import {
    getSynthesizedDeepClone,
    isClassDeclaration,
    isClassLikeDeclaration,
    isConstructorDeclaration,
    isFunctionDeclaration,
    isRemoteNode,
    isSourceFile,
    type RemoteNodeView,
    type RemoteSymbolMethod,
    SyntaxKind,
    visitEachChild,
    visitNodes,
} from "../src/ast/index.ts";

async function asyncTypes(api: AsyncAPI, plain: Declaration) {
    const lease = await api.createSourceFile("/file.ts", "function f() {}");
    const file: AsyncRemote<SourceFile> = lease.sourceFile;
    const ordinary: SourceFile = file;
    const declarations: readonly AsyncRemote<FunctionDeclaration>[] = [...file.statements].filter(asyncGuards.isFunctionDeclaration.Remote);
    const declaration = declarations[0];
    const symbol: Promise<AsyncSymbol> = declaration.getSymbol();
    const free: Promise<AsyncSymbol> = getAsyncSymbol(declaration);
    const convenient: Promise<AsyncSymbol> = api.getSymbol(declaration);
    const optional: Promise<AsyncSymbol | undefined> = getAsyncSymbol(plain);
    const parameter: Promise<AsyncSymbol> = declaration.parameters[0].getSymbol();
    const first: AsyncRemote<FunctionDeclaration> | undefined = file.statements.find(asyncGuards.isFunctionDeclaration.Remote);
    file.forEachChild(node => {
        if (asyncGuards.isFunctionDeclaration.Remote(node)) {
            const result: Promise<AsyncSymbol> = node.getSymbol();
            void result;
        }
    });
    const plainFunctions: readonly FunctionDeclaration[] = [...ordinary.statements].filter(isFunctionDeclaration);
    // @ts-expect-error Clones do not have remote symbol methods.
    cloneNode(declaration).getSymbol();
    // @ts-expect-error Deep clones do not have remote symbol methods.
    getSynthesizedDeepClone(declaration).getSymbol();
    // @ts-expect-error Rewriting may produce synthesized nodes.
    visitEachChild(declaration, node => node).getSymbol();
    const clonedFile = getSynthesizedDeepClone(file);
    // @ts-expect-error Synthesized descendants have no remote symbol methods.
    clonedFile.statements.find(isFunctionDeclaration)?.getSymbol();
    // @ts-expect-error Rewritten arrays may contain synthesized declarations.
    visitNodes(file.statements, node => node).find(isFunctionDeclaration)?.getSymbol();
    void [symbol, free, convenient, optional, parameter, first, plainFunctions];
}

function syncTypes(api: SyncAPI, plain: Declaration) {
    const declaration = api.createSourceFile("/file.ts", "function f() {}").sourceFile.statements.find(syncGuards.isFunctionDeclaration.Remote)!;
    const remote: SyncRemote<FunctionDeclaration> = declaration;
    const symbol: SyncSymbol = declaration.getSymbol();
    const free: SyncSymbol = getSyncSymbol(declaration);
    const convenient: SyncSymbol = api.getSymbol(declaration);
    const optional: SyncSymbol | undefined = getSyncSymbol(plain);
    const request = declaration.getSymbol.gen();
    function* requests() {
        const a: SyncSymbol = yield* declaration.getSymbol.gen();
        const b: SyncSymbol = yield* getSyncSymbol.gen(declaration);
        const c: SyncSymbol = yield* api.getSymbol.gen(declaration);
        void [a, b, c];
    }
    void [remote, symbol, free, convenient, optional, request, requests];
}

function unions(node: AsyncRemote<Node>) {
    if (asyncGuards.isModuleBody.Remote(node) && node.kind === SyntaxKind.ModuleBlock) void node.statements;
    if (asyncGuards.isBindingPattern.Remote(node)) {
        const element = node.elements[0];
        if (asyncGuards.isBindingElement.Remote(element)) {
            const symbol: Promise<AsyncSymbol> = element.getSymbol();
            void symbol;
        }
    }
    if (asyncGuards.isOuterExpression.Remote(node)) {
        const expression: AsyncRemote<Node> = node.expression;
        void expression;
    }
}

declare function find<T, S extends T>(nodes: readonly T[], predicate: (node: T) => node is S): S | undefined;
declare function find<T>(nodes: readonly T[], predicate: (node: T) => boolean): T | undefined;

function ordinaryHigherOrder(members: readonly ClassElement[] | readonly TypeElement[]) {
    const constructor: ConstructorDeclaration | undefined = find(members, isConstructorDeclaration);
    void constructor?.parameters;
}

function sharedGuardsHaveNoRemoteCompanions() {
    // @ts-expect-error Remote kind narrowing requires an explicit API mode.
    void isFunctionDeclaration.Remote;
}

function remoteBrand(node: Node, alreadyRemote: AsyncRemote<Node>) {
    if (isRemoteNode(node)) {
        const remote: RemoteNodeView<Node, RemoteSymbolMethod> = node;
        const children: readonly RemoteNodeView<Node, RemoteSymbolMethod>[] = node.getChildren();
        void [remote, children];
    }
    if (isRemoteNode(alreadyRemote)) {
        const remote: AsyncRemote<Node> = alreadyRemote;
        void remote;
    }
}

function remoteDeclaration(declaration: Declaration | SourceFile) {
    if (isSourceFile(declaration)) return undefined;
    if (!isRemoteNode(declaration)) return undefined;
    const method: RemoteSymbolMethod = declaration.getSymbol;
    return method();
}

function modeSpecificGuards(node: Node, declaration: Declaration | SourceFile, nodes: readonly Node[]) {
    if (!isSourceFile(declaration) && syncGuards.isRemoteNode(declaration)) {
        const symbol: SyncSymbol = declaration.getSymbol();
        const generator = declaration.getSymbol.gen();
        void [symbol, generator];
    }
    if (!isSourceFile(declaration) && asyncGuards.isRemoteNode(declaration)) {
        const symbol: Promise<AsyncSymbol> = declaration.getSymbol();
        void symbol;
    }
    if (syncGuards.isFunctionDeclaration.Remote(node)) {
        const symbol: SyncSymbol = node.getSymbol();
        const parameter: SyncSymbol = node.parameters[0].getSymbol();
        void [symbol, parameter];
    }
    if (asyncGuards.isFunctionDeclaration.Remote(node)) {
        const symbol: Promise<AsyncSymbol> = node.getSymbol();
        void symbol;
    }
    const syncFunctions: readonly SyncRemote<FunctionDeclaration>[] = nodes.filter(syncGuards.isFunctionDeclaration.Remote);
    const asyncFunctions: readonly AsyncRemote<FunctionDeclaration>[] = nodes.filter(asyncGuards.isFunctionDeclaration.Remote);
    const plainFunctions: readonly FunctionDeclaration[] = nodes.filter(syncGuards.isFunctionDeclaration);
    if (syncGuards.isOuterExpression.Remote(node)) {
        const expression: SyncRemote<Node> = node.expression;
        void expression;
    }
    const constructor: ConstructorDeclaration | undefined = find(
        [] as readonly ClassElement[] | readonly TypeElement[],
        syncGuards.isConstructorDeclaration,
    );
    void [syncFunctions, asyncFunctions, plainFunctions, constructor];
}

function syncDeclarationSymbol(declaration: Declaration | SourceFile, checker: syncGuards.Checker): SyncSymbol | undefined {
    if (syncGuards.isSourceFile(declaration)) return checker.getSymbolOfSourceFile(declaration.fileName);
    return syncGuards.isRemoteNode(declaration) ? declaration.getSymbol() : undefined;
}

interface NamedClass extends ClassDeclaration {
    readonly name: Identifier;
    readonly customTag: "named";
}

function generatedRemoteCompatibility(file: AsyncRemote<SourceFile>, custom: AsyncRemote<NamedClass>, token: AsyncRemote<DotToken>) {
    const plainFiles: readonly SourceFile[] = [file];
    const name: AsyncRemote<Identifier> = custom.name;
    const tag: "named" = custom.customTag;
    const symbol: Promise<AsyncSymbol> = custom.getSymbol();
    const local: NamedClass = cloneNode(custom);
    const kind: SyntaxKind.DotToken = token.kind;
    const containingFile: AsyncRemote<SourceFile> = token.getSourceFile();
    void [plainFiles, name, tag, symbol, local, kind, containingFile];
}

async function asyncDeclarationSymbol(declaration: Declaration | SourceFile, checker: asyncGuards.Checker): Promise<AsyncSymbol | undefined> {
    if (asyncGuards.isSourceFile(declaration)) return checker.getSymbolOfSourceFile(declaration.fileName);
    return asyncGuards.isRemoteNode(declaration) ? declaration.getSymbol() : undefined;
}

function ordinaryGeneric<T extends Node>(node: T, classLike: ClassLikeDeclaration) {
    if (isClassLikeDeclaration(node)) {
        if (isClassDeclaration(node)) {
            const declaration: ClassDeclaration = node;
            void declaration;
        }
        else {
            const expression: ClassExpression = node;
            void expression;
        }
    }
    if (!isClassDeclaration(classLike)) {
        const expression: ClassExpression = classLike;
        void expression;
    }
    if (isRemoteNode(node) && asyncGuards.isFunctionDeclaration.Remote(node)) void node.getSymbol();
}

test("opt-in remote AST types preserve API modes and ordinary guards", () => {
    void [asyncTypes, syncTypes, unions, ordinaryGeneric, ordinaryHigherOrder, remoteBrand, remoteDeclaration, modeSpecificGuards, syncDeclarationSymbol, asyncDeclarationSymbol, generatedRemoteCompatibility, sharedGuardsHaveNoRemoteCompanions];
});
