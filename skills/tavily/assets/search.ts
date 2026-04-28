import { ensureTvlyInstalled, runTvly } from "./_lib";

function parseArgs(argv: string[]) {
  const out: any = { query: undefined, maxResults: undefined, depth: undefined, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--query" || a === "-q") out.query = argv[++i];
    else if (a === "--max-results") out.maxResults = argv[++i];
    else if (a === "--depth") out.depth = argv[++i];
    else if (a === "--json") out.json = true;
  }
  if (!out.query) throw new Error("--query is required");
  return out;
}

const args = parseArgs(process.argv.slice(2));
ensureTvlyInstalled();

const tvlyArgs = ["search", args.query];
if (args.depth) tvlyArgs.push("--depth", String(args.depth));
if (args.maxResults) tvlyArgs.push("--max-results", String(args.maxResults));
if (args.json) tvlyArgs.push("--json");

const stdout = runTvly(tvlyArgs);
process.stdout.write(stdout);
