import { readFileSync } from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { repoRoot } from "../gen/utils.mts";

type AstDeclaration = ts.InterfaceDeclaration | ts.TypeAliasDeclaration;

export function generateRemoteAst(): string {
    const sources = ["ast.ts", "ast.generated.ts"].map(file => ts.createSourceFile(file, readFileSync(path.join(repoRoot, "packages/typescript/src/ast", file), "utf8"), ts.ScriptTarget.Latest, true));
    const declarations = new Map<string, AstDeclaration>();
    const importedNames = new Set<string>();
    for (const source of sources) {
        for (const statement of source.statements) {
            if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
                declarations.set(statement.name.text, statement);
            }
            if (ts.isImportDeclaration(statement) && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
                for (const element of statement.importClause.namedBindings.elements) importedNames.add(element.name.text);
            }
        }
    }
    const nodeNames = new Set(["Node"]);
    const remoteNames = new Set(["Node", "NodeArray"]);
    function isNodeType(type: ts.TypeNode): boolean {
        if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) return nodeNames.has(type.typeName.text);
        if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)) return type.types.every(isNodeType);
        return false;
    }
    let changed = true;
    while (changed) {
        changed = false;
        for (const [name, declaration] of declarations) {
            if (nodeNames.has(name)) continue;
            const isNode = ts.isInterfaceDeclaration(declaration)
                ? declaration.heritageClauses?.some(clause => clause.types.some(type => ts.isIdentifier(type.expression) && nodeNames.has(type.expression.text)))
                : isNodeType(declaration.type);
            if (isNode) {
                nodeNames.add(name);
                remoteNames.add(name);
                changed = true;
            }
        }
    }
    changed = true;
    while (changed) {
        changed = false;
        for (const [name, declaration] of declarations) {
            if (remoteNames.has(name) || !ts.isTypeAliasDeclaration(declaration)) continue;
            let hasRemoteReference = false;
            function visit(node: ts.Node): void {
                if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && remoteNames.has(node.typeName.text)) hasRemoteReference = true;
                ts.forEachChild(node, visit);
            }
            visit(declaration.type);
            if (hasRemoteReference) {
                remoteNames.add(name);
                changed = true;
            }
        }
    }
    const f = ts.factory;
    const methodName = "TGetSymbol";
    const method = f.createTypeReferenceNode(methodName);
    const methodParameter = () =>
        f.createTypeParameterDeclaration(
            undefined,
            methodName,
            f.createFunctionTypeNode(undefined, [], f.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword)),
            f.createTypeReferenceNode("RemoteSymbolMethod"),
        );
    const printer = ts.createPrinter();
    function qualify(name: string): ts.EntityName {
        return f.createQualifiedName(f.createIdentifier("ast"), name);
    }
    function transformType<T extends ts.Node>(node: T, remote = true): T {
        const result = ts.transform(node, [context => root => {
            function visit(current: ts.Node): ts.VisitResult<ts.Node> {
                if (ts.isTypeReferenceNode(current) && ts.isIdentifier(current.typeName)) {
                    const name = current.typeName.text;
                    if (remote && name === "NodeArray") {
                        return f.createTypeReferenceNode("RemoteNodeArray", [transformType(current.typeArguments![0], false), method]);
                    }
                    if (remote && ["Map", "ReadonlyMap"].includes(name)) return transformType(current, false);
                    const args = current.typeArguments?.map(argument => transformType(argument, remote));
                    if (remote && remoteNames.has(name)) {
                        return f.createTypeReferenceNode(`Remote${name}`, [...completeArguments(name, args), method]);
                    }
                    if (declarations.has(name) || importedNames.has(name)) {
                        return f.createTypeReferenceNode(qualify(name), args);
                    }
                    return f.updateTypeReferenceNode(current, current.typeName, args && f.createNodeArray(args));
                }
                if (ts.isQualifiedName(current) && ts.isIdentifier(current.left) && importedNames.has(current.left.text)) {
                    return f.createQualifiedName(qualify(current.left.text), current.right);
                }
                return ts.visitEachChild(current, visit, context);
            }
            return ts.visitNode(root, visit) as T;
        }]);
        const transformed = result.transformed[0];
        result.dispose();
        return transformed;
    }
    function completeArguments(name: string, args: readonly ts.TypeNode[] | undefined): ts.TypeNode[] {
        const result = [...args ?? []];
        const parameters = declarations.get(name)?.typeParameters ?? [];
        while (result.length < parameters.length) {
            const parameter = parameters[result.length];
            if (!parameter.default) throw new Error(`Missing default for ${name}.${parameter.name.text}`);
            result.push(transformType(parameter.default, false));
        }
        return result;
    }
    const out = [
        "// Code generated by tools/scripts/tsc/generate-remote-ast.ts. DO NOT EDIT.",
        'import type * as ast from "./index.ts";',
        'import type { RemoteNodeMarker, RemoteNodeView, RemoteSymbolMethod, RefinedRemoteNodeView, remoteNodeType } from "./remote.ts";',
        "",
        "export interface RemoteNodeArray<T extends ast.Node, TGetSymbol extends () => unknown = RemoteSymbolMethod> extends ast.NodeArray<RemoteNodeView<T, TGetSymbol>> {}",
        "",
    ];
    const interfaces: ts.InterfaceDeclaration[] = [];
    for (const [name, declaration] of declarations) {
        if (!remoteNames.has(name) || name === "NodeArray") continue;
        const parameters = [
            ...declaration.typeParameters?.map(parameter =>
                f.updateTypeParameterDeclaration(
                    parameter,
                    parameter.modifiers,
                    parameter.name,
                    parameter.constraint && transformType(parameter.constraint, false),
                    parameter.default && transformType(parameter.default, false),
                )
            ) ?? [],
            methodParameter(),
        ];
        let generated: AstDeclaration;
        if (ts.isInterfaceDeclaration(declaration)) {
            interfaces.push(declaration);
            const localArguments = declaration.typeParameters?.map(parameter => f.createTypeReferenceNode(parameter.name));
            const heritage = declaration.heritageClauses?.map(clause =>
                f.updateHeritageClause(
                    clause,
                    clause.types.map(type => {
                        if (!ts.isIdentifier(type.expression)) throw new Error(`Unsupported AST base for ${name}`);
                        const base = type.expression.text;
                        return f.updateExpressionWithTypeArguments(
                            type,
                            remoteNames.has(base) ? f.createIdentifier(`Remote${base}`) : f.createPropertyAccessExpression(f.createIdentifier("ast"), base),
                            f.createNodeArray(
                                remoteNames.has(base)
                                    ? [...completeArguments(base, type.typeArguments?.map(argument => transformType(argument))), method]
                                    : type.typeArguments?.map(argument => transformType(argument, false)) ?? [],
                            ),
                        );
                    }),
                )
            ) ?? [];
            if (name === "Node") {
                heritage[0] = f.updateHeritageClause(heritage[0], [
                    ...heritage[0].types,
                    f.createExpressionWithTypeArguments(f.createIdentifier("RemoteNodeMarker"), [method]),
                ]);
            }
            const members = declaration.members.map(member => {
                if (ts.isMethodSignature(member)) {
                    const projectParameters = ["childrenIter", "forEachChild"].includes(member.name.getText());
                    return f.updateMethodSignature(
                        member,
                        member.modifiers,
                        member.name,
                        member.questionToken,
                        member.typeParameters,
                        f.createNodeArray(member.parameters.map(parameter =>
                            f.updateParameterDeclaration(
                                parameter,
                                parameter.modifiers,
                                parameter.dotDotDotToken,
                                parameter.name,
                                parameter.questionToken,
                                parameter.type && transformType(parameter.type, projectParameters),
                                parameter.initializer,
                            )
                        )),
                        member.type && transformType(member.type),
                    );
                }
                if (ts.isPropertySignature(member)) {
                    return f.updatePropertySignature(member, member.modifiers, member.name, member.questionToken, member.type && transformType(member.type));
                }
                throw new Error(`Unsupported AST member in ${name}`);
            });
            const local = f.createTypeReferenceNode(qualify(name), localArguments);
            members.push(f.createPropertySignature([f.createModifier(ts.SyntaxKind.ReadonlyKeyword)], f.createComputedPropertyName(f.createIdentifier("remoteNodeType")), undefined, local));
            if (name === "DeclarationBase") members.push(f.createPropertySignature([f.createModifier(ts.SyntaxKind.ReadonlyKeyword)], "getSymbol", undefined, method));
            generated = f.updateInterfaceDeclaration(declaration, declaration.modifiers, f.createIdentifier(`Remote${name}`), parameters, heritage, members);
        }
        else {
            generated = f.updateTypeAliasDeclaration(declaration, declaration.modifiers, f.createIdentifier(`Remote${name}`), parameters, transformType(declaration.type));
        }
        out.push(printer.printNode(ts.EmitHint.Unspecified, generated, declaration.getSourceFile()), "");
    }
    function depth(declaration: ts.InterfaceDeclaration): number {
        const parents = declaration.heritageClauses?.flatMap(clause => clause.types) ?? [];
        return 1 + Math.max(
            0,
            ...parents.map(parent => {
                const base = ts.isIdentifier(parent.expression) && declarations.get(parent.expression.text);
                return base && ts.isInterfaceDeclaration(base) ? depth(base) : 0;
            }),
        );
    }
    interfaces.sort((left, right) => depth(right) - depth(left));
    function kindNames(type: ts.TypeNode, declaration: ts.InterfaceDeclaration): string[] {
        if (ts.isUnionTypeNode(type)) return type.types.flatMap(type => kindNames(type, declaration));
        if (!ts.isTypeReferenceNode(type)) return [];
        if (ts.isQualifiedName(type.typeName) && type.typeName.left.getText() === "SyntaxKind") return [type.typeName.right.text];
        if (!ts.isIdentifier(type.typeName)) return [];
        const name = type.typeName.text;
        const parameter = declaration.typeParameters?.find(parameter => parameter.name.text === name);
        if (parameter?.constraint) return kindNames(parameter.constraint, declaration);
        const alias = declarations.get(name);
        return alias && ts.isTypeAliasDeclaration(alias) ? kindNames(alias.type, declaration) : [];
    }
    function interfaceKinds(declaration: ts.InterfaceDeclaration): string[] {
        const kind = declaration.members.find(member => ts.isPropertySignature(member) && member.name.getText() === "kind");
        if (kind && ts.isPropertySignature(kind) && kind.type) return kindNames(kind.type, declaration);
        for (const clause of declaration.heritageClauses ?? []) {
            for (const parent of clause.types) {
                const base = ts.isIdentifier(parent.expression) && declarations.get(parent.expression.text);
                if (base && ts.isInterfaceDeclaration(base)) {
                    const kinds = interfaceKinds(base);
                    if (kinds.length) return kinds;
                }
            }
        }
        return [];
    }
    const groups = new Map<string, ts.InterfaceDeclaration[]>();
    const broad: ts.InterfaceDeclaration[] = [];
    for (const declaration of interfaces) {
        const kinds = interfaceKinds(declaration);
        if (!kinds.length) broad.push(declaration);
        for (const kind of new Set(kinds)) {
            const group = groups.get(kind) ?? [];
            group.push(declaration);
            groups.set(kind, group);
        }
    }
    function emitDispatch(name: string, group: readonly ts.InterfaceDeclaration[]): void {
        out.push(`type ${name}<T extends ast.Node, TGetSymbol extends () => unknown> =`);
        for (const declaration of group) {
            const name = declaration.name.text;
            const args = declaration.typeParameters?.map(parameter => `infer ${parameter.name.text}`) ?? [];
            const local = `ast.${name}${args.length ? `<${args.join(", ")}>` : ""}`;
            const inferred = declaration.typeParameters?.map(parameter => parameter.name.text) ?? [];
            const exact = `ast.${name}${inferred.length ? `<${inferred.join(", ")}>` : ""}`;
            const remote = `Remote${name}<${[...inferred, methodName].join(", ")}>`;
            out.push(`    T extends ${local} ? ${exact} extends T ? ${remote} : RefinedRemoteNodeView<T, TGetSymbol> :`);
        }
        out.push("    RefinedRemoteNodeView<T, TGetSymbol>;", "");
    }
    emitDispatch("RemoteBroadNode", broad);
    for (const [kind, group] of groups) emitDispatch(`RemoteKind${kind}`, group);
    out.push("interface RemoteNodesByKind<T extends ast.Node, TGetSymbol extends () => unknown> {");
    for (const kind of groups.keys()) out.push(`    [ast.SyntaxKind.${kind}]: RemoteKind${kind}<T, TGetSymbol>;`);
    out.push("}", "");
    out.push(
        "export type GeneratedRemoteNodeView<T extends ast.Node, TGetSymbol extends () => unknown> = T extends ast.Node ?",
        "    ast.SyntaxKind extends T['kind'] ? RemoteBroadNode<T, TGetSymbol> :",
        "    T['kind'] extends keyof RemoteNodesByKind<T, TGetSymbol> ? RemoteNodesByKind<T, TGetSymbol>[T['kind']] :",
        "    RefinedRemoteNodeView<T, TGetSymbol> : never;",
        "",
    );
    return out.join("\n");
}
