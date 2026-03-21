const apiUrl = process.env.ORGOPS_API_URL ?? "http://localhost:8787";
const token = process.env.ORGOPS_RUNNER_TOKEN;

const [, , pkg] = process.argv;

if (!token) {
  console.error("ORGOPS_RUNNER_TOKEN is required");
  process.exit(1);
}

const url = pkg ? `${apiUrl}/api/secrets/keys?package=${encodeURIComponent(pkg)}` : `${apiUrl}/api/secrets/keys`;
const res = await fetch(url, {
  headers: { "x-orgops-runner-token": token },
});

if (!res.ok) {
  console.error("API error:", await res.text());
  process.exit(1);
}

const data = (await res.json()) as { keys: { package: string; key: string }[] };
console.log(JSON.stringify(data.keys, null, 2));