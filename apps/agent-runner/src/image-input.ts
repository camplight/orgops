import type { LlmMessage } from "@orgops/llm";

/** Replaces an image the model cannot read, so it can tell the person instead of failing. */
export const IMAGE_OMITTED_NOTE =
  "[An image was attached here, but this model cannot read images, so it was left out. If the image matters, tell the person you cannot see it and that an image-capable model can.]";

function isImagePart(part: unknown): boolean {
  return Boolean(part && typeof part === "object" && (part as { type?: unknown }).type === "image");
}

export function hasImageParts(messages: LlmMessage[]): boolean {
  return messages.some(
    (message) => Array.isArray(message.content) && message.content.some(isImagePart),
  );
}

export function withoutImageParts(messages: LlmMessage[]): LlmMessage[] {
  return messages.map((message) => {
    if (!Array.isArray(message.content) || !message.content.some(isImagePart)) return message;
    const content = message.content.map((part) =>
      isImagePart(part) ? { type: "text" as const, text: IMAGE_OMITTED_NOTE } : part,
    );
    return { ...message, content } as LlmMessage;
  });
}

/** Providers reject image parts for text-only models with messages such as
 * "Invalid image or video input" (Fireworks) or "No endpoints found that support image input". */
export function isImageInputRejected(error: unknown): boolean {
  const record = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const text = [String(error), record.message, record.responseBody]
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (!/\b(image|images|vision|multimodal)\b/.test(text)) return false;
  return /invalid|unsupported|not support|does not support|doesn't support|no endpoints/.test(text);
}
