import { describe, expect, it } from "vitest";
import { ExecutableDeclarationSchema, FileInventoryEntrySchema, PackageManifestSchema, parsePackageManifest, validatePackageManifest } from "./manifest";
import { validateCatalogJson } from "./primitives";
const skill = {
  "formatVersion": 1,
  "name": "echo-skill",
  "version": "1.0.0",
  "description": "Echo instructions.",
  "author": "Example Authors",
  "license": "MIT",
  "compatibility": {
    "orgops": {
      "min": "0.0.1",
      "maxExclusive": "0.1.0"
    },
    "platforms": [
      "linux",
      "darwin",
      "win32"
    ],
    "tools": [
      "node"
    ]
  },
  "secrets": [],
  "dependencies": [],
  "files": [
    {
      "path": "SKILL.md",
      "size": 102,
      "digest": "sha256:d1e1ad27fad5df70172dc3dd6595a6a2cc4192b5dcc3f52587458e564f80b7d1",
      "executable": false
    },
    {
      "path": "event-shapes.ts",
      "size": 48,
      "digest": "sha256:9c345d9d0d5348cad82dfc0b82a56508c97bda41ff299a8b0b684b18c40c3f97",
      "executable": false
    }
  ],
  "executables": [
    {
      "path": "event-shapes.ts",
      "execution": "api-event-shapes"
    }
  ],
  "kind": "skill",
  "skill": {
    "entrypoint": "SKILL.md"
  },
  "digest": "sha256:83dafd61312f34e2d3aee6630783ecf2b611a632adde9aff318d2fad39ead800"
};
const native = {
  "formatVersion": 1,
  "name": "echo-agent",
  "version": "1.0.0",
  "description": "Native acknowledgement agent.",
  "author": "Example Authors",
  "license": "MIT",
  "compatibility": {
    "orgops": {
      "min": "0.0.1",
      "maxExclusive": "0.1.0"
    },
    "platforms": [
      "linux",
      "darwin",
      "win32"
    ],
    "tools": [
      "node"
    ]
  },
  "secrets": [],
  "dependencies": [
    {
      "catalogId": "team",
      "sourceId": "team-source",
      "name": "echo-skill",
      "version": "1.0.0",
      "revision": {
        "type": "same-package-revision"
      },
      "digest": "sha256:83dafd61312f34e2d3aee6630783ecf2b611a632adde9aff318d2fad39ead800"
    }
  ],
  "files": [],
  "executables": [],
  "kind": "native-agent",
  "native": {
    "mode": "CLASSIC",
    "systemInstructions": "Acknowledge requests.",
    "soulContents": "Be concise.",
    "runtime": {
      "llmCallTimeoutMs": 60000,
      "classicMaxModelSteps": 8,
      "contextSessionGapMs": 300000,
      "emitAuditEvents": true,
      "memoryContextMode": "OFF"
    },
    "suggestedModel": {
      "provider": "openai",
      "modelName": "gpt-4o-mini",
      "temperature": 0.2,
      "maxTokens": 1024
    },
    "alwaysPreloadedSkills": [
      "echo-skill"
    ]
  },
  "digest": "sha256:89dcf3abfc6f0942947a17fac61f9f6153d4b122f447853ed47734d2a093caa1"
};
const rlm = {
  "formatVersion": 1,
  "name": "echo-repl",
  "version": "1.0.0",
  "description": "Native recursive acknowledgement agent.",
  "author": "Example Authors",
  "license": "MIT",
  "compatibility": {
    "orgops": {
      "min": "0.0.1",
      "maxExclusive": "0.1.0"
    },
    "platforms": [
      "linux",
      "darwin",
      "win32"
    ],
    "tools": [
      "node"
    ]
  },
  "secrets": [],
  "dependencies": [
    {
      "catalogId": "team",
      "sourceId": "team-source",
      "name": "echo-skill",
      "version": "1.0.0",
      "revision": {
        "type": "same-package-revision"
      },
      "digest": "sha256:83dafd61312f34e2d3aee6630783ecf2b611a632adde9aff318d2fad39ead800"
    }
  ],
  "files": [],
  "executables": [],
  "kind": "native-agent",
  "native": {
    "mode": "RLM_REPL",
    "systemInstructions": "Return done(\"acknowledged\").",
    "runtime": {
      "llmCallTimeoutMs": 60000,
      "memoryContextMode": "OFF"
    },
    "alwaysPreloadedSkills": [
      "echo-skill"
    ]
  },
  "digest": "sha256:48beb1f660ea3d2ba0ae061631b6ab06dce3cf820f71e18db593ea9550b43f87"
};
const wrapped = {
  "formatVersion": 1,
  "name": "echo-wrapper",
  "version": "1.0.0",
  "description": "Inert command recipe example.",
  "author": "Example Authors",
  "license": "MIT",
  "compatibility": {
    "orgops": {
      "min": "0.0.1",
      "maxExclusive": "0.1.0"
    },
    "platforms": [
      "linux",
      "darwin",
      "win32"
    ],
    "tools": [
      "node"
    ]
  },
  "secrets": [],
  "dependencies": [],
  "files": [],
  "executables": [],
  "kind": "wrapped-agent",
  "wrapped": {
    "kind": "custom",
    "harness": "command",
    "setup": {
      "command": "printf setup",
      "checkCommand": "test -f ready",
      "cwd": ".",
      "timeoutMs": 60000
    },
    "sidecars": [
      {
        "name": "helper",
        "command": "node -e 'setInterval(() => {}, 1000)'",
        "cwd": ".",
        "restart": false,
        "restartDelayMs": 2000
      }
    ],
    "runtime": {
      "command": "printf",
      "args": [
        "acknowledged"
      ],
      "cwd": ".",
      "timeoutMs": 60000,
      "parse": "text"
    },
    "session": {
      "scope": "per-channel"
    },
    "resourceWiring": "none"
  },
  "digest": "sha256:19c6e488fa0f29398bb03a4bade14ab0ce8de8d899d1540ee1dd12158aae04ba"
};

