const apiUrl = process.env.ORGOPS_API_URL ?? "http://localhost:8787";
const token = process.env.ORGOPS_RUNNER_TOKEN;

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const [pkg, key, value] = args;
if (!pkg || !key || value === undefined) {
  console.error("Usage: node --import tsx set.ts -- <package> <key> <value>");
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
    body: JSON.stringify({ package: pkg, key, value }),
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