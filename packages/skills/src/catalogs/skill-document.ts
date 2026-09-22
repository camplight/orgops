import { CATALOG_LIMITS, validateCatalogJson, type ContractResult } from "@orgops/schemas";
import YAML, { isAlias, isMap, isNode, visit } from "yaml";

export function parseSkillDocument(text: string, expectedName: string): ContractResult<{
  name: string; description: string; license?: string;
}> {
  const boundedText = validateCatalogJson(text, CATALOG_LIMITS.contentJsonBytes);
  if (!boundedText.ok) return boundedText;
  const boundedName = validateCatalogJson(expectedName, CATALOG_LIMITS.manifestJsonBytes);
  if (!boundedName.ok) return boundedName;
  const invalid = (): ContractResult<never> => ({ ok: false, issues: [{ code: "INVALID_SKILL", at: "SKILL.md" }] });
  if (typeof text !== "string" || typeof expectedName !== "string") return invalid();
  if (Buffer.byteLength(text, "utf8") > CATALOG_LIMITS.fileBytes) return { ok: false, issues: [{ code: "LIMIT_EXCEEDED", at: "SKILL.md" }] };
  const match = /^---\r?\n([\s\S]*?)^---(?:\r?\n|$)/m.exec(text);
  if (!match || match.index !== 0) return invalid();
  try {
    const document = YAML.parseDocument(match[1]!, { uniqueKeys: true });
    if (document.errors.length || !isMap(document.contents)) return invalid();
    let forbidden = false;
    visit(document, (_key, node) => {
      if (isAlias(node) || (isNode(node) && (node.anchor || (node.tag && !/^tag:yaml\.org,2002:(?:str|map|seq|int|float|bool|null|timestamp|binary|set|omap|pairs)$/.test(node.tag))))) forbidden = true;
    });
    if (forbidden) return invalid();
    // Read scalar fields from the AST; other metadata stays inert, never expanded.
    const name: unknown = document.get("name");
    const description: unknown = document.get("description");
    const license: unknown = document.get("license");
    if (typeof name !== "string" || !name.trim() || name !== expectedName
      || typeof description !== "string" || !description.trim()
      || (document.has("license") && typeof license !== "string")) return invalid();
    const value = { name, description, ...(typeof license === "string" ? { license } : {}) };
    const json = validateCatalogJson(value, CATALOG_LIMITS.contentJsonBytes);
    if (!json.ok) return invalid();
    return { ok: true, value: Object.freeze(value) };
  } catch {
    return invalid();
  }
}
