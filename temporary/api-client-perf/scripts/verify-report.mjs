import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { caseRoot } from "./config.mjs";

export function verifyReport(path) {
    const report = JSON.parse(readFileSync(path, "utf8"));
    if (report.length !== 1024 || report.some(file => file.fatalErrorCount)) throw new Error("Workload must complete 1,024 files without fatal errors");
    const messages = report.flatMap(file => file.messages);
    if (messages.length !== 1 || messages[0].ruleId !== "@typescript-eslint/no-floating-promises" || messages[0].severity !== 2) throw new Error("Expected exactly the intentional no-floating-promises error");
    const normalized = report.map(file => ({
        filePath: relative(caseRoot, file.filePath),
        messages: file.messages,
        errorCount: file.errorCount,
        warningCount: file.warningCount,
    }));
    return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
