import type { Node } from "../ast/ast.ts";
import type { RemoteNodeView } from "../ast/remote.ts";

export interface ModeNodeGuard<TNode extends Node, TGetSymbol extends () => unknown, TArgs extends unknown[] = []> {
    (node: Node, ...args: TArgs): node is TNode;
    Remote(node: Node, ...args: TArgs): node is RemoteNodeView<TNode, TGetSymbol>;
}

export function createModeNodeGuard<TNode extends Node, TGetSymbol extends () => unknown, TArgs extends unknown[]>(
    guard: (node: Node, ...args: TArgs) => node is TNode,
    isRemoteNode: (node: Node) => node is RemoteNodeView<Node, TGetSymbol>,
): ModeNodeGuard<TNode, TGetSymbol, TArgs> {
    const ordinary = (node: Node, ...args: TArgs): node is TNode => guard(node, ...args);
    const remote = (node: Node, ...args: TArgs): node is RemoteNodeView<TNode, TGetSymbol> => isRemoteNode(node) && guard(node, ...args);
    return Object.assign(ordinary, { Remote: remote });
}