function changed(input: unknown, path: string, value: unknown): unknown {
  const copy = structuredClone(input) as Record<string, unknown>;
  const keys = path.split(".");
  let parent = copy;
  for (const key of keys.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
  parent[keys[keys.length - 1]!] = value;
  return copy;
}
const rejects = (input: unknown) => expect(PackageManifestSchema.safeParse(input).success).toBe(false);
describe("PackageManifestSchema", () => {
  it.each([skill, native, rlm, wrapped])("accepts complete portable fixture $name without mutation", input => {
    const before = structuredClone(input);
    expect(validatePackageManifest(input)).toEqual({ ok: true, value: input });
    expect(input).toEqual(before);
    expect(parsePackageManifest(JSON.stringify(input))).toEqual({ ok: true, value: input });
  });
  it.each(["modelId", "assignedRunnerId", "workspacePath", "secretValues", "desiredState"])("rejects local field %s", key => rejects(changed(native, key, "DO_NOT_EXPORT")));
  it.each([
    ["formatVersion", 2], ["version", "1.0.0-beta"], ["native.mode", "WRAPPED"],
    ["native.runtime.allowOutsideWorkspace", true], ["native.suggestedModel.id", "local"],
    ["native.suggestedModel", {}], ["native.suggestedModel.temperature", 3],
    ["native.suggestedModel.maxTokens", 1.5], ["native.runtime.llmCallTimeoutMs", 0],
    ["native.runtime.classicMaxModelSteps", 2147483648], ["native.systemInstructions", "x".repeat(65537)],
    ["compatibility.orgops.maxExclusive", "0.0.1"], ["compatibility.orgops.maxExclusive", "0.0.0"],
    ["compatibility.platforms", ["linux", "linux"]], ["compatibility.platforms", []],
    ["compatibility.tools", ["node", "node"]], ["compatibility.tools", ["node --version"]],
    ["secrets", [{ name: "TOKEN", description: "Purpose", required: true, value: "hidden" }]],
    ["secrets", [{ name: "TOKEN", description: "Purpose", required: true }, { name: "TOKEN", description: "Purpose", required: false }]],
    ["dependencies", [native.dependencies[0], native.dependencies[0]]],
    ["native.alwaysPreloadedSkills", ["echo-skill", "echo-skill"]], ["native.alwaysPreloadedSkills", ["missing"]],
    ["author", " \n"], ["description", "\ud800"], ["license", null],
    ["native.runtime", undefined], ["files", undefined], ["native.runtime.emitAuditEvents", "true"],
  ])("rejects invalid native field %s", (path, value) => rejects(changed(native, path as string, value)));
  it("rejects classic-only tuning in imported RLM", () => rejects(changed(rlm, "native.runtime.classicMaxModelSteps", 8)));
  it.each([
    ["wrapped.source", { type: "github", repo: "owner/repo", updateOnStart: false, path: "local" }],
    ["wrapped.setup.env", { TOKEN: "hidden" }], ["wrapped.runtime.env", {}],
    ["wrapped.setup", { checkCommand: "test ready" }], ["wrapped.runtime.cwd", "/tmp"],
    ["wrapped.runtime.cwd", ".orgops-data-extra"], ["wrapped.runtime.timeoutMs", 0],
    ["wrapped.harness", "cli"], ["wrapped.transport", "http"], ["wrapped.resourceWiring", "native"],
    ["wrapped.sidecars", [wrapped.wrapped.sidecars[0], wrapped.wrapped.sidecars[0]]],
    ["wrapped.alwaysPreloadedSkills", []], ["files", skill.files], ["dependencies", native.dependencies],
    ["executables", skill.executables],
  ])("rejects nonportable wrapped field %s", (path, value) => rejects(changed(wrapped, path as string, value)));
  it.each(["owner/repo", "O_wner/r.epo-1"])("accepts inert source hint %s", repo => {
    expect(PackageManifestSchema.safeParse(changed(wrapped, "wrapped.source", { type: "github", repo, ref: "release/v1", updateOnStart: false })).success).toBe(true);
  });
  it.each(["https://host/repo", "../repo", "owner/..", "owner/repo;echo", "owner/repo/extra"])("rejects source repo %s", repo => rejects(changed(wrapped, "wrapped.source", { type: "github", repo, updateOnStart: false })));
  it.each(["main..x", "a//b", "a/", "a.", "a.lock/b", "-branch"])("rejects ref %s", ref => rejects(changed(wrapped, "wrapped.source", { type: "github", repo: "owner/repo", ref, updateOnStart: false })));
  it("rejects updating external source", () => rejects(changed(wrapped, "wrapped.source", { type: "github", repo: "owner/repo", updateOnStart: true })));
  it.each([
    ["SKILL.md", "skill.md"], ["a", "a/b"], ["A/b", "a"], ["orgops-package.json"],
  ])("rejects inventory collision/reserved paths %j", (...paths) => rejects(changed(skill, "files", paths.map(path => ({ ...skill.files[0], path })))));
  it.each(["orgops-package.json", "ORGOPS-PACKAGE.JSON", "orgops-package.json/notes.txt", "ORGOPS-PACKAGE.JSON/notes.txt"])("rejects reserved root content in inventory and declarations: %s", path => {
    const inventory = { ...skill.files[0], path };
    const declaration = { path, execution: "runner-script" };
    expect(FileInventoryEntrySchema.safeParse(inventory).success).toBe(false);
    expect(ExecutableDeclarationSchema.safeParse(declaration).success).toBe(false);
    const manifest = { ...skill, files: [...skill.files, inventory], executables: [...skill.executables, declaration] };
    rejects(manifest);
    expect(validatePackageManifest(manifest)).toEqual({ ok: false, issues: [{ code: "INVALID_MANIFEST", at: "$" }] });
    expect(parsePackageManifest(JSON.stringify(manifest)).ok).toBe(false);
  });
  it.each(["assets/orgops-package.json", "assets/ORGOPS-PACKAGE.JSON", "orgops-package.json-assets/notes.txt"])("permits nonreserved content path %s", path => {
    const inventory = { ...skill.files[0], path };
    const declaration = { path, execution: "runner-script" };
    expect(FileInventoryEntrySchema.safeParse(inventory).success).toBe(true);
    expect(ExecutableDeclarationSchema.safeParse(declaration).success).toBe(true);
    expect(validatePackageManifest({ ...skill, files: [...skill.files, inventory], executables: [...skill.executables, declaration] }).ok).toBe(true);
  });
  it("rejects invalid sizes, aggregate bytes and undeclared inventory references", () => {
    rejects(changed(skill, "files.0.size", -1));
    rejects(changed(skill, "files.0.size", 1048577));
    rejects(changed(skill, "files", Array.from({ length: 9 }, (_, i) => ({ ...skill.files[0], path: `file${i}`, size: 1048576 }))));
    rejects(changed(skill, "executables.0.path", "missing.js"));
    rejects(changed(skill, "executables", [skill.executables[0], skill.executables[0]]));
  });
  it("maps unsupported wrapped wiring before generic schema rejection", () => {
    for (const input of [changed(wrapped, "files", skill.files), changed(wrapped, "dependencies", native.dependencies), changed(wrapped, "wrapped.resourceWiring", "other")]) {
      expect(validatePackageManifest(input)).toEqual({ ok: false, issues: [{ code: "UNSUPPORTED_WIRING", at: "wrapped" }] });
    }
  });
  it("redacts rejected data and malformed JSON", () => {
    expect(parsePackageManifest('{"token":"DO_NOT_EXPORT"')).toEqual({ ok: false, issues: [{ code: "INVALID_JSON", at: "$" }] });
    expect(validatePackageManifest({ token: "DO_NOT_EXPORT" })).toEqual({ ok: false, issues: [{ code: "INVALID_MANIFEST", at: "$" }] });
  });
  it("applies the raw manifest byte budget including whitespace", () => {
    const json = JSON.stringify(native);
    expect(parsePackageManifest(json.padEnd(262144)).ok).toBe(true);
    expect(parsePackageManifest(json.padEnd(262145))).toEqual({ ok: false, issues: [{ code: "LIMIT_EXCEEDED", at: "$" }] });
  });
});

describe("validateCatalogJson", () => {
  it("counts UTF-8, escaped characters, keys and punctuation exactly", () => {
    for (const value of ["é", "😀", "\n", { '"': [true, null, 1, "é"] }]) {
      const size = Buffer.byteLength(JSON.stringify(value));
      expect(validateCatalogJson(value, size)).toEqual({ ok: true, value });
      expect(validateCatalogJson(value, size - 1)).toEqual({ ok: false, issues: [{ code: "LIMIT_EXCEEDED", at: "$" }] });
    }
  });
  it("bounds depth at 32 with root depth zero", () => {
    let value: unknown = null;
    for (let i = 0; i < 32; i++) value = [value];
    expect(validateCatalogJson(value, 1000).ok).toBe(true);
    expect(validateCatalogJson([value], 1000)).toEqual({ ok: false, issues: [{ code: "LIMIT_EXCEEDED", at: "$" }] });
  });
  it("rejects cycles and accessors without invoking them", () => {
    let calls = 0;
    const getter = { get kind() { calls++; return "wrapped-agent"; } };
    const cycle: unknown[] = []; cycle.push(cycle);
    for (const value of [getter, cycle]) expect(validatePackageManifest(value)).toEqual({ ok: false, issues: [{ code: "INVALID_JSON", at: "$" }] });
    expect(calls).toBe(0);
  });
  it.each([undefined, NaN, Infinity, 1n, () => 1, new Date(), new Map(), [undefined], Array(2), "\ud800", "\udc00", { [Symbol("x")]: 1 }, Object.defineProperty({}, "x", { value: 1 })])("rejects non-JSON values %#", value => {
    expect(validateCatalogJson(value, 1000)).toEqual({ ok: false, issues: [{ code: "INVALID_JSON", at: "$" }] });
  });
  it("rejects extra array properties and nonplain prototypes", () => {
    expect(validateCatalogJson(Object.assign([], { x: 1 }), 1000).ok).toBe(false);
    expect(validateCatalogJson(Object.create({ x: 1 }), 1000).ok).toBe(false);
  });
  it("uses standard last-key JSON parsing semantics", () => {
    const json = JSON.stringify(native).replace('"formatVersion":1', '"formatVersion":2,"formatVersion":1');
    expect(parsePackageManifest(json).ok).toBe(true);
  });
});
it("rejects final newlines in secret names and wrapped repository/ref tokens", () => {
  rejects(changed(native, "secrets", [{ name: "TOKEN\n", description: "Purpose", required: true }]));
  for (const source of [{ type: "github", repo: "owner/repo\n", updateOnStart: false }, { type: "github", repo: "owner/repo", ref: "main\n", updateOnStart: false }]) rejects(changed(wrapped, "wrapped.source", source));
});
it("preserves bounded command text without imposing shell semantics", () => {
  expect(validatePackageManifest(changed(wrapped, "wrapped.runtime.command", " ")).ok).toBe(true);
});
it.each([
  [skill, "skill.extra"], [skill, "files.0.type"], [skill, "executables.0.extra"],
  [native, "compatibility.extra"], [native, "compatibility.orgops.extra"],
  [native, "native.extra"], [native, "dependencies.0.extra"], [native, "dependencies.0.revision.extra"],
  [wrapped, "wrapped.session.extra"], [wrapped, "wrapped.sidecars.0.env"],
])("rejects unknown nested field %#", (input, path) => rejects(changed(input, path as string, "DO_NOT_EXPORT")));
it("enforces collection and authored text limits", () => {
  rejects(changed(native, "description", "x".repeat(4097)));
  rejects(changed(native, "author", "x".repeat(257)));
  rejects(changed(native, "license", "x".repeat(257)));
  rejects(changed(native, "native.soulContents", "x".repeat(65537)));
  rejects(changed(wrapped, "wrapped.runtime.args", Array(129).fill("arg")));
  rejects(changed(wrapped, "wrapped.runtime.args", ["x".repeat(4097)]));
  rejects(changed(wrapped, "wrapped.runtime.command", "x".repeat(16385)));
  rejects(changed(wrapped, "wrapped.sidecars", Array.from({ length: 17 }, (_, i) => ({ name: `helper${i}`, command: "echo" }))));
  rejects(changed(native, "secrets", Array.from({ length: 65 }, (_, i) => ({ name: `SECRET${i}`, description: "Purpose", required: false }))));
  rejects(changed(native, "dependencies", Array.from({ length: 65 }, (_, i) => ({ ...native.dependencies[0], name: `skill${i}` }))));
  rejects(changed(native, "compatibility.tools", Array.from({ length: 65 }, (_, i) => `tool${i}`)));
  rejects(changed(skill, "files", Array.from({ length: 257 }, (_, i) => ({ ...skill.files[0], path: `file${i}`, size: 0 }))));
});
it("rejects invalid data before schema traversal even when a wrapped discriminator is present", () => {
  let calls = 0;
  const value = { kind: "wrapped-agent", get files() { calls++; return []; } };
  expect(validatePackageManifest(value)).toEqual({ ok: false, issues: [{ code: "INVALID_JSON", at: "$" }] });
  expect(calls).toBe(0);
});
it("bounds oversized arrays and strings before children and checks object manifest budget", () => {
  let calls = 0;
  const values = Array(1001);
  Object.defineProperty(values, "0", { get() { calls++; return 1; } });
  expect(validateCatalogJson(values, 1000)).toEqual({ ok: false, issues: [{ code: "LIMIT_EXCEEDED", at: "$" }] });
  expect(validateCatalogJson("x".repeat(1001), 1000)).toEqual({ ok: false, issues: [{ code: "LIMIT_EXCEEDED", at: "$" }] });
  expect(validatePackageManifest({ extra: "x".repeat(262145) })).toEqual({ ok: false, issues: [{ code: "LIMIT_EXCEEDED", at: "$" }] });
  expect(calls).toBe(0);
});
