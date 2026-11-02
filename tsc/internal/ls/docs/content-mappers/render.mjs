// Renders the diagrams used by ../content-mappers.md.
//
//     node tsc/internal/ls/docs/content-mappers/render.mjs [example-name...]
//
// Each diagram draws original text above virtual text, with each span map segment drawn as a band
// connecting the two rows. Request, response, and dropped spans are outlined on top.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outDir = path.dirname(fileURLToPath(import.meta.url));

// #region Helpers for authoring examples

/**
 * Returns the [start, end) range of the nth occurrence of needle in text.
 * @param {string} text
 * @param {string} needle
 * @param {number} [occurrence]
 * @returns {[number, number]}
 */
function find(text, needle, occurrence = 0) {
    let index = -1;
    for (let i = 0; i <= occurrence; i++) {
        index = text.indexOf(needle, index + 1);
        if (index < 0) throw new Error(`Could not find occurrence ${occurrence} of ${JSON.stringify(needle)} in ${JSON.stringify(text)}`);
    }
    return [index, index + needle.length];
}

/**
 * Returns a [start, end) range inside the nth occurrence of needle, where the part of needle to select
 * is marked with brackets, e.g. inside(text, "let [x] = 1").
 * @param {string} text
 * @param {string} markedNeedle
 * @param {number} [occurrence]
 * @returns {[number, number]}
 */
function inside(text, markedNeedle, occurrence = 0) {
    const open = markedNeedle.indexOf("[");
    const close = markedNeedle.indexOf("]");
    const needle = markedNeedle.slice(0, open) + markedNeedle.slice(open + 1, close) + markedNeedle.slice(close + 1);
    const [start] = find(text, needle, occurrence);
    return [start + open, start + close - 1];
}

/**
 * @param {string} s
 */
