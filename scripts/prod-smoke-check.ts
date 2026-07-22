/**
 * Post-deploy production smoke check for the nWave Ticket Execution Engine feature.
 *
 * Run manually (or wired into an operator's own deploy script) after a Recreate deployment
 * completes, before declaring the deploy successful. Exits non-zero on any failed assertion so
 * it can gate an automated deploy script if one is added later.
 *
 * See docs/feature/nwave-ticket-execution-engine/devops/ci-cd-pipeline.md "Quality Gate
 * Taxonomy" for the rationale behind each assertion below.
 *
 * Usage: node --env-file=.env --import tsx scripts/prod-smoke-check.ts
 */

const apiUrlRaw = process.env.ORGOPS_API_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const apiUrl = apiUrlRaw.endsWith("/") ? apiUrlRaw.slice(0, -1) : apiUrlRaw;
const runnerToken = process.env.ORGOPS_RUNNER_TOKEN ?? "dev-runner-token";

type Check = { name: string; run: () => Promise<void> };

async function fetchJson(path: string) {
  const res = await fetch(`${apiUrl}${path}`, {
    headers: { "x-orgops-runner-token": runnerToken },
  });
  return { res, body: await res.json().catch(() => null) };
}

const checks: Check[] = [
  {
    name: "API readiness (GET /api/auth/me returns 200)",
    run: async () => {
      const { res } = await fetchJson("/api/auth/me");
      if (!res.ok) {
        throw new Error(`expected 200, got ${res.status}`);
      }
    },
  },
  {
    name: "nwave-runs route reachable and returns a well-formed list shape",
    run: async () => {
      const { res, body } = await fetchJson("/api/nwave-runs");
      if (!res.ok) {
        throw new Error(`expected 200, got ${res.status}`);
      }
      if (body === null || typeof body !== "object") {
        throw new Error("expected a JSON object response body");
      }
      const list = Array.isArray(body) ? body : (body as Record<string, unknown>).runs;
      if (!Array.isArray(list)) {
        throw new Error(
          "expected either a top-level array or a { runs: [...] } shape — got neither",
        );
      }
    },
  },
  {
    name: "tickets route reachable",
    run: async () => {
      const { res } = await fetchJson("/api/tickets");
      if (!res.ok) {
        throw new Error(`expected 200, got ${res.status}`);
      }
    },
  },
];

async function main() {
  let failures = 0;
  for (const check of checks) {
    try {
      await check.run();
      process.stdout.write(`[prod-smoke-check] PASS: ${check.name}\n`);
    } catch (error) {
      failures += 1;
      process.stderr.write(
        `[prod-smoke-check] FAIL: ${check.name} — ${(error as Error).message}\n`,
      );
    }
  }
  if (failures > 0) {
    process.stderr.write(`[prod-smoke-check] ${failures} check(s) failed\n`);
    process.exit(1);
  }
  process.stdout.write("[prod-smoke-check] all checks passed\n");
}

main();
