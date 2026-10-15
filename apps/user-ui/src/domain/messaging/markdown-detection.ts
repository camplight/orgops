import { hasJsonRenderBlock } from "../../jsonRenderMarkdown";
import { hasSecretInputBlock } from "../../secretInputMarkdown";

const MARKDOWN_HINT_RE =
  /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>\s)|`{1,3}[^`]|(\*\*|__)[^*_]+(\*\*|__)|(\*|_)[^*_]+(\*|_)|\[[^\]]+\]\([^)]+\)|!\[[^\]]*\]\([^)]+\)|(^|\n)\|.+\|/m;
const URL_RE = /(https?:\/\/[^\s<]+)/i;

export function shouldRenderMarkdown(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return hasJsonRenderBlock(trimmed) || hasSecretInputBlock(trimmed) || MARKDOWN_HINT_RE.test(trimmed) || URL_RE.test(trimmed);
}
