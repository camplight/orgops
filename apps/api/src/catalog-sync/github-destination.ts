export type GitHubDestination = Readonly<{ owner: string; name: string; fetchUrl: string }>;
export type GitHubDestinationResult = { ok: true; value: GitHubDestination } | { ok: false };

// Owner names may not begin or end with a hyphen (GitHub rule).
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;
const PREFIX = "https://github.com/";

/** GitHub-hosted HTTPS destinations only; validation of the CONFIGURED URL, never a mirror path. */
export function parseGitHubDestination(url: string): GitHubDestinationResult {
  const rejected: GitHubDestinationResult = { ok: false };
  if (typeof url !== "string" || url.length < 1 || url.length > 2048) return rejected;
  if (/[^\x21-\x7e]/.test(url)) return rejected; // controls/space/non-ASCII
  if (!url.startsWith(PREFIX)) return rejected;
  const rest = url.slice(PREFIX.length);
  if (/[\\%?#@:]/.test(rest)) return rejected; // no userinfo/port/query/fragment/escape
  const segments = rest.split("/");
  if (segments.length !== 2 || segments.some(segment => segment.length === 0)) return rejected;
  const [owner, rawName] = segments as [string, string];
  if (!OWNER.test(owner)) return rejected;
  const name = rawName.endsWith(".git") ? rawName.slice(0, -4) : rawName;
  if (!NAME.test(name) || name === "." || name === ".." || name.endsWith(".git")) return rejected;
  return { ok: true, value: Object.freeze({ owner, name, fetchUrl: `${PREFIX}${owner}/${name}.git` }) };
}
