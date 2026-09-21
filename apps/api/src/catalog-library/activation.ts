import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import * as fs from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { createContext, Script } from "node:vm";
import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import ts from "typescript";
import * as trustedZod from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { OrgOpsDb } from "@orgops/db";
export { createRolloutCoordinator, recomputeRolloutAggregate, RolloutError } from "./rollout";
import {
  ApiActivationFailureCodeSchema,
  ApiActivationStateViewSchema,
  CatalogAuditEventSchema,
  DigestSchema,
  HumanAdminSchema,
  IMMUTABLE_EVENT_SCHEMA_JSON,
  PackageManifestSchema,
  PackageReleaseIdSchema,
  RelativePathSchema,
  serializeEventShapes,
  validateEventAgainstShapes,
  type ApiActivationResult,
  type ApiExecutionCoordinator,
  type CatalogAuditEvent,
  type CatalogLibraryErrorCode,
  type EventShapeDefinition,
  type HumanAdmin,
  type PackageManifest,
} from "@orgops/schemas";

const MAX_REVISION = 2_147_483_647;
const MAX_DEFINITIONS = 1_024;
const MAX_SERIALIZED_BYTES = 1024 * 1024;
const MAX_CAPTURED_SOURCE_BYTES = 256 * 1024;
const MAX_TRANSPILED_BYTES = 1024 * 1024;
const MAX_MODULE_EXPORTS = 64;
const MODULE_EXECUTION_TIMEOUT_MS = 100;
const TYPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const DEFINITION_KEYS = new Set(["type", "description", "source", "payloadSchema", "eventSchema", "payloadExample"]);
const LEGACY_DUPLICATE_FINGERPRINTS = Object.freeze(new Set([
  "message.created|core|ff10fe5abd539da023dc4aed323f5d15d37271cf04563b21e8c515af47297a2d",
  "message.created|skill:slack|24c84b32b8078b75cf13764801f8102af7782ac6bdd3e00493b535f1e98eb9f9",
  "channel.event.created|core|538eef826561d45aa13f02098f5d37bbd89eac32c172ad897a2e1a9626f2375a",
  "channel.event.created|skill:slack|9889e05e18f85a801fcae5163a8dc69704c122e59eabb1a4687052e186e2ac71",
  "channel.command.requested|core|2e554957f3a52a01e70013b3ec5206b24ce8fc8fd8a5082dc23ea9757043b875",
  "channel.command.requested|skill:slack|74abf9b5d6d433dd6f2bfed10e882626e7b9233ed320dc9ef921432a143c9195",
]));

type ActivationErrorCode = Extract<CatalogLibraryErrorCode,
  "INVALID_REQUEST" | "FORBIDDEN" | "NOT_FOUND" | "REVISION_CONFLICT" | "STATE_CONFLICT" |
  "SOURCE_NOT_ALLOWED" | "RELEASE_NOT_APPROVED" | "INSTALLATION_REQUIRED" | "INSPECTION_FAILED" |
  "OPERATION_IN_PROGRESS" | "STORAGE_FAILURE"
>;

export class ApiExecutionError extends Error {
  constructor(readonly code: ActivationErrorCode) { super(code); }
}
function fail(code: ActivationErrorCode): never { throw new ApiExecutionError(code); }
function required<T>(value: T | undefined, code: ActivationErrorCode): T {
  return value === undefined ? fail(code) : value;
}

export type EventShapeSnapshot = Readonly<{
  shapes: readonly EventShapeDefinition[];
  loadErrors: readonly { skill: string; error: string }[];
  version: number;
}>;
export type AtomicEventShapeRegistry = {
  snapshot(): EventShapeSnapshot;
  swap(
    candidate: readonly EventShapeDefinition[],
    loadErrors?: readonly { skill: string; error: string }[],
    compatibleDuplicateCounts?: ReadonlyMap<string, number>,
  ): { rollback(): void };
  failNextSwapForTest(): void;
};

function cloneFrozenExample(
  value: unknown,
  depth = 0,
  seen = new Set<object>(),
  budget = { remaining: 10_000 },
): unknown {
  if (depth > 32 || budget.remaining-- <= 0) throw new Error("invalid event-shape example");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("invalid event-shape example");
    return value;
  }
  if (typeof value !== "object" || seen.has(value)) throw new Error("invalid event-shape example");
  seen.add(value);
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(value); }
  catch { throw new Error("invalid event-shape example"); }
  if (Object.values(descriptors).some(descriptor => !Object.hasOwn(descriptor, "value"))) throw new Error("invalid event-shape example");
  const output: unknown[] | Record<string, unknown> = Array.isArray(value) ? [] : {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (Array.isArray(value) && key === "length") continue;
    if (!descriptor.enumerable) throw new Error("invalid event-shape example");
    (output as Record<string, unknown>)[key] = cloneFrozenExample(descriptor.value, depth + 1, seen, budget);
  }
  seen.delete(value);
  return Object.freeze(output);
}

const immutableSchemaCompiler = new Ajv({ allErrors: true, strict: true, validateFormats: false });
const immutableSchemaAdapters = new WeakSet<object>();

function assertSupportedCatalogSchema(schema: trustedZod.ZodTypeAny, depth = 0, seen = new Set<object>(), budget = { remaining: 10_000 }): void {
  if (depth > 32 || budget.remaining-- <= 0 || seen.has(schema)) throw new Error("unsupported catalog event-shape schema");
  seen.add(schema);
  const definition = schema._def as Record<string, unknown>;
  const typeName = definition.typeName;
  if (definition.coerce === true) throw new Error("unsupported catalog event-shape schema");
  const visit = (child: unknown) => {
    if (!(child instanceof trustedZod.ZodType)) throw new Error("unsupported catalog event-shape schema");
    assertSupportedCatalogSchema(child, depth + 1, seen, budget);
  };
  switch (typeName) {
    case "ZodString": {
      const checks = definition.checks as Array<{ kind?: string }> | undefined;
      if (checks?.some(check => !["min", "max", "length"].includes(check.kind ?? ""))) throw new Error("unsupported catalog event-shape schema");
      break;
    }
    case "ZodNumber": {
      const checks = definition.checks as Array<{ kind?: string }> | undefined;
      if (checks?.some(check => !["int", "min", "max", "multipleOf", "finite"].includes(check.kind ?? ""))) throw new Error("unsupported catalog event-shape schema");
      break;
    }
    case "ZodBoolean":
    case "ZodNull":
    case "ZodAny":
    case "ZodUnknown":
    case "ZodNever":
      break;
    case "ZodLiteral": {
      const value = definition.value;
      if (value !== null && typeof value !== "string" && typeof value !== "boolean"
        && (typeof value !== "number" || !Number.isFinite(value))) throw new Error("unsupported catalog event-shape schema");
      break;
    }
    case "ZodEnum":
    case "ZodNativeEnum":
      break;
    case "ZodObject": {
      if (definition.unknownKeys === "strip") throw new Error("unsupported catalog event-shape schema");
      const shape = (definition.shape as (() => Record<string, unknown>) | undefined)?.();
      if (!shape || typeof shape !== "object") throw new Error("unsupported catalog event-shape schema");
      for (const child of Object.values(shape)) visit(child);
      if (definition.catchall) visit(definition.catchall);
      break;
    }
    case "ZodArray":
      visit(definition.type);
      break;
    case "ZodOptional":
    case "ZodNullable":
      visit(definition.innerType);
      break;
    case "ZodUnion":
      for (const child of (definition.options as unknown[] | undefined) ?? []) visit(child);
      break;
    case "ZodDiscriminatedUnion":
      for (const child of (definition.options as Map<unknown, unknown> | undefined)?.values() ?? []) visit(child);
      break;
    case "ZodRecord":
      visit(definition.keyType);
      visit(definition.valueType);
      break;
    case "ZodTuple":
      for (const child of (definition.items as unknown[] | undefined) ?? []) visit(child);
      if (definition.rest) visit(definition.rest);
      break;
    case "ZodIntersection":
      visit(definition.left);
      visit(definition.right);
      break;
    default:
      throw new Error("unsupported catalog event-shape schema");
  }
  seen.delete(schema);
}

