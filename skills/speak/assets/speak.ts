import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const MAX_INPUT_CHARS = 4096;
const FORMATS = new Set(["mp3", "wav", "opus", "aac", "flac"]);
const VOICES = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"];

/** A stable voice per agent, so several agents speaking in one channel sound distinct. */
function voiceForAgent(agentName: string | undefined): string {
  if (!agentName) return "marin";
  let hash = 0;
  for (const char of agentName) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return VOICES[hash % VOICES.length]!;
}

function parseArgs(argv: string[]) {
  const out: Record<string, string | undefined> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (!arg?.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    out[arg.slice(2)] = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const text = (args["text-file"] ? await readFile(args["text-file"], "utf8") : args.text ?? "").trim();
  if (!text) throw new Error("Provide --text \"...\" or --text-file <path>");
  if (text.length > MAX_INPUT_CHARS) {
    throw new Error(`Text is ${text.length} chars; the speech API accepts at most ${MAX_INPUT_CHARS}. Shorten it or split it into several files.`);
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY. Store it in OrgOps secrets so the runner injects it into shell tools.");
  }
  const format = args.format ?? "mp3";
  if (!FORMATS.has(format)) throw new Error(`--format must be one of ${[...FORMATS].join(", ")}`);
  const model = args.model ?? process.env.ORGOPS_TTS_MODEL ?? "gpt-4o-mini-tts";
  const voice = args.voice ?? process.env.ORGOPS_TTS_VOICE ?? voiceForAgent(process.env.ORGOPS_AGENT_NAME);
  const outputRoot = process.env.ORGOPS_AGENT_WORKSPACE || process.cwd();
  const out = resolve(outputRoot, args.out ?? `.orgops-speech/speech-${Date.now()}.${format}`);

  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/audio/speech`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      voice,
      input: text,
      response_format: format,
      ...(args.instructions ? { instructions: args.instructions } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`Speech API ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, bytes);
  console.log(JSON.stringify({ path: out, bytes: bytes.byteLength, format, model, voice }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