function escape(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// #endregion

const theme = {
    font: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    text: "#1f2328",
    muted: "#8c959f",
    background: "#ffffff",
    kinds: {
        verbatim: { fill: "#ddf4ff", stroke: "#54aeff", band: "rgba(84, 174, 255, 0.22)" },
        atom: { fill: "#fff1e5", stroke: "#fb8f44", band: "rgba(251, 143, 68, 0.25)" },
        alias: { fill: "#fbefff", stroke: "#c297ff", band: "rgba(194, 151, 255, 0.25)" },
    },
    marks: {
        input: { stroke: "#1a7f37", dash: "", label: "#1a7f37" },
        output: { stroke: "#0550ae", dash: "", label: "#0550ae" },
        dropped: { stroke: "#cf222e", dash: "4 3", label: "#cf222e" },
    },
};

// #region Ribbon renderer

/**
 * @typedef {"verbatim" | "atom" | "alias"} Kind
 * @typedef {{ original: [number, number], virtual: [number, number], kind: Kind, label?: string }} Segment
 * @typedef {{ side: "original" | "virtual", range: [number, number], style: "input" | "output" | "dropped", label?: string, nest?: number }} Mark
 * `nest` pads the outline outward so nested ranges remain distinguishable.
 * @typedef {{ name: string, range: [number, number] }} VirtualFile
 * @typedef {{ title: string, caption?: string[], original: string, virtual: string, virtualFiles?: VirtualFile[], segments: Segment[], marks?: Mark[] }} RibbonSpec
 * `virtualFiles` splits the virtual row into several named files; text between them is a blank separator.
 */

const cell = 11;
const rowHeight = 24;
const left = 92;

/**
 * Assigns a stacking level to each label so labels on the same row do not overlap.
 * @param {{ x: number, text: string }[]} labels
 * @returns {number[]}
 */
function stackLabels(labels) {
    /** @type {number[]} */
    const levelEnds = [];
    return labels.map(label => {
        const width = label.text.length * 6.5;
        const start = label.x - width / 2;
        let level = levelEnds.findIndex(end => end + 8 <= start);
        if (level < 0) level = levelEnds.length;
        levelEnds[level] = start + width;
        return level;
    });
}

/**
 * @param {RibbonSpec} spec
 */
function renderRibbon(spec) {
    const marks = spec.marks ?? [];
    const caption = spec.caption ?? [];
    const xOf = (/** @type {number} */ offset) => left + offset * cell;
    const longestCaption = Math.max(spec.title.length * 8, ...caption.map(line => line.length * 6.4));
    const width = Math.max(left + Math.max(spec.original.length, spec.virtual.length) * cell + 24, longestCaption + 32);

    const originalMarks = marks.filter(m => m.side === "original");
    const virtualMarks = marks.filter(m => m.side === "virtual");
    const levelsFor = (/** @type {Mark[]} */ sideMarks) => stackLabels(sideMarks.map(m => ({ x: (xOf(m.range[0]) + xOf(m.range[1])) / 2, text: m.label ?? "" })));
    const originalLevels = levelsFor(originalMarks);
    const virtualLevels = levelsFor(virtualMarks);
    const maxNest = (/** @type {Mark[]} */ sideMarks) => Math.max(0, ...sideMarks.map(m => m.nest ?? 0)) * 4;
    const originalLabelHeight = (Math.max(-1, ...originalLevels) + 1) * 16 + maxNest(originalMarks);
    const virtualLabelHeight = (Math.max(-1, ...virtualLevels) + 1) * 16 + maxNest(virtualMarks);

    const titleHeight = 30 + caption.length * 18;
    const originalY = titleHeight + originalLabelHeight + 26;
    const virtualY = originalY + rowHeight + 70;
    const legendY = virtualY + rowHeight + virtualLabelHeight + 34;
    const height = legendY + 26;

    /** @type {string[]} */
    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
    out.push(`<defs><pattern id="gap" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f6f8fa"/><line x1="0" y1="0" x2="0" y2="6" stroke="#d0d7de" stroke-width="2"/></pattern></defs>`);
    out.push(`<rect width="100%" height="100%" fill="${theme.background}"/>`);
    out.push(`<text x="16" y="24" font-family="${theme.sans}" font-size="15" font-weight="600" fill="${theme.text}">${escape(spec.title)}</text>`);
    caption.forEach((line, i) => {
        // Backtick-delimited spans render in monospace.
        const parts = line.split("`").map((part, j) => j % 2 ? `<tspan font-family="${theme.font}" font-size="12">${escape(part)}</tspan>` : escape(part));
        out.push(`<text x="16" y="${44 + i * 18}" font-family="${theme.sans}" font-size="12.5" fill="${theme.text}">${parts.join("")}</text>`);
    });

    for (const [label, y] of /** @type {const} */ ([["original", originalY], ["virtual", virtualY]])) {
        out.push(`<text x="${left - 12}" y="${y + 16}" text-anchor="end" font-family="${theme.sans}" font-size="12" fill="${theme.muted}">${label}</text>`);
    }

    // Synthesized gaps in the virtual text
    const covered = new Array(spec.virtual.length).fill(false);
    const inFile = (/** @type {number} */ i) => !spec.virtualFiles || spec.virtualFiles.some(f => f.range[0] <= i && i < f.range[1]);
    for (const segment of spec.segments) {
        for (let i = segment.virtual[0]; i < segment.virtual[1]; i++) covered[i] = true;
    }
    for (let i = 0; i < spec.virtual.length;) {
        if (covered[i] || !inFile(i)) {
            i++;
            continue;
        }
        let j = i;
        while (j < spec.virtual.length && !covered[j] && inFile(j)) j++;
        out.push(`<rect x="${xOf(i)}" y="${virtualY}" width="${(j - i) * cell}" height="${rowHeight}" fill="url(#gap)"/>`);
        i = j;
    }

    // Segment bands
    for (const segment of spec.segments) {
        const kind = theme.kinds[segment.kind];
        const [os, oe] = segment.original;
        const [vs, ve] = segment.virtual;
        const ob = originalY + rowHeight;
        out.push(`<polygon points="${xOf(os)},${ob} ${xOf(oe)},${ob} ${xOf(ve)},${virtualY} ${xOf(vs)},${virtualY}" fill="${kind.band}" stroke="${kind.stroke}" stroke-width="0.75" stroke-opacity="0.6"/>`);
        out.push(`<rect x="${xOf(os)}" y="${originalY}" width="${Math.max((oe - os) * cell, 2)}" height="${rowHeight}" fill="${kind.fill}" stroke="${kind.stroke}" stroke-width="1"/>`);
        out.push(`<rect x="${xOf(vs)}" y="${virtualY}" width="${(ve - vs) * cell}" height="${rowHeight}" fill="${kind.fill}" stroke="${kind.stroke}" stroke-width="1"/>`);
        if (segment.label) {
            const midX = (xOf(os) + xOf(oe) + xOf(vs) + xOf(ve)) / 4;
            const midY = (ob + virtualY) / 2 + 4;
            out.push(`<text x="${midX}" y="${midY}" text-anchor="middle" font-family="${theme.sans}" font-size="11" fill="${kind.stroke}" font-weight="600" paint-order="stroke" stroke="${theme.background}" stroke-width="3">${escape(segment.label)}</text>`);
        }
    }

    // Characters
    const drawText = (/** @type {string} */ text, /** @type {number} */ y, /** @type {boolean[] | undefined} */ coverage) => {
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            const display = ch === "\n" ? "↵" : ch === " " ? "" : ch;
            if (!display) continue;
            const fill = ch === "\n" || (coverage && !coverage[i]) ? theme.muted : theme.text;
            out.push(`<text x="${xOf(i) + cell / 2}" y="${y + 17}" text-anchor="middle" font-family="${theme.font}" font-size="14" fill="${fill}">${escape(display)}</text>`);
        }
    };
    drawText(spec.original, originalY, undefined);
    drawText(spec.virtual, virtualY, covered);
    for (const file of spec.virtualFiles ?? []) {
        out.push(`<text x="${xOf(file.range[0])}" y="${virtualY - 5}" font-family="${theme.font}" font-size="11" fill="${theme.muted}" paint-order="stroke" stroke="${theme.background}" stroke-width="3">${escape(file.name)}</text>`);
    }

    // Marks
    const drawMarks = (/** @type {Mark[]} */ sideMarks, /** @type {number[]} */ levels, /** @type {number} */ y, /** @type {boolean} */ above) => {
        const labelPad = maxNest(sideMarks);
        sideMarks.forEach((mark, index) => {
            const style = theme.marks[mark.style];
            const [start, end] = mark.range;
            if (start === end) {
                const x = xOf(start);
                out.push(`<line x1="${x}" y1="${y - 3}" x2="${x}" y2="${y + rowHeight + 3}" stroke="${style.stroke}" stroke-width="2.5" stroke-dasharray="${style.dash}"/>`);
                const ty = above ? y - 3 : y + rowHeight + 3;
                const dir = above ? -1 : 1;
                out.push(`<polygon points="${x - 4},${ty + dir * 6} ${x + 4},${ty + dir * 6} ${x},${ty}" fill="${style.stroke}"/>`);
            }
            else {
                const pad = 1 + (mark.nest ?? 0) * 4;
                out.push(`<rect x="${xOf(start) - pad}" y="${y - 1 - pad}" width="${(end - start) * cell + pad * 2}" height="${rowHeight + 2 + pad * 2}" rx="4" fill="none" stroke="${style.stroke}" stroke-width="2" stroke-dasharray="${style.dash}"/>`);
            }
            if (mark.label) {
                const x = (xOf(start) + xOf(end)) / 2;
                const off = labelPad + (start === end ? 6 : 0) + levels[index] * 16;
                const ly = above ? y - 10 - off : y + rowHeight + 18 + off;
                out.push(`<text x="${x}" y="${ly}" text-anchor="middle" font-family="${theme.sans}" font-size="11.5" font-weight="600" fill="${style.label}">${escape(mark.label)}</text>`);
            }
        });
    };
    drawMarks(originalMarks, originalLevels, originalY, /*above*/ true);
    drawMarks(virtualMarks, virtualLevels, virtualY, /*above*/ false);

    // Legend
    let lx = 16;
    const legend = (/** @type {string} */ swatch, /** @type {string} */ text) => {
        out.push(swatch.replace(/\$X/g, String(lx)).replace(/\$Y/g, String(legendY)));
        out.push(`<text x="${lx + 20}" y="${legendY + 10}" font-family="${theme.sans}" font-size="11" fill="${theme.text}">${escape(text)}</text>`);
        lx += 32 + text.length * 6;
    };
    const usedKinds = new Set(spec.segments.map(s => s.kind));
    for (const kind of /** @type {Kind[]} */ (["verbatim", "atom", "alias"])) {
        if (!usedKinds.has(kind)) continue;
        legend(`<rect x="$X" y="$Y" width="14" height="12" fill="${theme.kinds[kind].fill}" stroke="${theme.kinds[kind].stroke}"/>`, `${kind} segment`);
    }
    if (covered.some((c, i) => !c && inFile(i))) legend(`<rect x="$X" y="$Y" width="14" height="12" fill="url(#gap)" stroke="#d0d7de"/>`, "synthesized (gap)");
    const usedStyles = new Set(marks.map(m => m.style));
    for (const style of /** @type {const} */ (["input", "output", "dropped"])) {
        if (!usedStyles.has(style)) continue;
        const s = theme.marks[style];
        legend(`<rect x="$X" y="$Y" width="14" height="12" rx="3" fill="none" stroke="${s.stroke}" stroke-width="2" stroke-dasharray="${s.dash}"/>`, { input: "request", output: "response", dropped: "dropped" }[style]);
    }

    out.push(`</svg>`);
    return out.join("\n") + "\n";
}