function immutableValidationFailure(errors?: readonly ErrorObject[] | null) {
  return Object.freeze({
    success: false as const,
    error: Object.freeze({ issues: Object.freeze((errors?.length ? errors : [{ message: "Schema validation failed" }]).map(error => Object.freeze({
      path: Object.freeze([]),
      message: typeof error.message === "string" && error.message.length > 0 ? error.message : "Schema validation failed",
    }))) }),
  });
}

function compileCatalogSchema(schema: unknown): EventShapeDefinition["payloadSchema"] {
  if (!(schema instanceof trustedZod.ZodType)) throw new Error("invalid event-shape schema");
  assertSupportedCatalogSchema(schema);
  let serialized: string;
  try { serialized = JSON.stringify(zodToJsonSchema(schema, { target: "jsonSchema7" })); }
  catch { throw new Error("unsupported catalog event-shape schema"); }
  if (!serialized || Buffer.byteLength(serialized, "utf8") > MAX_SERIALIZED_BYTES) throw new Error("unsupported catalog event-shape schema");
  const jsonSchema = cloneFrozenExample(JSON.parse(serialized));
  let validate: ValidateFunction;
  try { validate = immutableSchemaCompiler.compile(jsonSchema as object); }
  catch { throw new Error("unsupported catalog event-shape schema"); }
  const adapter = Object.freeze({
    [IMMUTABLE_EVENT_SCHEMA_JSON]: jsonSchema,
    safeParse(input: unknown) {
      try {
        return validate(input)
          ? Object.freeze({ success: true as const, data: input })
          : immutableValidationFailure(validate.errors);
      } catch { return immutableValidationFailure(); }
    },
  });
  immutableSchemaAdapters.add(adapter);
  return adapter as unknown as EventShapeDefinition["payloadSchema"];
}

function snapshotSchema(schema: unknown): EventShapeDefinition["payloadSchema"] {
  if (!schema || typeof schema !== "object"
    || (!immutableSchemaAdapters.has(schema) && !(schema instanceof trustedZod.ZodType))) throw new Error("invalid event-shape schema");
  return schema as EventShapeDefinition["payloadSchema"];
}

function defensiveDefinition(shape: EventShapeDefinition): EventShapeDefinition {
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(shape); }
  catch { throw new Error("invalid event-shape definition"); }
  if (Object.values(descriptors).some(descriptor => !Object.hasOwn(descriptor, "value"))) throw new Error("invalid event-shape definition");
  const value = Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value])) as Record<string, unknown>;
  const normalized = {
    ...value,
    ...(value.payloadSchema === undefined ? {} : { payloadSchema: snapshotSchema(value.payloadSchema) }),
    ...(value.eventSchema === undefined ? {} : { eventSchema: snapshotSchema(value.eventSchema) }),
    ...(Object.hasOwn(value, "payloadExample") ? { payloadExample: cloneFrozenExample(value.payloadExample) } : {}),
  } as EventShapeDefinition;
  return Object.freeze(normalized);
}

function frozenSnapshot(
  shapes: readonly EventShapeDefinition[],
  loadErrors: readonly { skill: string; error: string }[],
  version: number,
): EventShapeSnapshot {
  const definitions = shapes.map(defensiveDefinition);
  const errors = loadErrors.map(error => Object.freeze({ ...error }));
  return Object.freeze({ shapes: Object.freeze(definitions), loadErrors: Object.freeze(errors), version });
}

/** A synchronous all-or-nothing registry swap. Rollback is version-CAS guarded. */
export function createAtomicEventShapeRegistry(initial: readonly EventShapeDefinition[]): AtomicEventShapeRegistry {
  let current = frozenSnapshot(initial, [], 1);
  validateEventShapeRegistry(current.shapes);
  let failSwap = false;
  return {
    snapshot: () => current,
    swap(candidate, loadErrors = [], compatibleDuplicateCounts) {
      const previous = current;
      const installed = frozenSnapshot(candidate, loadErrors, previous.version + 1);
      validateEventShapeRegistry(installed.shapes, compatibleDuplicateCounts);
      if (failSwap) { failSwap = false; throw new Error("registry swap failed"); }
      current = installed;
      let rolledBack = false;
      return {
        rollback() {
          if (rolledBack) return;
          rolledBack = true;
          if (current === installed) current = previous;
        },
      };
    },
    failNextSwapForTest() { failSwap = true; },
  };
}

function hasSchemaApi(value: unknown): value is { safeParse(input: unknown): { success: boolean } } {
  return !!value && typeof value === "object" && typeof (value as { safeParse?: unknown }).safeParse === "function";
}

