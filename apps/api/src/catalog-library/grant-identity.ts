import { createHash } from "node:crypto";
import { GrantViewSchema, PackageReleaseIdSchema, type GrantView } from "@orgops/schemas";

export function catalogGrantId(releaseId: string, subject: "ORGANIZATION" | "HUMAN", humanId?: string): string {
  return `grant-${createHash("sha256").update(JSON.stringify([releaseId, subject, humanId ?? ""])).digest("hex")}`;
}

export function parseCanonicalCatalogGrant(input: unknown): GrantView | undefined {
  const parsed = GrantViewSchema.safeParse(input);
  if (!parsed.success) return undefined;
  const { releaseId, subject } = parsed.data;
  if (!PackageReleaseIdSchema.safeParse(releaseId).success) return undefined;
  const expected = subject.kind === "ORGANIZATION"
    ? catalogGrantId(releaseId, "ORGANIZATION")
    : catalogGrantId(releaseId, "HUMAN", subject.humanId);
  return parsed.data.grantId === expected ? parsed.data : undefined;
}
