import type { Symbol as AsyncSymbol } from "../api/async/api.ts";
import { RemoteNodeBase } from "../api/node/node.infrastructure.ts";
import type { Symbol as SyncSymbol } from "../api/sync/api.ts";
import type { Node } from "./ast.ts";
import type { GeneratedRemoteNodeView } from "./remote.generated.ts";

export * from "./remote.generated.ts";

declare const remoteNodeMethod: unique symbol;
export declare const remoteNodeType: unique symbol;

export type RemoteSymbolMethod = (() => Promise<AsyncSymbol>) | (() => SyncSymbol);

export interface RemoteNodeMarker<TGetSymbol extends () => unknown> {
    readonly [remoteNodeMethod]: TGetSymbol;
}

/** A server-backed standard AST view. Custom structural refinements are not preserved. */
export type RemoteNodeView<T extends Node, TGetSymbol extends () => unknown> = GeneratedRemoteNodeView<LocalNode<T>, TGetSymbol>;

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
