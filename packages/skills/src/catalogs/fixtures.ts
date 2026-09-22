import { expect } from "vitest";
import type { SkillManifest, NativeAgentManifest, WrappedAgentManifest, CatalogIndex, ContractResult } from "@orgops/schemas";
import type { ContentEntry } from "./content";

export const skillManifest: SkillManifest = {
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

export const skillEntries: ContentEntry[] = [
  {
    "type": "file",
    "path": "SKILL.md",
    "base64": "LS0tCm5hbWU6IGVjaG8tc2tpbGwKZGVzY3JpcHRpb246IEVjaG8gaW5zdHJ1Y3Rpb25zLgpsaWNlbnNlOiBNSVQKLS0tClJldHVybiBhIHNob3J0IGFja25vd2xlZGdlbWVudC4K",
    "executable": false
  },
  {
    "type": "file",
    "path": "event-shapes.ts",
    "base64": "dGhyb3cgbmV3IEVycm9yKCJjYXRhbG9nIGluc3BlY3Rpb24gZXhlY3V0ZWQiKTsK",
    "executable": false
  }
];

export const classicManifest: NativeAgentManifest = {
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

export const rlmManifest: NativeAgentManifest = {
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

export const wrappedManifest: WrappedAgentManifest = {
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

export const catalogIndex: CatalogIndex = {
  "formatVersion": 1,
  "entries": [
    {
      "kind": "skill",
      "name": "echo-skill",
      "version": "1.0.0",
      "digest": "sha256:83dafd61312f34e2d3aee6630783ecf2b611a632adde9aff318d2fad39ead800",
      "location": {
        "type": "catalog",
        "path": "packages/echo-skill",
        "revision": {
          "type": "catalog-revision"
        }
      }
    },
    {
      "kind": "native-agent",
      "name": "echo-agent",
      "version": "1.0.0",
      "digest": "sha256:89dcf3abfc6f0942947a17fac61f9f6153d4b122f447853ed47734d2a093caa1",
      "location": {
        "type": "catalog",
        "path": "packages/echo-agent",
        "revision": {
          "type": "catalog-revision"
        }
      }
    },
    {
      "kind": "native-agent",
      "name": "echo-repl",
      "version": "1.0.0",
      "digest": "sha256:48beb1f660ea3d2ba0ae061631b6ab06dce3cf820f71e18db593ea9550b43f87",
      "location": {
        "type": "catalog",
        "path": "packages/echo-repl",
        "revision": {
          "type": "catalog-revision"
        }
      }
    },
    {
      "kind": "wrapped-agent",
      "name": "echo-wrapper",
      "version": "1.0.0",
      "digest": "sha256:19c6e488fa0f29398bb03a4bade14ab0ce8de8d899d1540ee1dd12158aae04ba",
      "location": {
        "type": "catalog",
        "path": "packages/echo-wrapper",
        "revision": {
          "type": "catalog-revision"
        }
      }
    }
  ]
};

export const fixtureDigests = {
  "skill": "sha256:83dafd61312f34e2d3aee6630783ecf2b611a632adde9aff318d2fad39ead800",
  "classic": "sha256:89dcf3abfc6f0942947a17fac61f9f6153d4b122f447853ed47734d2a093caa1",
  "rlm": "sha256:48beb1f660ea3d2ba0ae061631b6ab06dce3cf820f71e18db593ea9550b43f87",
  "wrapped": "sha256:19c6e488fa0f29398bb03a4bade14ab0ce8de8d899d1540ee1dd12158aae04ba"
} as const;
export function must<T>(result: ContractResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`fixture rejected: ${result.issues[0]?.code}`);
  return result.value;
}
export function expectCode<T>(result: ContractResult<T>, code: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected rejection");
  expect(result.issues).toHaveLength(1);
  expect(result.issues[0]?.code).toBe(code);
}
