// Shared seam for the ticket-tracker connector example.
//
// Everything a verb file needs -- config resolution, credential lookup, the
// HTTP transport, and a small search tokenizer -- lives here, so each verb
// file stays a thin CLI wrapper around one adapter call.
//
// This is a DE-IDENTIFIED, GENERALIZED example: no real tracker host,
// project, or credential is named anywhere in this file. A real adopter
// supplies all three via the environment variables below. Node builtins
// plus global `fetch` only -- no npm dependency.

const CONFIG_ENV = {
  baseUrl: "TICKET_TRACKER_BASE_URL",
  projectKey: "TICKET_TRACKER_PROJECT_KEY",
  email: "TICKET_TRACKER_EMAIL",
};

// Named separately from CONFIG_ENV on purpose: this is the credential a
// per-invocation lookup resolves, not a value baked into skill config,
// consistent with `skills/secrets`' own env-sourced token convention.
const CREDENTIAL_ENV = "TICKET_TRACKER_API_TOKEN";

const STOPWORDS = new Set([
  "a", "an", "the", "of", "to", "in", "on", "for", "and", "or", "is", "are",
]);

export function resolveConfig() {
  const missing = Object.values(CONFIG_ENV).filter((envVar) => !process.env[envVar]);
  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return {
    ok: true,
    baseUrl: process.env[CONFIG_ENV.baseUrl],
    projectKey: process.env[CONFIG_ENV.projectKey],
    email: process.env[CONFIG_ENV.email],
  };
}

export function requireCredential() {
  const token = process.env[CREDENTIAL_ENV];
  if (!token) {
    return { ok: false, missing: [CREDENTIAL_ENV] };
  }
  return { ok: true, token };
}

export function authHeader({ email, token }) {
  const encoded = Buffer.from(`${email}:${token}`, "utf-8").toString("base64");
  return { Authorization: `Basic ${encoded}` };
}

/**
 * One transport function for every verb. Callers must have already checked
 * ready() themselves -- this function performs no readiness check of its
 * own, so the network is always the LAST thing attempted, never the first.
 *
 * Never throws: a transport failure (DNS, connection refused, timeout) or a
 * non-JSON response body is reported as an { ok: false } verdict, the same
 * shape every other failure in this adapter already uses, instead of an
 * unhandled exception reaching the caller.
 */
export async function request({ config, credential, method, path, body }) {
  let response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers: {
        ...authHeader({ email: config.email, token: credential.token }),
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    return { ok: false, status: null, body: null, error: `network request failed: ${err.message}` };
  }
  const text = await response.text();
  if (!text) {
    return { ok: response.ok, status: response.status, body: null };
  }
  try {
    return { ok: response.ok, status: response.status, body: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      status: response.status,
      body: null,
      error: `response was not valid JSON: ${text.slice(0, 200)}`,
    };
  }
}

/**
 * Every verb's own SKILL.md invocation is documented with a literal `--`
 * separator before its positional arguments (e.g. `get-issue.mjs -- KEY-1`).
 * Strip it here, once, so the documented invocation and direct positional
 * invocation both resolve to the same arguments.
 */
export function cliArgs() {
  const args = process.argv.slice(2);
  return args[0] === "--" ? args.slice(1) : args;
}

// A minimal, swappable permission catalogue -- illustrative shape only, not
// a real tracker's permission model.
export const ACTION_CATALOGUE = {
  view: "read the issue",
  comment: "add a comment",
  transition: "move the issue to a new status",
  create: "create a new issue",
  assign: "reassign the issue",
};

export function tokenizeSearchTerm(term) {
  return term
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0 && !STOPWORDS.has(token));
}

/**
 * The one place resolveConfig() and requireCredential() are combined. Every
 * verb calls this FIRST; if it returns ok: false, the verb prints that JSON
 * verdict and exits 1 without attempting any network call -- the same
 * "credential resolved from environment, checked locally before any HTTP
 * call" convention `skills/secrets/assets/list-keys.ts` already uses
 * upstream.
 */
export function ready() {
  const config = resolveConfig();
  if (!config.ok) {
    return { ok: false, reason: `missing configuration: ${config.missing.join(", ")}` };
  }
  const credential = requireCredential();
  if (!credential.ok) {
    return { ok: false, reason: `missing credential: ${credential.missing.join(", ")}` };
  }
  return { ok: true, config, credential };
}
