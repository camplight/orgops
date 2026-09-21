import { z } from "zod";
import { CatalogIdSchema, SourceIdSchema, PositiveIntegerSchema, RelativePathSchema, jsonString, nonblank } from "./primitives";

// Validate authored bytes before URL can erase unsafe paths or ambiguous hosts.
function canonicalRepositoryUrl(value: string): string | undefined {
  if (value.length < 1 || value.length > 2048 || /[^\x21-\x7e]|[\\%?#@]/.test(value)) return undefined;
  const match = /^(https|ssh):\/\/([^/]+)\/(.+)$/i.exec(value);
  if (!match) return undefined;
  const scheme = match[1]!.toLowerCase();
  const authority = match[2]!;
  const path = match[3]!;
  if (!path.split("/").every(segment => /^[A-Za-z0-9._~-]{1,128}$/.test(segment) && segment !== "." && segment !== "..")) return undefined;
  const hostPort = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(?::([0-9]+))?$/.exec(authority);
  if (!hostPort) return undefined;
  const host = hostPort[1]!;
  const port = hostPort[2];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return undefined;
  if (!host.startsWith("[")) {
    if (host.length > 253 || !host.split(".").every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))) return undefined;
    // WHATWG treats numeric final labels as IPv4, including shorthand/octal/hex.
    if (/^(?:[0-9]+|0x[0-9a-f]*)$/i.test(host.split(".").at(-1)!)) {
      const octets = host.split(".");
      if (octets.length !== 4 || !octets.every(octet => /^(?:0|[1-9][0-9]{0,2})$/.test(octet) && Number(octet) <= 255)) return undefined;
    }
  }
  try {
    const parsed = new URL(`${scheme}://${authority}/${path}`);
    const canonicalPort = port === undefined || Number(port) === (scheme === "https" ? 443 : 22) ? "" : `:${Number(port)}`;
    return `${scheme}://${parsed.hostname.toLowerCase()}${canonicalPort}/${path}`;
  } catch { return undefined; }
}

export const GitRepositorySchema = z.object({
  url: z.string(),
  sshUser: z.string().min(1).max(64).regex(/^[A-Za-z0-9_][A-Za-z0-9._-]*$/).optional(),
}).strict().transform((value, ctx) => {
  const url = canonicalRepositoryUrl(value.url);
  if (!url || (url.startsWith("ssh:") ? value.sshUser === undefined : Object.hasOwn(value, "sshUser"))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid repository configuration" });
    return z.NEVER;
  }
  return value.sshUser === undefined ? { url } : { url, sshUser: value.sshUser };
});
export type GitRepository = z.infer<typeof GitRepositorySchema>;

export const CatalogRefSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/)
  .refine(value => !value.includes("..") && !value.includes("//") && !value.endsWith("/") && !value.endsWith(".")
    && value.split("/").every(part => !part.startsWith(".") && !part.endsWith(".lock")));
export type CatalogRef = z.infer<typeof CatalogRefSchema>;
const controls = /[\u0000-\u001f\u007f-\u009f]/;
// Up to 128 code points require at most 256 UTF-16 units; keep shared surrogate validation.
const DisplayNameSchema = nonblank(256).refine(value => [...value].length <= 128 && !controls.test(value));
const RevisionSchema = PositiveIntegerSchema;

export const SourceCreateSchema = z.object({
  sourceId: SourceIdSchema, repository: GitRepositorySchema,
  enabled: z.boolean(), allowPackages: z.boolean(),
}).strict();
export type SourceCreate = z.infer<typeof SourceCreateSchema>;
export const SourceUpdateSchema = z.object({
  expectedRevision: RevisionSchema, enabled: z.boolean().optional(), allowPackages: z.boolean().optional(),
}).strict().refine(value => value.enabled !== undefined || value.allowPackages !== undefined);
export type SourceUpdate = z.infer<typeof SourceUpdateSchema>;
export const CatalogCreateSchema = z.object({
  catalogId: CatalogIdSchema, sourceId: SourceIdSchema, displayName: DisplayNameSchema,
  ref: CatalogRefSchema, enabled: z.boolean(),
}).strict();
export type CatalogCreate = z.infer<typeof CatalogCreateSchema>;
export const CatalogUpdateSchema = z.object({
  expectedRevision: RevisionSchema, displayName: DisplayNameSchema.optional(),
  ref: CatalogRefSchema.optional(), enabled: z.boolean().optional(),
}).strict().refine(value => value.displayName !== undefined || value.ref !== undefined || value.enabled !== undefined);
export type CatalogUpdate = z.infer<typeof CatalogUpdateSchema>;
export const RevisionRequestSchema = z.object({ expectedRevision: RevisionSchema }).strict();
export type RevisionRequest = z.infer<typeof RevisionRequestSchema>;
const credentialText = (maxBytes: number) => jsonString(maxBytes, 1)
  .refine(value => !controls.test(value) && Buffer.byteLength(value, "utf8") <= maxBytes);
export const ReadCredentialSetSchema = z.object({
  expectedRevision: RevisionSchema, kind: z.literal("https-basic"),
  username: credentialText(256).refine(value => !value.includes(":")), password: credentialText(4096),
}).strict();
export type ReadCredentialSet = z.infer<typeof ReadCredentialSetSchema>;

export const CatalogSyncRequestSchema = z.object({
  expectedRevision: RevisionSchema, indexPath: RelativePathSchema,
}).strict();
export type CatalogSyncRequest = z.infer<typeof CatalogSyncRequestSchema>;

export const CatalogConfigurationAuditSchema = z.object({
  actorHumanId: z.string().min(1).max(128), sourceId: SourceIdSchema, catalogId: CatalogIdSchema.optional(),
  action: z.enum(["source.create", "source.update", "source.remove", "source.restore",
    "catalog.create", "catalog.update", "catalog.remove", "catalog.restore", "read-credential.set", "read-credential.revoke"]),
  revision: RevisionSchema,
}).strict().refine(value => value.action.startsWith("catalog.") ? value.catalogId !== undefined : !Object.hasOwn(value, "catalogId"));
export type CatalogConfigurationAudit = z.infer<typeof CatalogConfigurationAuditSchema>;
