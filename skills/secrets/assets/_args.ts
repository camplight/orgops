export type SecretCommand =
  | { scopeType: "private"; scopeId: string }
  | { scopeType: "public"; scopeId: null }
  | { scopeType: "team"; scopeId: string };

export function parseSecretCommand(argv: string[]): { scope: SecretCommand; positional: string[] } | { error: string } {
  const args = argv.slice(2);
  if (args[0] === "--") args.shift();

  let scopeType: "private" | "public" | "team" = "private";
  let teamId = "";
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--agent") continue;
    if (arg === "--public" || arg === "--global") {
      scopeType = "public";
      continue;
    }
    if (arg === "--team") {
      scopeType = "team";
      teamId = (args[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    positional.push(arg);
  }

  if (scopeType === "public") return { scope: { scopeType, scopeId: null }, positional };
  if (scopeType === "team") {
    if (!teamId) return { error: "--team requires a team id" };
    return { scope: { scopeType, scopeId: teamId }, positional };
  }

  const agentName = (process.env.ORGOPS_AGENT_NAME ?? "").trim();
  if (!agentName) return { error: "ORGOPS_AGENT_NAME is required" };
  return { scope: { scopeType: "private", scopeId: agentName }, positional };
}

export function secretKeyAndValue(positional: string[]): { key: string; value: string } | { error: string } {
  if (positional.length === 3) {
    const key = positional[1] ?? "";
    const value = positional[2];
    if (!key || value === undefined) return { error: "Missing key or value" };
    return { key, value };
  }
  if (positional.length === 2) {
    const key = positional[0] ?? "";
    const value = positional[1];
    if (!key || value === undefined) return { error: "Missing key or value" };
    return { key, value };
  }
  return { error: "Expected <key> <value>" };
}

export function secretKey(positional: string[]): { key: string } | { error: string } {
  if (positional.length === 2) {
    const key = positional[1] ?? "";
    if (!key) return { error: "Missing key" };
    return { key };
  }
  if (positional.length === 1) {
    const key = positional[0] ?? "";
    if (!key) return { error: "Missing key" };
    return { key };
  }
  return { error: "Expected <key>" };
}
