import type { Symbol as AsyncSymbol } from "../api/async/api.ts";
import { RemoteNodeBase } from "../api/node/node.infrastructure.ts";
import type { Symbol as SyncSymbol } from "../api/sync/api.ts";
import type {
    Declaration,
    Node,
    NodeArray,
} from "./ast.ts";
import type {
    GeneratedRemoteNodeView,
    RemoteNode,
    RemoteNodeArray,
} from "./remote.generated.ts";

export * from "./remote.generated.ts";

declare const remoteNodeMethod: unique symbol;
export declare const remoteNodeType: unique symbol;

export type RemoteSymbolMethod = (() => Promise<AsyncSymbol>) | (() => SyncSymbol);

export interface RemoteNodeMarker<TGetSymbol extends () => unknown> {
    readonly [remoteNodeMethod]: TGetSymbol;
}

type RemoteNodeValue<T, TGetSymbol extends () => unknown> = T extends NodeArray<infer TNode> ? RemoteNodeArray<TNode, TGetSymbol>
    : T extends Node ? RemoteNodeView<T, TGetSymbol>
    : T extends readonly (infer TElement)[] ? TElement extends Node ? readonly RemoteNodeView<TElement, TGetSymbol>[] : T
    : T;

type RemoteNodeMembers<TGetSymbol extends () => unknown> = Pick<
    RemoteNode<TGetSymbol>,
    "parent" | "childrenIter" | "forEachChild" | "getSourceFile" | "getChildAt" | "getChildren" | "getFirstToken" | "getLastToken"
>;

/** A server-backed AST view. Its brand describes capability, not current server availability. */
export type RemoteNodeView<T extends Node, TGetSymbol extends () => unknown> = GeneratedRemoteNodeView<LocalNode<T>, TGetSymbol>;

/** Projects custom AST refinements not represented by a generated interface. */
export type RefinedRemoteNodeView<T extends Node, TGetSymbol extends () => unknown> = T extends Node ?
        & Omit<{ readonly [K in keyof T]: RemoteNodeValue<T[K], TGetSymbol>; }, keyof RemoteNodeMembers<TGetSymbol>>
        & RemoteNodeMembers<TGetSymbol>
        & (T extends Declaration ? { readonly getSymbol: TGetSymbol; } : unknown)
        & RemoteNodeMarker<TGetSymbol>
        & { readonly [remoteNodeType]: T; }
    : never;

/** The plain AST shape of a remote node, used for synthesized or rewritten results. */
export type LocalNode<T extends Node> = T extends { readonly [remoteNodeType]: infer TNode extends Node; } ? TNode : T;

/** Tests whether a node belongs to a binder-backed remote source file. */
export function isRemoteNode<T extends Node & RemoteNodeMarker<() => unknown>>(node: T): node is T;
export function isRemoteNode<T extends Node>(node: T): node is RemoteNodeView<T, RemoteSymbolMethod> & T;
export function isRemoteNode(node: Node): boolean {
    if (!(node instanceof RemoteNodeBase)) return false;
    const file = node.getSourceFile();
    return "symbolCache" in file && file.symbolCache !== undefined;
}
