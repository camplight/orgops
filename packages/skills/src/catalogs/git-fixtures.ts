import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RelativePathSchema } from "@orgops/schemas";
import type { OfflineGitRepository } from "./git-session";

export type FixtureFile = { path: string; bytes: Buffer; mode?: "100644" | "100755" };
export type GitFixture = {
  repository: OfflineGitRepository;
  commit(files: readonly FixtureFile[]): Promise<string>;
  object(type: "blob" | "tree" | "commit" | "tag", bytes: Buffer, literally?: boolean): Promise<string>;
  dispose(): Promise<void>;
};

// Test-owned object storage only: no checkout, real refs, ambient config or credentials.
export async function createGitFixture(format: "sha1" | "sha256" = "sha1"): Promise<GitFixture> {
  const directory = await mkdtemp(join(tmpdir(), "catalog-git-"));
  const dispose = () => rm(directory, { recursive: true, force: true });
  const repository = { directory, gitExecutable: "/usr/bin/git" };
  const env = {
    PATH: "", HOME: "/dev/null", XDG_CONFIG_HOME: "/dev/null", LC_ALL: "C", LANG: "C",
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0", GIT_ALLOW_PROTOCOL: "", GIT_OPTIONAL_LOCKS: "0", GIT_ATTR_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  };
  function run(args: string[], bytes = Buffer.alloc(0)): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile(repository.gitExecutable, [`--git-dir=${directory}`, ...args],
        { cwd: directory, env, timeout: 5000, maxBuffer: 1048576, encoding: "utf8" },
        (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
      child.stdin!.on("error", () => {});
      child.stdin!.end(bytes);
    });
  }
  try {
    await run(["init", "--bare", `--object-format=${format}`]);
    const object: GitFixture["object"] = (type, bytes, literally = false) => {
      if (literally && type !== "tree") throw new Error("Literal fixtures are trees only");
      return run(["hash-object", ...(literally ? ["--literally"] : []), "-t", type, "-w", "--stdin"], bytes);
    };
    async function commit(files: readonly FixtureFile[]): Promise<string> {
      type Tree = Map<string, Tree | FixtureFile>;
      const root: Tree = new Map();
      for (const file of files) {
        if (!RelativePathSchema.safeParse(file.path).success) throw new Error("Unsafe fixture path");
        const parts = file.path.split("/");
        let tree = root;
        for (const name of parts.slice(0, -1)) {
          let entry = tree.get(name);
          if (!entry) { entry = new Map(); tree.set(name, entry); }
          if (!(entry instanceof Map)) throw new Error("Fixture collision");
          tree = entry;
        }
        const name = parts.at(-1)!;
        if (tree.has(name)) throw new Error("Fixture collision");
        tree.set(name, file);
      }
      async function build(tree: Tree): Promise<string> {
        const entries: Buffer[] = [];
        for (const [name, entry] of [...tree].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
          const directory = entry instanceof Map;
          const oid = directory ? await build(entry) : await object("blob", entry.bytes);
          entries.push(Buffer.from(`${directory ? "40000" : entry.mode ?? "100644"} ${directory ? "tree" : "blob"} ${oid}\t${name}\0`));
        }
        return run(["mktree", "-z"], Buffer.concat(entries));
      }
      return run(["commit-tree", await build(root)], Buffer.from("Fixture commit\n"));
    }
    return { repository, object, commit, dispose };
  } catch (error) { await dispose(); throw error; }
}