/** Rejects ambiguous or unbounded definitions before a candidate can become visible. */
export function validateEventShapeRegistry(
  definitions: readonly EventShapeDefinition[],
  compatibleDuplicateCounts: ReadonlyMap<string, number> = new Map(),
): void {
  if (!Array.isArray(definitions) || definitions.length > MAX_DEFINITIONS) throw new Error("invalid event-shape registry");
  const types = new Set<string>();
  for (const definition of definitions) {
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw new Error("invalid event-shape definition");
    if (Object.keys(definition).some(key => !DEFINITION_KEYS.has(key))
      || typeof definition.type !== "string" || !TYPE_PATTERN.test(definition.type)
      || (types.has(definition.type) && definitions.filter(item => item.type === definition.type).length > (compatibleDuplicateCounts.get(definition.type) ?? 1))
      || typeof definition.description !== "string" || definition.description.length < 1 || definition.description.length > 2_000
      || (definition.source !== undefined && definition.source !== "core"
        && (typeof definition.source !== "string" || definition.source.length > 70
          || !/^skill:[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(definition.source)))
      || (definition.payloadSchema !== undefined && !hasSchemaApi(definition.payloadSchema))
      || (definition.eventSchema !== undefined && !hasSchemaApi(definition.eventSchema))
      || (definition.payloadSchema !== undefined && definition.eventSchema !== undefined)) {
      throw new Error("invalid event-shape definition");
    }
    types.add(definition.type);
    if (Object.hasOwn(definition, "payloadExample")) {
      const event = { type: definition.type, source: "agent:validation", channelId: "validation", payload: definition.payloadExample };
      if (!validateEventAgainstShapes(event, [definition]).ok) throw new Error("invalid event-shape example");
    }
  }
  let serialized: unknown;
  try { serialized = serializeEventShapes([...definitions]); } catch { throw new Error("event-shape serialization failed"); }
  if (Buffer.byteLength(JSON.stringify(serialized), "utf8") > MAX_SERIALIZED_BYTES) throw new Error("event-shape registry too large");
}

function exactLegacyDuplicateCounts(definitions: readonly EventShapeDefinition[]): ReadonlyMap<string, number> {
  const grouped = new Map<string, EventShapeDefinition[]>();
  for (const definition of definitions) grouped.set(definition.type, [...(grouped.get(definition.type) ?? []), definition]);
  const compatible = new Map<string, number>();
  for (const [type, entries] of grouped) {
    if (entries.length < 2) continue;
    const keys = entries.map(definition => {
      const serialized = serializeEventShapes([definition])[0];
      const digest = createHash("sha256").update(JSON.stringify({ schemaKind: serialized?.schemaKind, schema: serialized?.schema })).digest("hex");
      return `${type}|${definition.source ?? "core"}|${digest}`;
    });
    if (keys.length === new Set(keys).size && keys.every(key => LEGACY_DUPLICATE_FINGERPRINTS.has(key))) compatible.set(type, entries.length);
  }
  return compatible;
}

export type ApiActivationRelease = Readonly<{
  releaseId: string;
  packageName: string;
  digest: string;
  installationPath: string;
  apiEventShapePaths: readonly string[];
  manifest: PackageManifest;
}>;

/** Immutable base64 captures are the only bytes an authored module loader may evaluate. */
export type VerifiedApiModule = Readonly<{
  releaseId: string;
  releaseDigest: string;
  declaredRelativePath: string;
  digest: string;
  bytes: string;
}>;

type ReleaseRow = {
  package_release_id: string;
  authority_source_id: string;
  content_source_id: string;
  name: string;
  digest: string;
  manifest_json: string;
  execution_preview_json: string;
  review_state: string;
  review_digest: string | null;
  reviewed_by_human_id: string | null;
  reviewed_at: number | null;
  authority_enabled: number;
  authority_removed_at: number | null;
  content_enabled: number;
  content_removed_at: number | null;
  content_allow_packages: number;
  artifact_digest: string | null;
  artifact_path: string | null;
  installation_state: string | null;
};
type ActivationRow = {
  release_id: string;
  approval_state: string;
  runtime_state: string;
  failure_code: string | null;
  approved_digest: string | null;
  approved_by_human_id: string | null;
  approved_at: number | null;
  revision: number;
};

type AuditWriter = (tx: OrgOpsDb, event: CatalogAuditEvent) => void;
export type ApiExecutionCoordinatorDeps = Readonly<{
  db: OrgOpsDb;
  registry: AtomicEventShapeRegistry;
  loadBaseShapes(): Promise<{ shapes: readonly EventShapeDefinition[]; loadErrors: readonly { skill: string; error: string }[] }>;
  verifyInstalledRelease(release: ApiActivationRelease): Promise<readonly VerifiedApiModule[]>;
  loadEventShapeModule(module: VerifiedApiModule): Promise<unknown>;
  writeAudit: AuditWriter;
  beforeFinalTransition?(action: "activate" | "deactivate"): void;
  reportLoadError?(code: "STORAGE_FAILURE"): void;
}>;

function parseJson(input: string): unknown {
  try { return JSON.parse(input); } catch { return fail("INSPECTION_FAILED"); }
}
function strictModuleDefinitions(module: unknown, packageName: string): EventShapeDefinition[] {
  if (!module || typeof module !== "object" || Array.isArray(module)) fail("STORAGE_FAILURE");
  const record = module as Record<string, unknown>;
  const candidate = required(Array.isArray(record.eventShapes) ? record.eventShapes : Array.isArray(record.default) ? record.default : undefined, "STORAGE_FAILURE");
  if (candidate.length === 0) fail("STORAGE_FAILURE");
  return candidate.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("STORAGE_FAILURE");
    let descriptors: PropertyDescriptorMap;
    try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { fail("STORAGE_FAILURE"); }
    if (Object.values(descriptors).some(descriptor => !Object.hasOwn(descriptor, "value"))
      || Object.keys(descriptors).some(key => !DEFINITION_KEYS.has(key))) fail("STORAGE_FAILURE");
    const definition = Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
    if (definition.payloadSchema !== undefined) definition.payloadSchema = compileCatalogSchema(definition.payloadSchema);
    if (definition.eventSchema !== undefined) definition.eventSchema = compileCatalogSchema(definition.eventSchema);
    return defensiveDefinition({ ...definition, source: `skill:${packageName}` } as EventShapeDefinition);
  });
}

const capturedModuleCache = new Map<string, Promise<unknown>>();
const FORBIDDEN_MODULE_IDENTIFIERS = new Set([
  "process", "module", "exports", "require", "global", "globalThis", "Function", "eval", "fetch", "Buffer", "URL", "WebAssembly",
  "setTimeout", "setInterval", "setImmediate", "queueMicrotask",
]);
const DANGEROUS_MODULE_PROPERTIES = new Set([
  "constructor", "prototype", "__proto__", "caller", "callee", "arguments", "call", "apply", "bind",
  "getPrototypeOf", "setPrototypeOf", "getOwnPropertyDescriptor", "getOwnPropertyDescriptors", "getOwnPropertyNames", "getOwnPropertySymbols", "ownKeys",
]);

