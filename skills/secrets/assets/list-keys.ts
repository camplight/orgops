import { parseSecretCommand } from "./_args.ts";

const apiUrl = process.env.ORGOPS_API_URL ?? "http://localhost:8787";
const token = process.env.ORGOPS_RUNNER_TOKEN;

const parsed = parseSecretCommand(process.argv);
if ("error" in parsed) {
  console.error(parsed.error);
  console.error("Usage: node --import tsx list-keys.ts -- [--public | --team <teamId>]");
  process.exit(1);
}

if (!token) {
  console.error("ORGOPS_RUNNER_TOKEN is required");
  process.exit(1);
}

async function main() {
  const res = await fetch(`${apiUrl}/api/secrets`, {
    headers: { "x-orgops-runner-token": token },
  });

  if (!res.ok) {
    console.error("API error:", await res.text());
    process.exit(1);
  }

  const rows = (await res.json()) as Array<{ name?: string; scope_type?: string; scope_id?: string | null }>;
  const keys = rows
    .filter((row) => {
      if (!row.name || row.scope_type !== parsed.scope.scopeType) return false;
      if (parsed.scope.scopeType === "public") return true;
      return row.scope_id === parsed.scope.scopeId;
    })
    .map((row) => row.name)
    .sort();
  console.log(JSON.stringify(keys, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});