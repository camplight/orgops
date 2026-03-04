type Args = Record<string, string | boolean | undefined>;

export function parseArgs(argv: string[]) {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

export function requireString(args: Args, key: string): string {
  const v = args[key];
  if (!v || typeof v !== "string") {
    throw new Error(`Missing required --${key}`);
  }
  return v;
}

export function optionalString(args: Args, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" ? v : undefined;
}

export function getAgent(args: Args): string {
  return requireString(args, "agent");
}

export function getEnvForAgent(agent: string, base: string): string {
  const key = `${base}__${agent}`;
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var ${key} (set via secrets package 'slack')`);
  return v;
}

export async function slackApi<T>(botToken: string, method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${botToken}`
    },
    body: JSON.stringify(body)
  });
  const json = (await res.json()) as any;
  if (!json?.ok) {
    throw new Error(`Slack API error calling ${method}: ${json?.error ?? "unknown"}`);
  }
  return json as T;
}

export async function slackApiGet<T>(botToken: string, method: string, params: Record<string, string | undefined>) {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    method: "GET",
    headers: { authorization: `Bearer ${botToken}` }
  });
  const json = (await res.json()) as any;
  if (!json?.ok) {
    throw new Error(`Slack API error calling ${method}: ${json?.error ?? "unknown"}`);
  }
  return json as T;
}

export async function emitOrgOpsEvent(input: {
  type: string;
  source: string;
  channelId: string;
  payload: Record<string, unknown>;
}) {
  const apiUrl = process.env.ORGOPS_API_URL ?? "http://localhost:8787";
  const token = process.env.ORGOPS_RUNNER_TOKEN;
  if (!token) throw new Error("Missing ORGOPS_RUNNER_TOKEN");

  const res = await fetch(`${apiUrl}/api/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-orgops-runner-token": token
    },
    body: JSON.stringify(input)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to emit orgops event: ${res.status} ${text}`);
  }
  return (await res.json().catch(() => ({}))) as unknown;
}
