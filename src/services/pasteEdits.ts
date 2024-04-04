import {
    addRange,
} from "../compiler/core";
import {
    CancellationToken,
    SourceFile,
    Statement,
    SymbolFlags,
    TextRange,
    UserPreferences,
} from "../compiler/types";
import {
    getLineOfLocalPosition,
} from "../compiler/utilities";
import {
    codefix,
    Debug,
    fileShouldUseJavaScriptRequire,
    forEachChild,
    formatting,
    getQuotePreference,
    isIdentifier,
    textChanges,
} from "./_namespaces/ts";
import {
    getTargetFileImportsAndAddExportInOldFile,
} from "./refactors/helpers";
import {
    getExistingLocals,
    getUsageInfo,
} from "./refactors/moveToFile";
import {
    CodeFixContextBase,
    FileTextChanges,
    LanguageServiceHost,
    PasteEdits,
} from "./types";

const fixId = "providePostPasteEdits";
/** @internal */
export function pasteEditsProvider(
    targetFile: SourceFile,
    pastedText: string[],
    pasteLocations: TextRange[],
    copiedFrom: { file: SourceFile; range: TextRange[]; } | undefined,
    host: LanguageServiceHost,
    preferences: UserPreferences,
    formatContext: formatting.FormatContext,
    cancellationToken: CancellationToken,
): PasteEdits {
    const changes: FileTextChanges[] = textChanges.ChangeTracker.with({ host, formatContext, preferences }, changeTracker => pasteEdits(targetFile, pastedText, pasteLocations, copiedFrom, host, preferences, formatContext, cancellationToken, changeTracker));
    return { edits: changes, fixId };
}

function pasteEdits(
    targetFile: SourceFile,
    pastedText: string[],
    pasteLocations: TextRange[],
    copiedFrom: { file: SourceFile; range: TextRange[]; } | undefined,
    host: LanguageServiceHost,
    preferences: UserPreferences,
    formatContext: formatting.FormatContext,
    cancellationToken: CancellationToken,
    changes: textChanges.ChangeTracker,
) {
    const statements: Statement[] = [];

    let start = 0;
    let newText = "";
    pasteLocations.forEach((location, i) => {
        if (i === pasteLocations.length - 1) {
            newText += targetFile.text.slice(start, location.pos) + pastedText[i] + targetFile.text.slice(location.end);
        }
        else {
            newText += targetFile.text.slice(start, location.pos) + pastedText[i];
            start = location.end;
        }
    });
    host.runWithTemporaryFileUpdate?.(targetFile.fileName, newText, (updatedProgram, originalProgram, updatedFile) => {
        if (copiedFrom?.range) {
            Debug.assert(copiedFrom.range.length === pastedText.length);
            copiedFrom.range.forEach(copy => {
                addRange(statements, copiedFrom.file.statements, getLineOfLocalPosition(copiedFrom.file, copy.pos), getLineOfLocalPosition(copiedFrom.file, copy.end) + 1);
            });
            const usage = getUsageInfo(copiedFrom.file, statements, originalProgram!.getTypeChecker(), getExistingLocals(updatedFile, statements, originalProgram!.getTypeChecker()));
            const importAdder = codefix.createImportAdder(updatedFile, updatedProgram!, preferences, host);
            getTargetFileImportsAndAddExportInOldFile(copiedFrom.file, targetFile, usage.oldImportsNeededByTargetFile, usage.targetFileImportsFromOldFile, changes, originalProgram!.getTypeChecker(), updatedProgram!, !fileShouldUseJavaScriptRequire(targetFile.fileName, updatedProgram!, host, !!copiedFrom.file.commonJsModuleIndicator), importAdder);
            importAdder.writeFixes(changes, getQuotePreference(copiedFrom.file, preferences));
        }
        else {
            const context: CodeFixContextBase = {
                sourceFile: updatedFile,
                program: originalProgram!,
                cancellationToken,
                host,
                preferences,
                formatContext,
            };
            const importAdder = codefix.createImportAdder(updatedFile, updatedProgram!, preferences, host);
            forEachChild(updatedFile, function cb(node) {
                if (isIdentifier(node)) {
                    if (!originalProgram?.getTypeChecker().resolveName(node.text, node, SymbolFlags.All, /*excludeGlobals*/ false)) {
                        // generate imports
                        importAdder.addImportForUnresolvedIdentifier(context, node, /*useAutoImportProvider*/ true);
                    }
                }
                else {
                    node.forEachChild(cb);
                }
            });
            importAdder.writeFixes(changes, getQuotePreference(targetFile, preferences));
        }
    });

    if (pastedText.length !== 1) {
        Debug.assert(pastedText.length === pasteLocations.length);
    }
    pasteLocations.forEach((paste, i) => {
        changes.replaceRangeWithText(
            targetFile,
            { pos: paste.pos, end: paste.end },
            pastedText.length === 1 ?
                pastedText[0] : pastedText[i],
        );
    });
}
