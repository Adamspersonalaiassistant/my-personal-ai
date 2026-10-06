// Assistant message formatting, shared by Emery and JARVIS.
//
// Models write lightweight markdown. The chat UI used to print it verbatim
// (`whitespace-pre-wrap`), so Adam saw raw `##`, `**` and pipes. This module
// parses the small subset we allow into display blocks; the React renderer
// (AssistantText) turns blocks into elements — never HTML strings — and
// `toSpeakable` flattens the same text for Voice.
//
// Pure module: no React, no DOM. Tested in scripts/validate-response-format.mjs.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { type: "title"; inline: Inline[] }
  | { type: "numbered"; n: number; inline: Inline[] }
  | { type: "bullet"; depth: 0 | 1; inline: Inline[] }
  | { type: "paragraph"; inline: Inline[] }
  | { type: "code"; text: string };

const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const WHOLE_BOLD = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*:?\s*$/;
const NUMBERED = /^\s{0,3}(\d{1,2})[.)]\s+(.*)$/;
const BULLET = /^(\s*)[-*•]\s+(.*)$/;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE = /^\s*```/;

/** Inline markdown → segments. Unknown syntax stays as literal text. */
export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  // No lookbehind: older iOS Safari cannot parse it and the chat would not load.
  const pattern = /(\*\*|__)(.+?)\1|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ kind: "text", text: source.slice(last, index) });
    if (match[2] !== undefined) out.push({ kind: "strong", text: match[2] });
    else if (match[3] !== undefined) out.push({ kind: "code", text: match[3] });
    else if (match[4] !== undefined && match[5] !== undefined)
      out.push({ kind: "link", text: match[4], href: match[5] });
    last = index + match[0].length;
  }
  if (last < source.length) out.push({ kind: "text", text: source.slice(last) });
  // Merge adjacent text and drop any leftover heading/bold markers.
  const merged: Inline[] = [];
  for (const part of out) {
    const prev = merged[merged.length - 1];
    if (part.kind === "text" && prev?.kind === "text") prev.text += part.text;
    else merged.push({ ...part });
  }
  return merged
    .map((part) =>
      part.kind === "text"
        ? {
            ...part,
            // Leftover bold markers and single-asterisk emphasis (*word*) are presentation only.
            text: part.text
              .replace(/\*\*|__/g, "")
              .replace(/(^|[\s(])\*([^*\s](?:[^*\n]*[^*\s])?)\*(?=[\s).,;:!?]|$)/g, "$1$2"),
          }
        : part,
    )
    .filter((part) => part.kind !== "text" || part.text.length > 0);
}

function tableCells(line: string) {
  return (TABLE_ROW.exec(line)?.[1] ?? "")
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean);
}

/** Text → display blocks. Deep nesting is flattened to one level for phone screens. */
export function parseAssistantText(raw: string): Block[] {
  const lines = String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let tableHeader: string[] | null = null;
  const flush = () => {
    if (paragraph.length)
      blocks.push({ type: "paragraph", inline: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (FENCE.test(line)) {
      flush();
      const body: string[] = [];
      for (i += 1; i < lines.length && !FENCE.test(lines[i]!); i += 1) body.push(lines[i]!);
      if (body.length) blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }
    if (!line.trim() || RULE.test(line)) {
      flush();
      tableHeader = null;
      continue;
    }
    if (TABLE_ROW.test(line)) {
      flush();
      if (TABLE_RULE.test(line)) continue;
      const cells = tableCells(line);
      const next = lines[i + 1] ?? "";
      if (!tableHeader && TABLE_RULE.test(next)) {
        tableHeader = cells; // header row: becomes labels for the rows below
        continue;
      }
      // Tables are too wide for a phone: each row becomes one bullet.
      const text = cells
        .map((cell, c) => (tableHeader?.[c] && c > 0 ? `${tableHeader[c]}: ${cell}` : cell))
        .join(" · ");
      blocks.push({ type: "bullet", depth: 0, inline: parseInline(text) });
      continue;
    }
    tableHeader = null;
    const heading = HEADING.exec(line) ?? WHOLE_BOLD.exec(line);
    if (heading && heading[1]!.length <= 90) {
      flush();
      blocks.push({ type: "title", inline: parseInline(heading[1]!.replace(/:$/, "")) });
      continue;
    }
    const numbered = NUMBERED.exec(line);
    if (numbered) {
      flush();
      blocks.push({ type: "numbered", n: Number(numbered[1]), inline: parseInline(numbered[2]!) });
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      flush();
      const indent = bullet[1]!.replace(/\t/g, "  ").length;
      blocks.push({ type: "bullet", depth: indent >= 2 ? 1 : 0, inline: parseInline(bullet[2]!) });
      continue;
    }
    const continuation = blocks[blocks.length - 1];
    if (
      !paragraph.length &&
      /^\s{2,}\S/.test(line) &&
      continuation &&
      (continuation.type === "bullet" || continuation.type === "numbered")
    ) {
      continuation.inline.push({ kind: "text", text: " " }, ...parseInline(line.trim()));
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

export function inlineText(inline: Inline[]) {
  return inline.map((part) => part.text).join("");
}

/** Plain text with no markdown tokens — for Voice and anywhere markup can't render. */
export function toSpeakable(raw: string) {
  return parseAssistantText(raw)
    .map((block) => {
      if (block.type === "code") return "";
      const text = inlineText(block.inline).trim();
      if (block.type === "numbered") return `${block.n}. ${text}`;
      if (block.type === "title") return /[.!?:]$/.test(text) ? text : `${text}.`;
      return text;
    })
    .filter(Boolean)
    .join("\n");
}
