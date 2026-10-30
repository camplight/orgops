import { parseSecretCommand, secretKeyAndValue } from "./_args.ts";

const apiUrl = process.env.ORGOPS_API_URL ?? "http://localhost:8787";
const token = process.env.ORGOPS_RUNNER_TOKEN;

const parsed = parseSecretCommand(process.argv);
if ("error" in parsed) {
  console.error(parsed.error);
  console.error("Usage: node --import tsx set.ts -- [--public | --team <teamId>] <key> <value>");
  process.exit(1);
}
const keyAndValue = secretKeyAndValue(parsed.positional);
if ("error" in keyAndValue) {
  console.error("Usage: node --import tsx set.ts -- [--public | --team <teamId>] <key> <value>");
  process.exit(1);
}

if (!token) {
  console.error("ORGOPS_RUNNER_TOKEN is required");
  process.exit(1);
}

async function main() {
  const res = await fetch(`${apiUrl}/api/secrets`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-orgops-runner-token": token,
    },
    body: JSON.stringify({
      key: keyAndValue.key,
      value: keyAndValue.value,
      scopeType: parsed.scope.scopeType,
      ...(parsed.scope.scopeId ? { scopeId: parsed.scope.scopeId } : {}),
    }),
  });

  if (!res.ok) {
    console.error("API error:", await res.text());
    process.exit(1);
  }

  console.log(await res.text());
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
