const apiUrl = process.env.ORGOPS_API_URL ?? "http://localhost:8787";
const token = process.env.ORGOPS_RUNNER_TOKEN;

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const [pkg] = args;

if (!token) {
  console.error("ORGOPS_RUNNER_TOKEN is required");
  process.exit(1);
}

async function main() {
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
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});