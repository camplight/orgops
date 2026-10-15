import type { Clipboard } from "../../ports/clipboard";

export function createBrowserClipboard(): Clipboard {
  return {
    writeText: (text) => navigator.clipboard.writeText(text)
  };
}