// #endregion


// #region Examples

/** @type {Record<string, () => RibbonSpec>} */
const examples = {
    "primer-kinds"() {
        const original = `<script>let n = 0</script><x-counter @click="inc"/>`;
        const virtual = `let n = 0;\nXCounter({ onClick: inc });`;
        return {
            title: "Segment kinds",
            caption: [
                "Verbatim segments copy text exactly. `x-counter` becomes `XCounter` as an alias (same entity, different text), and",
                "`@click` becomes `onClick` as an atom (different text, no offset correspondence). Everything else in the virtual file is synthesized.",
            ],
            original,
            virtual,
            segments: [
                { original: find(original, "let n = 0"), virtual: find(virtual, "let n = 0"), kind: "verbatim" },
                { original: find(original, "x-counter"), virtual: find(virtual, "XCounter"), kind: "alias" },
                { original: find(original, "@click"), virtual: find(virtual, "onClick"), kind: "atom" },
                { original: find(original, "inc"), virtual: find(virtual, "inc"), kind: "verbatim" },
            ],
        };
    },

    "primer-fidelity"() {
        const original = `<script>let n = 0</script><p>{{ n }}</p>`;
        const virtual = `let n = 0;\n__ctx(n);`;
        const approximateEnd = inside(original, "{{ [n] }}")[1];
        return {
            title: "Fidelity of virtual-to-original mappings",
            caption: [
                "A range inside one verbatim segment maps Exact. A range crossing segments maps Approximate, with each endpoint mapped separately.",
                "A range entirely in synthesized text maps None, to the insertion point: the original end of the preceding segment.",
            ],
            original,
            virtual,
            segments: [
                { original: find(original, "let n = 0"), virtual: find(virtual, "let n = 0"), kind: "verbatim" },
                { original: inside(original, "{{ [n] }}"), virtual: inside(virtual, "__ctx([n])"), kind: "verbatim" },
            ],
            marks: [
                { side: "virtual", range: find(virtual, "let n"), style: "output", label: "Exact" },
                { side: "virtual", range: find(virtual, "0;\n__ctx(n"), style: "output", label: "Approximate" },
                { side: "virtual", range: find(virtual, ");"), style: "output", label: "None" },
                { side: "original", range: find(original, "let n"), style: "output", label: "Exact" },
                { side: "original", range: [find(original, "0<")[0], approximateEnd], style: "output", label: "Approximate" },
                { side: "original", range: [approximateEnd, approximateEnd], style: "output", label: "None (insertion point)" },
            ],
        };
    },

    "primer-spans"() {
        const original = `<p>{{ count + 1 }}</p>`;
        const virtual = `ctx.count + 1;\ncheck(ctx.count + 1);`;
        return {
            title: "Mapping an original range that crosses segments",
            caption: [
                "`count` and ` + 1` are separate segments, each copied twice. A range from inside one into the other pairs each possible start",
                "with the nearest following end, producing two Approximate ranges rather than one range spanning both copies.",
            ],
            original,
            virtual,
            segments: [
                { original: find(original, "count"), virtual: find(virtual, "count", 0), kind: "verbatim" },
                { original: find(original, " + 1"), virtual: find(virtual, " + 1", 0), kind: "verbatim" },
                { original: find(original, "count"), virtual: find(virtual, "count", 1), kind: "verbatim" },
                { original: find(original, " + 1"), virtual: find(virtual, " + 1", 1), kind: "verbatim" },
            ],
            marks: [
                { side: "original", range: inside(original, "co[unt + ]1"), style: "input", label: "request" },
                { side: "virtual", range: inside(virtual, "ctx.co[unt + ]1", 0), style: "output", label: "Approximate" },
                { side: "virtual", range: inside(virtual, "ctx.co[unt + ]1", 1), style: "output", label: "Approximate" },
            ],
        };
    },

    "diagnostics-synthesized"() {
        const original = `<script>let n = 0</script>`;
        const virtual = `const __props: Props = {};\nlet n = 0;`;
        return {
            title: "Diagnostics in synthesized code",
            caption: [
                "An error located entirely in synthesized code has no original location. It is folded into an aggregate diagnostic for",
                "its virtual file, with the original message attached as related information. Here virtual offset 0 is synthesized, so it lands at 0.",
            ],
            original,
            virtual,
            segments: [
                { original: find(original, "let n = 0"), virtual: find(virtual, "let n = 0"), kind: "verbatim" },
            ],
            marks: [
                { side: "virtual", range: find(virtual, "__props"), style: "output", label: "error (None)" },
                { side: "original", range: [0, 0], style: "output", label: "aggregate diagnostic" },
            ],
        };
    },

    "diagnostics-alias"() {
        const original = `<x-counter :count="n"/>`;
        const virtual = `XCounter({ count: n });`;
        return {
            title: "Diagnostic messages on an alias",
            caption: [
                "When a diagnostic exactly covers an alias segment, message arguments equal to the virtual name are replaced with the original text.",
            ],
            original,
            virtual,
            segments: [
                { original: find(original, "x-counter"), virtual: find(virtual, "XCounter"), kind: "alias" },
                { original: find(original, ":count"), virtual: find(virtual, "count"), kind: "atom" },
                { original: inside(original, `="[n]"`), virtual: inside(virtual, ": [n] "), kind: "verbatim" },
            ],
            marks: [
                { side: "virtual", range: find(virtual, "XCounter"), style: "output", label: "Cannot find name 'XCounter'." },
                { side: "original", range: find(original, "x-counter"), style: "output", label: "Cannot find name 'x-counter'." },
            ],
        };
    },

    "hover"() {
        const original = `<p>{{ x }}</p>`;
        const virtual = `// x\nconst x = 1;\n{ const x = "" }`;
        const x = inside(original, "{{ [x] }}");
        return {
            title: "Hover over an identifier projected three times",
            caption: [
                "Hover runs at every single-segment projection. The comment copy produces nothing; both declarations produce",
                "a hover, and both are shown.",
            ],
            original,
            virtual,
            segments: [
                { original: x, virtual: inside(virtual, "// [x]"), kind: "verbatim" },
                { original: x, virtual: inside(virtual, "const [x] = 1"), kind: "verbatim" },
                { original: x, virtual: inside(virtual, `const [x] = ""`), kind: "verbatim" },
            ],
            marks: [
                { side: "original", range: x, style: "input", label: "hover" },
                { side: "virtual", range: inside(virtual, "// [x]"), style: "dropped", label: "no hover" },
                { side: "virtual", range: inside(virtual, "const [x] = 1"), style: "output", label: "const x: 1" },
                { side: "virtual", range: inside(virtual, `const [x] = ""`), style: "output", label: `const x: ""` },
            ],
        };
    },

    "signature-help"() {
        const original = `<p>{{ use(1) }}</p>`;
        const virtual = `// use(1)\nuse(1);\nfunction use(n: number) {}`;
        return {
            title: "Signature help takes the first projection that answers",
            caption: [
                "The call is copied into a comment and into executable code. The comment copy has no signature help,",
                "so the executable copy's result is returned.",
            ],
            original,
            virtual,
            segments: [
                { original: find(original, "use(1)"), virtual: find(virtual, "use(1)", 0), kind: "verbatim" },
                { original: find(original, "use(1)"), virtual: find(virtual, "use(1)", 1), kind: "verbatim" },
            ],
            marks: [
                { side: "original", range: inside(original, "use([]1)"), style: "input", label: "signature help" },
                { side: "virtual", range: inside(virtual, "use([]1)", 0), style: "dropped", label: "nothing" },
                { side: "virtual", range: inside(virtual, "use([]1)", 1), style: "output", label: "use(n: number): void" },
            ],
        };
    },

    "completions"() {
        const original = `<p>{{ user.na }}</p>`;
        const virtual = `user.na;\nwatch(() => user.na);`;
        return {
            title: "Completions use only the first projection, which must be Exact",
            caption: [
                "The cursor projects into both copies, but only the first is used. The replacement span `na` maps Exact,",
                "so each completion item can replace it; an item whose span did not map exactly would be dropped.",
            ],
            original,
            virtual,
            segments: [
                { original: find(original, "user.na"), virtual: find(virtual, "user.na", 0), kind: "verbatim" },
                { original: find(original, "user.na"), virtual: find(virtual, "user.na", 1), kind: "verbatim" },
            ],
            marks: [
                { side: "original", range: inside(original, "user.[na]"), style: "output", label: "replacement span" },
                { side: "virtual", range: inside(virtual, "user.[na]", 0), style: "output", label: "positions[0]" },
                { side: "virtual", range: inside(virtual, "user.na[]", 1), style: "dropped", label: "ignored" },
            ],
        };
    },

    "definition"() {
        const original = `<script>const msg = "hi"</script><p>{{ msg }}</p>`;
        const virtual = `const msg = "hi";\n(msg);`;
        return {
            title: "Go to definition",
            caption: [
                "The cursor projects into the virtual file, the checker finds the declaration, and the declaration's name",
                "maps back single-segment, so it becomes the target.",
            ],
            original,
            virtual,
            segments: [
                { original: find(original, `const msg = "hi"`), virtual: find(virtual, `const msg = "hi"`), kind: "verbatim" },
                { original: inside(original, "{{ [msg] }}"), virtual: inside(virtual, "([msg])"), kind: "verbatim" },
            ],
            marks: [
                { side: "original", range: inside(original, "{{ [msg] }}"), style: "input", label: "go to definition" },
                { side: "original", range: inside(original, "const [msg]"), style: "output", label: "target" },
                { side: "virtual", range: inside(virtual, "([msg])"), style: "input", label: "projection" },
                { side: "virtual", range: inside(virtual, "const [msg]"), style: "output", label: "declaration name" },
            ],
        };
    },

    "definition-synthesized"() {
        const original = `<p>{{ $props.title }}</p>`;
        const virtual = `declare const $props: { title: string };\n$props.title;`;
        return {
            title: "Definitions in synthesized code are not navigable",
            caption: [
                "The declaration of `title` exists only in synthesized text. Its name maps None, so that declaration is skipped",
                "and there is no definition result.",
            ],
            original,
            virtual,
            segments: [
                { original: find(original, "$props.title"), virtual: find(virtual, "$props.title"), kind: "verbatim" },
            ],
            marks: [
                { side: "original", range: inside(original, "$props.[title]"), style: "input", label: "go to definition" },
                { side: "virtual", range: inside(virtual, "$props.[title]"), style: "input", label: "projection" },
                { side: "virtual", range: inside(virtual, "{ [title]:"), style: "dropped", label: "declaration (None)" },
            ],
        };
    },

    "references"() {
        const original = `<script>let count = 0</script><p>{{ count }}</p>`;
        const virtual = `let count = 0;\nexpose(count);\n(count);`;
        return {
            title: "Find all references drops synthesized references",
            caption: [
                "The checker finds three references. The one inside the synthesized `expose(…)` call maps None and is dropped.",
            ],
            original,
            virtual,
            segments: [
                { original: find(original, "let count = 0"), virtual: find(virtual, "let count = 0"), kind: "verbatim" },
                { original: inside(original, "{{ [count] }}"), virtual: inside(virtual, "\n([count])"), kind: "verbatim" },
            ],
            marks: [
                { side: "original", range: inside(original, "let [count]"), style: "output", label: "reference" },
                { side: "original", range: inside(original, "{{ [count] }}"), style: "input", label: "request + reference" },
                { side: "virtual", range: inside(virtual, "let [count]"), style: "output", label: "Exact" },
                { side: "virtual", range: inside(virtual, "expose([count])"), style: "dropped", label: "None" },
                { side: "virtual", range: inside(virtual, "\n([count])"), style: "output", label: "Exact" },
            ],
        };
    },

    "rename"() {
        // A mapper that emits the script body twice, e.g. once at module scope and once inside a render function.
        const original = `<script>let n = 0; n++</script>`;
        const body = `let n = 0; n++`;
        const virtual = `${body};\nfunction render() { ${body} }`;
        const o = find(original, body);
        return {
            title: "Rename with a duplicated projection",
            caption: [
                "The script body appears twice in the virtual file, so the rename request projects to both copies.",
                "Each copy yields edits for both occurrences of `n`. All four map back to the same two original ranges and are deduplicated.",
            ],
            original,
            virtual,
            segments: [
                { original: o, virtual: find(virtual, body, 0), kind: "verbatim", label: "copy 1" },
                { original: o, virtual: find(virtual, body, 1), kind: "verbatim", label: "copy 2" },
            ],
            marks: [
                { side: "original", range: inside(original, "let [n] = 0"), style: "input", label: "request + edit" },
                { side: "original", range: inside(original, "0; [n]++"), style: "output", label: "edit" },
                { side: "virtual", range: inside(virtual, "let [n] = 0", 0), style: "output" },
                { side: "virtual", range: inside(virtual, "0; [n]++", 0), style: "output" },
                { side: "virtual", range: inside(virtual, "let [n] = 0", 1), style: "output" },
                { side: "virtual", range: inside(virtual, "0; [n]++", 1), style: "output" },
            ],
        };
    },

    "rename-alias"() {
        // A kebab-case tag refers to a PascalCase import. The mapper emits the tag name as an alias segment
        // because the text differs but the entity is the same.
        const original = `<script>import XCounter from "./c"</script><x-counter/>`;
        const virtual = `import XCounter from "./c";\nXCounter();`;
        return {
            title: "Rename skips occurrences that are not exact",
            caption: [
                "Renaming `XCounter` finds two virtual occurrences. The import is verbatim, so its edit maps exactly.",
                "The call maps through an alias segment (`x-counter`), which has Atom fidelity; that occurrence is skipped.",
            ],
            original,
            virtual,
            segments: [
                { original: find(original, `import XCounter from "./c"`), virtual: find(virtual, `import XCounter from "./c"`), kind: "verbatim" },
                { original: find(original, "x-counter"), virtual: find(virtual, "XCounter", 1), kind: "alias" },
            ],
            marks: [
                { side: "original", range: find(original, "XCounter"), style: "output", label: "edit" },
                { side: "original", range: find(original, "x-counter"), style: "dropped", label: "no edit" },
                { side: "virtual", range: find(virtual, "XCounter", 0), style: "output", label: "Exact" },
                { side: "virtual", range: find(virtual, "XCounter", 1), style: "dropped", label: "Atom" },
            ],
        };
    },

    "document-highlights"() {
        const original = `<script>let n = 0</script><p>{{ n }}</p>`;
        const virtual = `let n = 0;\n(n);\ncheck(n);`;
        const templateN = inside(original, "{{ [n] }}");
        return {
            title: "Document highlights are deduplicated by original range",
            caption: [
                "The template expression is copied twice, so there are three virtual highlights but only two original ones.",
            ],
            original,
            virtual,
            segments: [
                { original: find(original, "let n = 0"), virtual: find(virtual, "let n = 0"), kind: "verbatim" },
                { original: templateN, virtual: inside(virtual, "\n([n])"), kind: "verbatim" },
                { original: templateN, virtual: inside(virtual, "check([n])"), kind: "verbatim" },
            ],
            marks: [
                { side: "original", range: inside(original, "let [n]"), style: "input", label: "request + highlight" },
                { side: "original", range: templateN, style: "output", label: "highlight (×2, deduped)" },
                { side: "virtual", range: inside(virtual, "let [n]"), style: "output" },
                { side: "virtual", range: inside(virtual, "\n([n])"), style: "output" },
                { side: "virtual", range: inside(virtual, "check([n])"), style: "output" },
            ],
        };
    },

    "linked-editing"() {
        const original = `<div></div>`;
        const virtual = `<div></div>;\nconst copy = <div></div>;`;
        return {
            title: "Linked editing requires exactly one projection",
            caption: [
                "The element is copied twice. Typing in the opening tag could correspond to either copy's closing tag,",
                "so linked editing (and auto-insert) return nothing.",
            ],
            original,
            virtual,
            segments: [
                { original: [0, original.length], virtual: find(virtual, original, 0), kind: "verbatim" },
                { original: [0, original.length], virtual: find(virtual, original, 1), kind: "verbatim" },
            ],
            marks: [
                { side: "original", range: inside(original, "<[]div>"), style: "input", label: "typing here" },
                { side: "virtual", range: inside(virtual, "<[]div>", 0), style: "dropped", label: "projection 1" },
                { side: "virtual", range: inside(virtual, "<[]div>", 1), style: "dropped", label: "projection 2" },
            ],
        };
    },

    "call-hierarchy"() {
        const original = `<script>function inc() {}</script><button @click="inc()"/>`;
        const virtual = `function inc() {}\nconst onClick = () => inc();`;
        return {
            title: "Incoming calls",
            caption: [
                "The handler is emitted as an arrow function assigned to `const onClick`, which call hierarchy recognizes as a caller.",
                "Its name maps through an atom to `@click`: single-segment, so the caller item is kept. The fromRange covers the callee name `inc`.",
            ],
            original,
            virtual,
            segments: [
                { original: find(original, "function inc() {}"), virtual: find(virtual, "function inc() {}"), kind: "verbatim" },
                { original: find(original, "@click"), virtual: find(virtual, "onClick"), kind: "atom" },
                { original: find(original, "inc()", 1), virtual: find(virtual, "inc()", 1), kind: "verbatim" },
            ],
            marks: [
                { side: "original", range: inside(original, "function [inc]"), style: "input", label: "incoming calls" },
                { side: "original", range: find(original, "@click"), style: "output", label: "caller" },
                { side: "original", range: inside(original, `"[inc]()`), style: "output", label: "fromRange" },
                { side: "virtual", range: find(virtual, "onClick"), style: "output", label: "caller name (Atom)" },
                { side: "virtual", range: inside(virtual, "=> [inc]()"), style: "output", label: "callee (Exact)" },
            ],
        };
    },

    "formatting"() {
        const original = `<script>let a=1</script>`;
        const virtual = `let a=1;\nfunction render() { let a=1 }`;
        return {
            title: "Formatting assigns each original position to one projection",
            caption: [
                "The script is copied twice. The first copy covers the whole original range, so the second is not formatted at all,",
                "and the user receives one set of edits.",
            ],
            original,
            virtual,
            segments: [
                { original: find(original, "let a=1"), virtual: find(virtual, "let a=1", 0), kind: "verbatim", label: "copy 1" },
                { original: find(original, "let a=1"), virtual: find(virtual, "let a=1", 1), kind: "verbatim", label: "copy 2" },
            ],
            marks: [
                { side: "original", range: inside(original, "let a[]=1"), style: "output", label: "insert spaces" },
                { side: "original", range: inside(original, "let a=[]1"), style: "output" },
                { side: "virtual", range: find(virtual, "let a=1", 0), style: "output", label: "formatted" },
                { side: "virtual", range: find(virtual, "let a=1", 1), style: "dropped", label: "already covered" },
            ],
        };
    },

    "code-action-top-of-file"() {
        const original = `<script>foo()</script>`;
        const virtual = `/// <reference types="vue" />\nfoo();`;
        return {
            title: "Inserting at the top of a content-mapped file",
            caption: [
                "Adding an import \"at the top of the file\" skips the synthesized header and inserts before the first verbatim segment,",
                "so the import lands inside <script>, not at the beginning of the original file.",
            ],
            original,
            virtual,
            segments: [
                { original: find(original, "foo()"), virtual: find(virtual, "foo()"), kind: "verbatim" },
            ],
            marks: [
                { side: "virtual", range: [find(virtual, "foo")[0], find(virtual, "foo")[0]], style: "output", label: "insert import" },
                { side: "original", range: [0, 0], style: "dropped", label: "not here" },
                { side: "original", range: [find(original, "foo")[0], find(original, "foo")[0]], style: "output", label: "insert import" },
            ],
        };
    },

    "code-action-conflict"() {
        const original = `<script>let x = f()</script>`;
        const canonical = `let x = f();`;
        const supplemental = `let x = f();`;
        const virtual = `${canonical}    ${supplemental}`;
        const second = virtual.length - supplemental.length;
        return {
            title: "Conflicting edits from two projections make a file unmappable",
            caption: [
                "One tracker accumulates edits in both the canonical file and a supplemental file, and both edits map to the same original point.",
                "Because they come from different projections, identical edits would be deduplicated; different insertions conflict, so the",
                "file is unmappable and the tracker returns no edits for it.",
            ],
            original,
            virtual,
            virtualFiles: [
                { name: "App.vue.ts", range: [0, canonical.length] },
                { name: "App.vue.0.ts", range: [second, virtual.length] },
            ],
            segments: [
                { original: find(original, "let x = f()"), virtual: find(virtual, "let x = f()", 0), kind: "verbatim" },
                { original: find(original, "let x = f()"), virtual: find(virtual, "let x = f()", 1), kind: "verbatim" },
            ],
            marks: [
                { side: "virtual", range: inside(virtual, "let x[] =", 0), style: "output", label: `insert ": A"` },
                { side: "virtual", range: inside(virtual, "let x[] =", 1), style: "output", label: `insert ": B"` },
                { side: "original", range: inside(original, "let x[] ="), style: "dropped", label: "conflict: no edits" },
            ],
        };
    },

    "code-lens"() {
        const original = `<script>function f() { a }\nfunction g() { b }</script>`;
        const virtual = `function f() { track(); a }\nfunction g() { b }`;
        return {
            title: "A code lens range must be fully covered",
            caption: [
                "The mapper injects `track();` into `f`. The lens range for `f` now includes synthesized text and maps None,",
                "so `f` gets no lens. `g` is entirely verbatim and keeps its lens.",
            ],
            original,
            virtual,
            segments: [
                { original: find(original, "function f() {"), virtual: find(virtual, "function f() {"), kind: "verbatim" },
                { original: find(original, " a }\nfunction g() { b }"), virtual: find(virtual, " a }\nfunction g() { b }"), kind: "verbatim" },
            ],
            marks: [
                { side: "original", range: find(original, "function f() { a }"), style: "dropped", label: "no lens" },
                { side: "original", range: find(original, "function g() { b }"), style: "output", label: "lens" },
                { side: "virtual", range: find(virtual, "function f() { track(); a }"), style: "dropped", label: "None" },
                { side: "virtual", range: find(virtual, "function g() { b }"), style: "output", label: "Exact" },
            ],
        };
    },

    "inlay-hints"() {
        const original = `<script>function add(a,b){}</script><p>{{ add(1,2) }}</p>`;
        const virtual = `function add(a,b){}\nadd(1,2);`;
        return {
            title: "Inlay hints use intersecting spans",
            caption: [
                "The visible range starts and ends in markup with no virtual counterpart. Rather than failing, the request is intersected",
                "with each segment, and hints are computed within each intersection.",
            ],
            original,
            virtual,
            segments: [
                { original: find(original, "function add(a,b){}"), virtual: find(virtual, "function add(a,b){}"), kind: "verbatim" },
                { original: find(original, "add(1,2)"), virtual: find(virtual, "add(1,2)"), kind: "verbatim" },
            ],
            marks: [
                { side: "original", range: [find(original, "</script>")[0], original.length], style: "input", label: "visible range", nest: 1 },
                { side: "original", range: inside(original, "add([]1,"), style: "output", label: "a:" },
                { side: "original", range: inside(original, "1,[]2)"), style: "output", label: "b:" },
                { side: "virtual", range: find(virtual, "add(1,2)"), style: "input", label: "intersection", nest: 1 },
                { side: "virtual", range: inside(virtual, "add([]1,", 0), style: "output", label: "a:" },
                { side: "virtual", range: inside(virtual, "1,[]2)"), style: "output", label: "b:" },
            ],
        };
    },

    "semantic-tokens"() {
        const original = `<x-counter :n="n"/>`;
        const virtual = `XCounter({ n: n });`;
        return {
            title: "Semantic tokens must be Exact",
            caption: [
                "A token colors specific characters, so tokens inside atoms and aliases (whose text differs) are dropped.",
                "Only the verbatim value `n` is colored.",
            ],
            original,
            virtual,
            segments: [
                { original: find(original, "x-counter"), virtual: find(virtual, "XCounter"), kind: "alias" },
                { original: find(original, ":n"), virtual: inside(virtual, "{ [n]:"), kind: "atom" },
                { original: inside(original, `="[n]"`), virtual: inside(virtual, ": [n] "), kind: "verbatim" },
            ],
            marks: [
                { side: "original", range: inside(original, `="[n]"`), style: "output", label: "variable" },
                { side: "virtual", range: find(virtual, "XCounter"), style: "dropped", label: "Atom" },
                { side: "virtual", range: inside(virtual, "{ [n]:"), style: "dropped", label: "Atom" },
                { side: "virtual", range: inside(virtual, ": [n] "), style: "output", label: "Exact" },
            ],
        };
    },

    "folding"() {
        const original = `<script>\nif (a) {\n  b()\n}\n</script>`;
        const virtual = `function render() {\nif (a) {\n  b()\n}\n}`;
        const body = `\nif (a) {\n  b()\n}\n`;
        return {
            title: "Folding ranges that include synthesized text are dropped",
            caption: [
                "The mapper wraps the script in a synthesized function. That function's body would fold, but its braces are",
                "synthesized, so the range maps None. The `if` block is verbatim and folds as usual.",
            ],
            original,
            virtual,
            segments: [
                { original: find(original, body), virtual: find(virtual, body), kind: "verbatim" },
            ],
            marks: [
                { side: "original", range: find(original, "{\n  b()\n}"), style: "output", label: "fold" },
                { side: "virtual", range: [find(virtual, "{")[0], virtual.length], style: "dropped", label: "None", nest: 1 },
                { side: "virtual", range: find(virtual, "{\n  b()\n}"), style: "output", label: "Exact" },
            ],
        };
    },

    "selection-ranges"() {
        const original = `<p>{{ a.b }}</p>`;
        const virtual = `__ctx(a.b);`;
        return {
            title: "Selection ranges skip steps that map None",
            caption: [
                "Expanding the selection from `b` walks outward through virtual nodes. `b` and `a.b` map Exact; the call",
                "`__ctx(a.b)` includes synthesized text and is skipped.",
            ],
            original,
            virtual,
            segments: [
                { original: find(original, "a.b"), virtual: find(virtual, "a.b"), kind: "verbatim" },
            ],
            marks: [
                { side: "original", range: inside(original, "a.[b]"), style: "output", label: "1" },
                { side: "original", range: find(original, "a.b"), style: "output", label: "2", nest: 1 },
                { side: "virtual", range: inside(virtual, "a.[b]"), style: "output", label: "1" },
                { side: "virtual", range: find(virtual, "a.b"), style: "output", label: "2", nest: 1 },
                { side: "virtual", range: find(virtual, "__ctx(a.b)"), style: "dropped", label: "skipped", nest: 2 },
            ],
        };
    },

    "document-symbols"() {
        const original = `<script>function inc() {}</script>`;
        const virtual = `function render() {}\nfunction inc() {}`;
        return {
            title: "Document symbols need a single-segment name",
            caption: [
                "`render` is synthesized, so it is not in the outline. `inc` has a verbatim name (selectionRange) and",
                "a verbatim declaration (range).",
            ],
            original,
            virtual,
            segments: [
                { original: find(original, "function inc() {}"), virtual: find(virtual, "function inc() {}"), kind: "verbatim" },
            ],
            marks: [
                { side: "original", range: inside(original, "function [inc]"), style: "output", label: "selectionRange" },
                { side: "original", range: find(original, "function inc() {}"), style: "output", label: "range", nest: 1 },
                { side: "virtual", range: find(virtual, "render"), style: "dropped", label: "None" },
                { side: "virtual", range: inside(virtual, "function [inc]"), style: "output", label: "Exact" },
            ],
        };
    },
};

// #endregion

const only = process.argv.slice(2);
for (const [name, spec] of Object.entries(examples)) {
    if (only.length && !only.includes(name)) continue;
    const file = path.join(outDir, `${name}.svg`);
    fs.writeFileSync(file, renderRibbon(spec()));
    console.log(`wrote ${path.relative(process.cwd(), file)}`);
}