function validateCapturedModuleAst(sourceFile: ts.SourceFile, compiled: boolean): void {
  let invalid = (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length !== 0;
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      if (compiled || !ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== "zod") invalid = true;
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      invalid = true;
    } else if (ts.isImportEqualsDeclaration(node)
      || (ts.isExportAssignment(node) && node.isExportEquals)
      || ts.isElementAccessExpression(node)
      || ts.isMetaProperty(node)
      || node.kind === ts.SyntaxKind.ThisKeyword
      || (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)) {
      invalid = true;
    } else if (ts.isPropertyAccessExpression(node) && DANGEROUS_MODULE_PROPERTIES.has(node.name.text)) {
      invalid = true;
    } else if (ts.isIdentifier(node) && FORBIDDEN_MODULE_IDENTIFIERS.has(node.text)) {
      const generatedZodRequire = compiled && node.text === "require" && ts.isCallExpression(node.parent)
        && node.parent.expression === node && node.parent.arguments.length === 1
        && ts.isStringLiteral(node.parent.arguments[0]!) && node.parent.arguments[0]!.text === "zod";
      const generatedExports = compiled && node.text === "exports";
      if (!generatedZodRequire && !generatedExports) invalid = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (invalid) throw new Error("invalid captured module");
}

function createZodCapability(): { exposed: unknown; unwrap(value: unknown): unknown } {
  const exposedByHost = new WeakMap<object, object>();
  const hostByExposed = new WeakMap<object, object>();
  const forbidden = () => { throw "zod capability introspection denied"; };
  const bridgeInput = (value: unknown, depth = 0, budget = { remaining: 10_000 }): unknown => {
    if (depth > 32 || budget.remaining-- <= 0) throw "invalid zod capability input";
    if (value === null || typeof value === "string" || typeof value === "boolean"
      || (typeof value === "number" && Number.isFinite(value))) return value;
    if ((typeof value === "object" || typeof value === "function") && hostByExposed.has(value as object)) return hostByExposed.get(value as object);
    if (typeof value !== "object" || value === null) throw "invalid zod capability input";
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length > 0
      || Object.values(descriptors).some(descriptor => !Object.hasOwn(descriptor, "value"))) throw "invalid zod capability input";
    const output: unknown[] | Record<string, unknown> = Array.isArray(value) ? [] : Object.create(null);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(value) && key === "length") continue;
      if (DANGEROUS_MODULE_PROPERTIES.has(key)) throw "invalid zod capability input";
      (output as Record<string, unknown>)[key] = bridgeInput(descriptor.value, depth + 1, budget);
    }
    return output;
  };
  const expose = (value: unknown): unknown => {
    if (value === null || typeof value === "string" || typeof value === "boolean"
      || (typeof value === "number" && Number.isFinite(value)) || value === undefined) return value;
    if ((typeof value !== "object" && typeof value !== "function") || value === null) throw "invalid zod capability value";
    const cached = exposedByHost.get(value as object);
    if (cached) return cached;
    const proxy = new Proxy(value as object, {
      get(target, property) {
        if (typeof property !== "string" || DANGEROUS_MODULE_PROPERTIES.has(property) || property.startsWith("_")) return forbidden();
        let result: unknown;
        try { result = Reflect.get(target, property, target); } catch { throw "zod capability access failed"; }
        return expose(result);
      },
      apply(target, thisArg, args) {
        try {
          const receiver = (typeof thisArg === "object" || typeof thisArg === "function") && thisArg !== null
            ? hostByExposed.get(thisArg as object) : undefined;
          return expose(Reflect.apply(target as (...values: unknown[]) => unknown, receiver, args.map(argument => bridgeInput(argument))));
        } catch { throw "zod capability call failed"; }
      },
      construct: forbidden,
      defineProperty: forbidden,
      deleteProperty: forbidden,
      getOwnPropertyDescriptor: forbidden,
      getPrototypeOf: forbidden,
      has: forbidden,
      ownKeys: forbidden,
      set: forbidden,
      setPrototypeOf: forbidden,
    });
    exposedByHost.set(value as object, proxy);
    hostByExposed.set(proxy, value as object);
    return proxy;
  };
  return { exposed: expose(trustedZod), unwrap: value => hostByExposed.get(value as object) ?? value };
}

function extractCapturedValue(value: unknown, unwrap: (value: unknown) => unknown, depth = 0,
  seen = new Set<object>(), budget = { remaining: 20_000 }): unknown {
  if (depth > 32 || budget.remaining-- <= 0) throw new Error("invalid captured module exports");
  const unwrapped = (typeof value === "object" || typeof value === "function") && value !== null ? unwrap(value) : value;
  if (unwrapped !== value) return unwrapped;
  if (value === null || typeof value === "string" || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value)) || value === undefined) return value;
  if (typeof value !== "object" || seen.has(value)) throw new Error("invalid captured module exports");
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length > 0
    || Object.values(descriptors).some(descriptor => !Object.hasOwn(descriptor, "value"))) throw new Error("invalid captured module exports");
  const output: unknown[] | Record<string, unknown> = Array.isArray(value) ? [] : Object.create(null);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if ((Array.isArray(value) && key === "length") || key === "__esModule") continue;
    if (DANGEROUS_MODULE_PROPERTIES.has(key)) throw new Error("invalid captured module exports");
    (output as Record<string, unknown>)[key] = extractCapturedValue(descriptor.value, unwrap, depth + 1, seen, budget);
  }
  seen.delete(value);
  return output;
}

/**
 * Evaluates immutable verified bytes in a capability-empty VM realm. The VM is
 * defense in depth for approved privileged code, not a same-process hostile-code
 * sandbox; the enforced boundary is the absent host capability/import graph.
 */
