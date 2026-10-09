export type SecretInputSpec = {
  packageId: string;
  key: string;
  label: string;
  submitLabel: string;
  description: string;
  scopeType: string;
  scopeId: string;
};

export type SecretInputMarkdownPart =
  | { kind: "markdown"; text: string }
  | { kind: "secret-input"; spec: SecretInputSpec };

const SECRET_INPUT_TAG_RE =
  /<orgops-secret-input\b([\s\S]*?)(?:\/>|>\s*<\/orgops-secret-input>)/gi;
const ATTR_RE = /([:@A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function readAttr(attrs: Record<string, string>, ...names: string[]) {
  for (const name of names) {
    const value = attrs[name];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return "";
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(ATTR_RE)) {
    const name = String(match[1] ?? "").trim().toLowerCase();
    if (!name) continue;
    const value = match[2] ?? match[3] ?? "";
    attrs[name] = value;
  }
  return attrs;
}

function parseSpec(rawAttrs: string): SecretInputSpec | null {
  const attrs = parseAttributes(rawAttrs);
  const packageId = readAttr(attrs, "package", "packageid");
  const key = readAttr(attrs, "key", "name");
  if (!packageId || !key) return null;
  return {
    packageId,
    key,
    label: readAttr(attrs, "label"),
    submitLabel: readAttr(attrs, "submit-label", "submitlabel"),
    description: readAttr(attrs, "description"),
    scopeType: readAttr(attrs, "scope-type", "scopetype"),
    scopeId: readAttr(attrs, "scope-id", "scopeid"),
  };
}

export function splitSecretInputMarkdown(text: string): SecretInputMarkdownPart[] {
  const parts: SecretInputMarkdownPart[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(SECRET_INPUT_TAG_RE)) {
    const fullMatch = match[0] ?? "";
    const attrsRaw = match[1] ?? "";
    const start = match.index ?? 0;
    const spec = parseSpec(attrsRaw);
    if (!spec) continue;

    if (start > lastIndex) {
      parts.push({ kind: "markdown", text: text.slice(lastIndex, start) });
    }
    parts.push({ kind: "secret-input", spec });
    lastIndex = start + fullMatch.length;
  }

  if (lastIndex < text.length) {
    parts.push({ kind: "markdown", text: text.slice(lastIndex) });
  }

  if (parts.length === 0) return [{ kind: "markdown", text }];
  return parts.filter((part) => part.kind !== "markdown" || part.text.length > 0);
}

export function hasSecretInputBlock(text: string) {
  return splitSecretInputMarkdown(text).some((part) => part.kind === "secret-input");
}
