import { ensureTvlyInstalled, runTvly } from "./_lib";

function parseArgs(argv: string[]) {
  const out: any = { url: undefined, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url" || a === "-u") out.url = argv[++i];
    else if (a === "--json") out.json = true;
  }
  if (!out.url) throw new Error("--url is required");
  return out;
}

const args = parseArgs(process.argv.slice(2));
ensureTvlyInstalled();

const tvlyArgs = ["extract", args.url];
if (args.json) tvlyArgs.push("--json");

const stdout = runTvly(tvlyArgs);
process.stdout.write(stdout);