export function loadCapturedEventShapeModule(module: VerifiedApiModule): Promise<unknown> {
  const cacheKey = `${module.releaseId}\0${module.releaseDigest}\0${module.declaredRelativePath}\0${module.digest}`;
  const existing = capturedModuleCache.get(cacheKey);
  if (existing) return existing;
  const loading = Promise.resolve().then(() => {
    const bytes = Buffer.from(module.bytes, "base64");
    if (bytes.length > MAX_CAPTURED_SOURCE_BYTES
      || `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== module.digest) throw new Error("invalid captured module");
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const scriptKind = module.declaredRelativePath.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
    validateCapturedModuleAst(ts.createSourceFile(module.declaredRelativePath, source, ts.ScriptTarget.ES2022, true, scriptKind), false);
    const transformed = ts.transpileModule(source, {
      fileName: module.declaredRelativePath,
      reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    });
    if (transformed.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
      || Buffer.byteLength(transformed.outputText, "utf8") > MAX_TRANSPILED_BYTES) throw new Error("invalid captured module");
    validateCapturedModuleAst(ts.createSourceFile("catalog-capture.js", transformed.outputText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS), true);

    const zodCapability = createZodCapability();
    const exportTarget = Object.create(null) as Record<string, unknown>;
    const validExportKey = (property: PropertyKey) => typeof property === "string" && !DANGEROUS_MODULE_PROPERTIES.has(property)
      && (Object.hasOwn(exportTarget, property) || Reflect.ownKeys(exportTarget).length < MAX_MODULE_EXPORTS);
    const exportProxy = new Proxy(exportTarget, {
      defineProperty(target, property, descriptor) {
        if (!validExportKey(property) || !Object.hasOwn(descriptor, "value")) return false;
        return Reflect.defineProperty(target, property, { value: descriptor.value, enumerable: descriptor.enumerable ?? true, configurable: true, writable: true });
      },
      set(target, property, value) {
        if (!validExportKey(property)) return false;
        return Reflect.set(target, property, value);
      },
      getPrototypeOf: () => null,
      setPrototypeOf: () => false,
    });
    const requireTarget = (specifier: unknown) => {
      if (specifier !== "zod") throw "captured module import denied";
      return zodCapability.exposed;
    };
    const requireProxy = new Proxy(requireTarget, {
      get() { throw "captured module require introspection denied"; },
      apply(target, _receiver, args) { return Reflect.apply(target, undefined, args); },
      construct() { throw "captured module require construction denied"; },
      getOwnPropertyDescriptor() { throw "captured module require introspection denied"; },
      getPrototypeOf() { throw "captured module require introspection denied"; },
      ownKeys() { throw "captured module require introspection denied"; },
      set() { return false; },
    });
    const moduleTarget = Object.freeze(Object.assign(Object.create(null), { exports: exportProxy }));
    const moduleProxy = new Proxy(moduleTarget, {
      get(target, property) {
        if (property !== "exports") throw "captured module access denied";
        return target.exports;
      },
      getPrototypeOf: () => null,
      set: () => false,
    });
    const sandbox = Object.create(null) as Record<string, unknown>;
    Object.assign(sandbox, { require: requireProxy, exports: exportProxy, module: moduleProxy });
    for (const name of FORBIDDEN_MODULE_IDENTIFIERS) {
      if (!Object.hasOwn(sandbox, name)) Object.defineProperty(sandbox, name, { value: undefined, writable: false, configurable: false });
    }
    const context = createContext(sandbox, { codeGeneration: { strings: false, wasm: false }, microtaskMode: "afterEvaluate" });
    const script = new Script(`"use strict";\n(function(require,exports,module){"use strict";\n${transformed.outputText}\n}).call(undefined,require,exports,module);`, {
      filename: "catalog-capture.js",
    });
    script.runInContext(context, { timeout: MODULE_EXECUTION_TIMEOUT_MS });
    if (Reflect.ownKeys(exportTarget).length > MAX_MODULE_EXPORTS) throw new Error("invalid captured module exports");
    return extractCapturedValue(exportTarget, zodCapability.unwrap);
  });
  capturedModuleCache.set(cacheKey, loading);
  loading.catch(() => capturedModuleCache.delete(cacheKey));
  return loading;
}

function result(row: ActivationRow): ApiActivationResult {
  const parsed = ApiActivationStateViewSchema.safeParse({
    approvalState: row.approval_state,
    runtimeState: row.runtime_state,
    revision: row.revision,
    failureCode: row.failure_code,
  });
  if (!parsed.success) fail("STORAGE_FAILURE");
  return { releaseId: row.release_id, ...parsed.data! } as ApiActivationResult;
}
function nextRevision(revision: number): number {
  if (!Number.isSafeInteger(revision) || revision < 1 || revision >= MAX_REVISION) fail("REVISION_CONFLICT");
  return revision + 1;
}

export function createApiExecutionCoordinator(deps: ApiExecutionCoordinatorDeps): ApiExecutionCoordinator & { reconcileStartup(): Promise<void> } {
  const { db, registry } = deps;
  let operationActive = false;
  let loadedCatalogShapes = new Map<string, readonly EventShapeDefinition[]>();
  const liveAdmin = db.prepare<[string], { ok: number }>("SELECT 1 AS ok FROM humans WHERE id=? AND is_admin=1 AND must_change_password=0");
  const releaseById = db.prepare<[string], ReleaseRow>(`SELECT r.package_release_id,r.authority_source_id,r.content_source_id,r.name,r.digest,r.manifest_json,r.execution_preview_json,
    c.review_state,c.review_digest,c.reviewed_by_human_id,c.reviewed_at,authority.enabled AS authority_enabled,authority.removed_at AS authority_removed_at,
    content.enabled AS content_enabled,content.removed_at AS content_removed_at,content.allow_packages AS content_allow_packages,
    i.artifact_digest,i.artifact_path,i.state AS installation_state
    FROM catalog_package_releases r JOIN catalog_release_controls c ON c.package_release_id=r.package_release_id
    JOIN catalog_sources authority ON authority.source_id=r.authority_source_id
    JOIN catalog_sources content ON content.source_id=r.content_source_id
    LEFT JOIN catalog_installations i ON i.release_id=r.package_release_id WHERE r.package_release_id=?`);
  const activationById = db.prepare<[string], ActivationRow>("SELECT * FROM catalog_api_activations WHERE release_id=?");
  const activeRows = db.prepare<[], ActivationRow>("SELECT * FROM catalog_api_activations WHERE approval_state='APPROVED' AND runtime_state='ACTIVE' ORDER BY release_id");

  function requireAdmin(actor: HumanAdmin): void {
    if (!HumanAdminSchema.safeParse(actor).success || !liveAdmin.get(actor.id)) fail("FORBIDDEN");
  }
  function validateActivationRow(row: ActivationRow): ActivationRow {
    const approved = row.approval_state === "APPROVED";
    if (!Number.isSafeInteger(row.revision) || row.revision < 1 || row.revision > MAX_REVISION
      || !["NOT_REQUIRED", "AWAITING_APPROVAL", "APPROVED", "REVOKED"].includes(row.approval_state)
      || !["INACTIVE", "ACTIVATING", "ACTIVE", "DEACTIVATING", "FAILED"].includes(row.runtime_state)
      || (approved && (!HumanAdminSchema.safeParse({ kind: "HUMAN_ADMIN", id: row.approved_by_human_id }).success
        || !Number.isSafeInteger(row.approved_at) || (row.approved_at as number) < 0 || !DigestSchema.safeParse(row.approved_digest).success))
      || (!approved && (row.approved_by_human_id !== null || row.approved_at !== null || row.approved_digest !== null))
      || (["ACTIVE", "ACTIVATING", "DEACTIVATING"].includes(row.runtime_state) && !approved)
      || (row.runtime_state === "FAILED"
        ? !ApiActivationFailureCodeSchema.safeParse(row.failure_code).success
        : row.failure_code !== null)) fail("STORAGE_FAILURE");
    return row;
  }
  function validatedActivationRow(releaseId: string): ActivationRow {
    return validateActivationRow(required(activationById.get(releaseId), "REVISION_CONFLICT"));
  }
  function readRelease(releaseId: string, requireActivationEligibility = true): ApiActivationRelease {
    const row = required(releaseById.get(releaseId), "NOT_FOUND");
    if (requireActivationEligibility && (row.authority_enabled !== 1 || row.authority_removed_at !== null || row.content_enabled !== 1 || row.content_removed_at !== null
      || (row.content_source_id !== row.authority_source_id && row.content_allow_packages !== 1))) fail("SOURCE_NOT_ALLOWED");
    if (requireActivationEligibility && (row.review_state !== "APPROVED" || !DigestSchema.safeParse(row.review_digest).success
      || row.reviewed_by_human_id === null || row.reviewed_at === null)) fail("RELEASE_NOT_APPROVED");
    if (row.installation_state !== "INSTALLED" || row.artifact_digest !== row.digest || !row.artifact_path) fail("INSTALLATION_REQUIRED");
    const manifestResult = PackageManifestSchema.safeParse(parseJson(row.manifest_json));
    const manifest = manifestResult.success && manifestResult.data ? manifestResult.data : fail("INSPECTION_FAILED");
    if (manifest.name !== row.name || manifest.digest !== row.digest) fail("INSPECTION_FAILED");
    const preview = parseJson(row.execution_preview_json) as { apiEventShapes?: unknown };
    if (!preview || typeof preview !== "object" || !Array.isArray(preview.apiEventShapes)
      || preview.apiEventShapes.some(path => !RelativePathSchema.safeParse(path).success)) fail("INSPECTION_FAILED");
    const declared = manifest.executables.filter(item => item.execution === "api-event-shapes").map(item => item.path).sort();
    const previewPaths = [...preview.apiEventShapes as string[]].sort();
    if (declared.length !== previewPaths.length || declared.some((path, index) => path !== previewPaths[index])) fail("INSPECTION_FAILED");
    return { releaseId: row.package_release_id, packageName: row.name, digest: row.digest, installationPath: row.artifact_path,
      apiEventShapePaths: Object.freeze(previewPaths), manifest };
  }
  function readDeactivationRelease(releaseId: string): ApiActivationRelease {
    const row = required(releaseById.get(releaseId), "NOT_FOUND");
    if (!DigestSchema.safeParse(row.digest).success) fail("INSPECTION_FAILED");
    return { releaseId: row.package_release_id, packageName: row.name, digest: row.digest,
      installationPath: row.artifact_path ?? "", apiEventShapePaths: Object.freeze([]), manifest: {} as PackageManifest };
  }
  function ensureRow(release: ApiActivationRelease): ActivationRow {
    const existing = activationById.get(release.releaseId);
    if (existing) return validatedActivationRow(release.releaseId);
    const approval = release.apiEventShapePaths.length === 0 ? "NOT_REQUIRED" : "AWAITING_APPROVAL";
    const now = Date.now();
    db.prepare(`INSERT INTO catalog_api_activations
      (release_id,approval_state,runtime_state,failure_code,approved_digest,approved_by_human_id,approved_at,revision,created_at,updated_at)
      VALUES (?,?,'INACTIVE',NULL,NULL,NULL,NULL,1,?,?)`).run(release.releaseId, approval, now, now);
    return validatedActivationRow(release.releaseId);
  }
  function audit(actor: HumanAdmin, action: "approve" | "activate" | "deactivate", outcome: "SUCCEEDED" | "FAILED", release: ApiActivationRelease,
    revision: number, failureCode?: "INSPECTION_FAILED" | "STORAGE_FAILURE"): CatalogAuditEvent {
    return CatalogAuditEventSchema.parse({
      type: "audit.catalog.api_activation.changed", source: "system", status: "DELIVERED", channelId: null,
      payload: { actorKind: "HUMAN_ADMIN", actorId: actor.id, action, outcome, releaseId: release.releaseId,
        digest: release.digest, revision, ...(failureCode ? { failureCode } : {}) },
    });
  }
  function persistFailed(release: ApiActivationRelease, actor: HumanAdmin, action: "activate" | "deactivate", expectedState: string, expectedRevision: number,
    code: "INSPECTION_FAILED" | "STORAGE_FAILURE", requireLiveAdmin = true): boolean {
    try {
      db.transaction(() => {
        if (requireLiveAdmin) requireAdmin(actor);
        const current = validatedActivationRow(release.releaseId);
        if (current.runtime_state !== expectedState || current.revision !== expectedRevision || current.approved_digest !== release.digest) fail("REVISION_CONFLICT");
        const revision = nextRevision(current.revision);
        const runtime = action === "deactivate" ? "ACTIVE" : "FAILED";
        const failureCode = action === "deactivate" ? null : code;
        const changed = db.prepare(`UPDATE catalog_api_activations SET runtime_state=?,failure_code=?,revision=?,updated_at=?
          WHERE release_id=? AND approval_state='APPROVED' AND approved_digest=? AND runtime_state=? AND revision=?`)
          .run(runtime, failureCode, revision, Date.now(), release.releaseId, release.digest, expectedState, expectedRevision);
        if (changed.changes !== 1) fail("REVISION_CONFLICT");
        deps.writeAudit(db, audit(actor, action, "FAILED", release, revision, code));
      }).immediate();
      return true;
    } catch { return false; /* Truth remains the guarded intermediate state when storage is unavailable. */ }
  }

  async function verifiedModules(release: ApiActivationRelease): Promise<readonly VerifiedApiModule[]> {
    const modules = await deps.verifyInstalledRelease(release);
    if (modules.length !== release.apiEventShapePaths.length
      || modules.some((module, index) => module.releaseId !== release.releaseId
        || module.releaseDigest !== release.digest
        || module.declaredRelativePath !== release.apiEventShapePaths[index]
        || !DigestSchema.safeParse(module.digest).success
        || typeof module.bytes !== "string")) fail("INSPECTION_FAILED");
    return modules;
  }
  async function moduleShapes(release: ApiActivationRelease): Promise<EventShapeDefinition[]> {
    const modules = await verifiedModules(release);
    const shapes: EventShapeDefinition[] = [];
    for (const module of modules) {
      const loaded = await deps.loadEventShapeModule(module);
      shapes.push(...strictModuleDefinitions(loaded, release.packageName));
    }
    validateEventShapeRegistry(shapes);
    return shapes;
  }
  async function compose(target?: { release: ApiActivationRelease; operation: "activate" | "deactivate" }): Promise<{
    shapes: EventShapeDefinition[];
    loadErrors: { skill: string; error: string }[];
    compatibleDuplicateCounts: ReadonlyMap<string, number>;
    catalogShapes: Map<string, readonly EventShapeDefinition[]>;
  }> {
    // Capture durable membership before module-loading yields so app teardown cannot
    // race a later database read; candidate bytes are still verified after the await.
    const persistedActiveRows = activeRows.all().map(validateActivationRow);
    const base = await deps.loadBaseShapes();
    const shapes = [...base.shapes];
    const compatibleDuplicateCounts = exactLegacyDuplicateCounts(base.shapes);
    const ids = persistedActiveRows.map(row => row.release_id);
    if (target?.operation === "deactivate") {
      const index = ids.indexOf(target.release.releaseId);
      if (index >= 0) ids.splice(index, 1);
    }
    if (target?.operation === "activate" && !ids.includes(target.release.releaseId)) ids.push(target.release.releaseId);
    ids.sort();
    const catalogShapes = new Map<string, readonly EventShapeDefinition[]>();
    for (const id of ids) {
      const release = target?.release.releaseId === id ? target.release : readRelease(id, false);
      let definitions: readonly EventShapeDefinition[];
      if (target?.operation === "deactivate") {
        await verifiedModules(release);
        definitions = loadedCatalogShapes.get(id) ?? fail("STORAGE_FAILURE");
      } else {
        definitions = await moduleShapes(release);
      }
      catalogShapes.set(id, definitions);
      shapes.push(...definitions);
    }
    validateEventShapeRegistry(shapes, compatibleDuplicateCounts);
    return {
      shapes,
      compatibleDuplicateCounts,
      catalogShapes,
      loadErrors: base.loadErrors.map(error => ({ skill: error.skill.slice(0, 200), error: "Legacy event-shape load failed" })),
    };
  }

  async function approveApiExecution(command: Parameters<ApiExecutionCoordinator["approveApiExecution"]>[0], actor: HumanAdmin): Promise<ApiActivationResult> {
    if (!PackageReleaseIdSchema.safeParse(command.releaseId).success || !DigestSchema.safeParse(command.digest).success
      || !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 1 || command.expectedRevision > MAX_REVISION) fail("INVALID_REQUEST");
    db.transaction(() => {
      requireAdmin(actor);
      ensureRow(readRelease(command.releaseId));
    }).immediate();
    return db.transaction(() => {
      requireAdmin(actor);
      const release = readRelease(command.releaseId);
      const row = validatedActivationRow(release.releaseId);
      if (release.apiEventShapePaths.length === 0 || row.approval_state === "NOT_REQUIRED") fail("STATE_CONFLICT");
      if (row.revision !== command.expectedRevision) fail("REVISION_CONFLICT");
      if (command.digest !== release.digest) fail("REVISION_CONFLICT");
      if (row.approval_state !== "AWAITING_APPROVAL" || row.runtime_state !== "INACTIVE") fail("STATE_CONFLICT");
      const revision = nextRevision(row.revision);
      const changed = db.prepare(`UPDATE catalog_api_activations SET approval_state='APPROVED',failure_code=NULL,approved_digest=?,approved_by_human_id=?,approved_at=?,revision=?,updated_at=?
        WHERE release_id=? AND approval_state='AWAITING_APPROVAL' AND runtime_state='INACTIVE' AND revision=?`)
        .run(command.digest, actor.id, Date.now(), revision, Date.now(), release.releaseId, row.revision);
      if (changed.changes !== 1) fail("REVISION_CONFLICT");
      deps.writeAudit(db, audit(actor, "approve", "SUCCEEDED", release, revision));
      return result(validatedActivationRow(release.releaseId));
    }).immediate();
  }

  async function changeRuntime(operation: "activate" | "deactivate", command: { releaseId: string; expectedRevision: number }, actor: HumanAdmin): Promise<ApiActivationResult> {
    if (!PackageReleaseIdSchema.safeParse(command.releaseId).success || !Number.isSafeInteger(command.expectedRevision)
      || command.expectedRevision < 1 || command.expectedRevision > MAX_REVISION) fail("INVALID_REQUEST");
    if (operationActive) fail("OPERATION_IN_PROGRESS");
    operationActive = true;
    let release!: ApiActivationRelease;
    let intermediateRevision = 0;
    const intermediateState = operation === "activate" ? "ACTIVATING" : "DEACTIVATING";
    try {
      if (operation === "activate") {
        db.transaction(() => {
          requireAdmin(actor);
          ensureRow(readRelease(command.releaseId));
        }).immediate();
      }
      db.transaction(() => {
        requireAdmin(actor);
        release = operation === "activate" ? readRelease(command.releaseId) : readDeactivationRelease(command.releaseId);
        const row = validatedActivationRow(release.releaseId);
        if ((operation === "activate" && release.apiEventShapePaths.length === 0) || row.approval_state !== "APPROVED"
          || row.approved_digest !== release.digest) fail("STATE_CONFLICT");
        if (row.revision !== command.expectedRevision) fail("REVISION_CONFLICT");
        const requiredState = operation === "activate" ? ["INACTIVE", "FAILED"] : ["ACTIVE"];
        if (!requiredState.includes(row.runtime_state)) fail("STATE_CONFLICT");
        intermediateRevision = nextRevision(row.revision);
        const changed = db.prepare(`UPDATE catalog_api_activations SET runtime_state=?,failure_code=NULL,revision=?,updated_at=?
          WHERE release_id=? AND runtime_state=? AND revision=?`).run(intermediateState, intermediateRevision, Date.now(), release.releaseId, row.runtime_state, row.revision);
        if (changed.changes !== 1) fail("REVISION_CONFLICT");
      }).immediate();

      let candidate: Awaited<ReturnType<typeof compose>>;
      try { candidate = await compose({ release, operation }); }
      catch (error) {
        const code = error instanceof ApiExecutionError && error.code === "INSPECTION_FAILED" ? "INSPECTION_FAILED" : "STORAGE_FAILURE";
        const persisted = persistFailed(release, actor, operation, intermediateState, intermediateRevision, code);
        throw new ApiExecutionError(persisted ? code : "STORAGE_FAILURE");
      }
      let swap!: { rollback(): void };
      try { swap = registry.swap(candidate.shapes, candidate.loadErrors, candidate.compatibleDuplicateCounts); }
      catch {
        persistFailed(release, actor, operation, intermediateState, intermediateRevision, "STORAGE_FAILURE");
        fail("STORAGE_FAILURE");
      }
      try {
        const final = db.transaction(() => {
          requireAdmin(actor);
          if (operation === "activate") readRelease(release.releaseId);
          else readDeactivationRelease(release.releaseId);
          const current = validatedActivationRow(release.releaseId);
          if (current.approved_digest !== release.digest) fail("REVISION_CONFLICT");
          deps.beforeFinalTransition?.(operation);
          const revision = nextRevision(intermediateRevision);
          const runtime = operation === "activate" ? "ACTIVE" : "INACTIVE";
          const changed = db.prepare(`UPDATE catalog_api_activations SET runtime_state=?,failure_code=NULL,revision=?,updated_at=?
            WHERE release_id=? AND approval_state='APPROVED' AND approved_digest=? AND runtime_state=? AND revision=?`)
            .run(runtime, revision, Date.now(), release.releaseId, release.digest, intermediateState, intermediateRevision);
          if (changed.changes !== 1) fail("REVISION_CONFLICT");
          deps.writeAudit(db, audit(actor, operation, "SUCCEEDED", release, revision));
          return result(validatedActivationRow(release.releaseId));
        }).immediate();
        loadedCatalogShapes = candidate.catalogShapes;
        return final;
      } catch {
        swap.rollback();
        persistFailed(release, actor, operation, intermediateState, intermediateRevision, "STORAGE_FAILURE");
        throw new ApiExecutionError("STORAGE_FAILURE");
      }
    } finally { operationActive = false; }
  }

  async function reconcileStartup(): Promise<void> {
    const startupRows = activeRows.all();
    let base: Awaited<ReturnType<typeof deps.loadBaseShapes>>;
    try {
      base = await deps.loadBaseShapes();
      validateEventShapeRegistry(base.shapes, exactLegacyDuplicateCounts(base.shapes));
    } catch {
      deps.reportLoadError?.("STORAGE_FAILURE");
      throw new ApiExecutionError("STORAGE_FAILURE");
    }

    const shapes = [...base.shapes];
    const catalogShapes = new Map<string, readonly EventShapeDefinition[]>();
    for (const startupRow of startupRows) {
      let release: ApiActivationRelease | undefined;
      try {
        const row = validatedActivationRow(startupRow.release_id);
        release = readRelease(row.release_id, false);
        if (row.approved_digest !== release.digest) fail("INSPECTION_FAILED");
        const definitions = await moduleShapes(release);
        catalogShapes.set(release.releaseId, definitions);
        shapes.push(...definitions);
      } catch {
        const raw = releaseById.get(startupRow.release_id);
        if (!raw || !startupRow.approved_by_human_id || !DigestSchema.safeParse(raw.digest).success) {
          deps.reportLoadError?.("STORAGE_FAILURE");
          throw new ApiExecutionError("STORAGE_FAILURE");
        }
        const failedRelease: ApiActivationRelease = release ?? {
          releaseId: startupRow.release_id, packageName: raw.name, digest: raw.digest,
          installationPath: raw.artifact_path ?? "", apiEventShapePaths: [], manifest: {} as PackageManifest,
        };
        if (!persistFailed(failedRelease, { kind: "HUMAN_ADMIN", id: startupRow.approved_by_human_id },
          "activate", "ACTIVE", startupRow.revision, "INSPECTION_FAILED", false)) {
          deps.reportLoadError?.("STORAGE_FAILURE");
          throw new ApiExecutionError("STORAGE_FAILURE");
        }
      }
    }

    try {
      const compatible = exactLegacyDuplicateCounts(base.shapes);
      validateEventShapeRegistry(shapes, compatible);
      registry.swap(shapes, base.loadErrors.map(error => ({ skill: error.skill.slice(0, 200), error: "Legacy event-shape load failed" })), compatible);
      loadedCatalogShapes = catalogShapes;
    } catch {
      deps.reportLoadError?.("STORAGE_FAILURE");
      throw new ApiExecutionError("STORAGE_FAILURE");
    }
  }

  return {
    approveApiExecution,
    activateApiExecution: (command, actor) => changeRuntime("activate", command, actor),
    deactivateApiExecution: (command, actor) => changeRuntime("deactivate", command, actor),
    reconcileStartup,
  };
}

function within(root: string, target: string): boolean {
  const value = relative(resolve(root), resolve(target));
  return value === "" || (value !== ".." && !value.startsWith(`..${sep}`) && !value.startsWith(sep));
}

/** Captures the complete verified installation once; only returned bytes may execute. */
export async function verifyInstalledApiRelease(release: ApiActivationRelease, artifactRoot: string): Promise<readonly VerifiedApiModule[]> {
  const resolvedArtifactRoot = resolve(artifactRoot);
  const expectedRoot = resolve(resolvedArtifactRoot, release.packageName, release.digest.slice("sha256:".length));
  if (resolve(release.installationPath) !== expectedRoot || !within(resolvedArtifactRoot, expectedRoot)) fail("INSPECTION_FAILED");
  let canonicalArtifactRoot!: string;
  let canonicalRoot!: string;
  try {
    canonicalArtifactRoot = await fs.realpath(resolvedArtifactRoot);
    canonicalRoot = await fs.realpath(expectedRoot);
  } catch { fail("INSPECTION_FAILED"); }
  if (canonicalArtifactRoot !== resolvedArtifactRoot || canonicalRoot !== expectedRoot || !within(canonicalArtifactRoot, canonicalRoot)) fail("INSPECTION_FAILED");

  const actual = new Set<string>();
  const folded = new Set<string>();
  async function walk(directory: string, prefix = ""): Promise<void> {
    const directoryStat = await fs.lstat(directory).catch(() => fail("INSPECTION_FAILED"));
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) fail("INSPECTION_FAILED");
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const caseKey = relativePath.toLocaleLowerCase("en-US");
      if (folded.has(caseKey)) fail("INSPECTION_FAILED");
      folded.add(caseKey);
      const full = join(directory, entry.name);
      const stat = await fs.lstat(full);
      if (stat.isSymbolicLink()) fail("INSPECTION_FAILED");
      if (stat.isDirectory()) await walk(full, relativePath);
      else if (stat.isFile() && stat.nlink === 1) actual.add(relativePath);
      else fail("INSPECTION_FAILED");
    }
  }
  await walk(canonicalRoot);
  const expected = new Set(release.manifest.files.map(file => file.path));
  if (actual.size !== expected.size || [...actual].some(path => !expected.has(path)) || expected.size !== release.manifest.files.length) fail("INSPECTION_FAILED");
  const captures = new Map<string, VerifiedApiModule>();
  for (const file of release.manifest.files) {
    if (!RelativePathSchema.safeParse(file.path).success) fail("INSPECTION_FAILED");
    const path = join(canonicalRoot, file.path);
    if (!within(canonicalRoot, path)) fail("INSPECTION_FAILED");
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      const before = await handle.stat();
      if (!before.isFile() || before.nlink !== 1 || before.size !== file.size
        || (before.mode & 0o777) !== (file.executable ? 0o755 : 0o644)) fail("INSPECTION_FAILED");
      const bytes = await handle.readFile();
      const after = await handle.stat();
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || after.nlink !== 1) fail("INSPECTION_FAILED");
      const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      if (digest !== file.digest) fail("INSPECTION_FAILED");
      if (release.apiEventShapePaths.includes(file.path)) captures.set(file.path, Object.freeze({
        releaseId: release.releaseId,
        releaseDigest: release.digest,
        declaredRelativePath: file.path,
        digest,
        bytes: bytes.toString("base64"),
      }));
    } catch (error) {
      if (error instanceof ApiExecutionError) throw error;
      fail("INSPECTION_FAILED");
    } finally { await handle?.close().catch(() => undefined); }
  }
  return Object.freeze(release.apiEventShapePaths.map(path => captures.get(path) ?? fail("INSPECTION_FAILED")));
}
