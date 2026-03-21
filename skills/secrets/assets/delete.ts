const apiUrl = process.env.ORGOPS_API_URL ?? "http://localhost:8787";
const token = process.env.ORGOPS_RUNNER_TOKEN;

const [, , pkg, key] = process.argv;
if (!pkg || !key) {
  console.error("Usage: node --import tsx delete.ts -- <package> <key>");
  process.exit(1);
}

if (!token) {
  console.error("ORGOPS_RUNNER_TOKEN is required");
  process.exit(1);
}

const res = await fetch(`${apiUrl}/api/secrets`, {
  method: "DELETE",
  headers: {
    "content-type": "application/json",
    "x-orgops-runner-token": token,
  },
  body: JSON.stringify({ package: pkg, key }),
});

if (!res.ok) {
  if (res.status === 404) {
    console.error("Secret not found");
  } else {
    console.error("API error:", await res.text());
  }
  process.exit(1);
}

console.log(JSON.stringify({ ok: true }));