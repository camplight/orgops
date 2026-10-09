export type MarkdownPart =
  | { kind: "markdown"; text: string }
  | { kind: "json-render"; specText: string };

const FENCE_RE = /(^|\n)([ \t]{0,3})(`{3,}|~{3,})[ \t]*([^\n`]*)\n([\s\S]*?)(?:\n\2\3[ \t]*(?=\n|$)|$)/g;

function isJsonRenderInfo(info: string) {
  return /^json-render(?:\s|$)/i.test(info.trim());
}

export function splitJsonRenderMarkdown(text: string): MarkdownPart[] {
  const parts: MarkdownPart[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(FENCE_RE)) {
    const fullMatch = match[0];
    const leadingNewline = match[1] ?? "";
    const info = match[4] ?? "";
    const body = match[5] ?? "";
    const start = match.index ?? 0;
    const fenceStart = start + leadingNewline.length;

    if (!isJsonRenderInfo(info)) continue;

    if (fenceStart > lastIndex) {
      parts.push({ kind: "markdown", text: text.slice(lastIndex, fenceStart) });
    }
    parts.push({ kind: "json-render", specText: body.trim() });
    lastIndex = start + fullMatch.length;
  }

  if (lastIndex < text.length) {
    parts.push({ kind: "markdown", text: text.slice(lastIndex) });
  }

  return parts.length > 0 ? parts.filter((part) => part.kind !== "markdown" || part.text.length > 0) : [{ kind: "markdown", text }];
}

export function hasJsonRenderBlock(text: string) {
  return splitJsonRenderMarkdown(text).some((part) => part.kind === "json-render");
}
