// local-skill-fixtures.ts -- test-only
import { mkdtemp, mkdir, writeFile, chmod, rm, symlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { RelativePathSchema } from "@orgops/schemas";
export type LocalSkillFixture = {
  directory: string; root: string;
  file(path: string, bytes: Uint8Array, executable?: boolean): Promise<void>;
  directoryAt(path: string): Promise<void>;
  linkAt(path: string, target: string): Promise<void>;
  dispose(): Promise<void>;
};
export async function createLocalSkillFixture(): Promise<LocalSkillFixture> {
  // Owned scratch only, but portable: TMPDIR is supplied by the validation harness
  // (beneath D/scratch during this phase) and by the ambient temp dir otherwise.
  // This factory creates and disposes exactly its own mkdtemp parent and never
  // touches a configured/real skill root. Do not hardcode a phase or repo path here.
  const directory = await mkdtemp(join(tmpdir(), "catalog-local-"));
  const root = join(directory, "root");
  const dispose = () => rm(directory, { recursive: true, force: true });
  const safe = (path: string) => {
    if (!RelativePathSchema.safeParse(path).success) throw new Error("Invalid fixture path");
    return join(root, path);
  };
  try {
    await mkdir(root);
    return { directory, root, dispose,
      async file(path, bytes, executable = false) {
        const target = safe(path); await mkdir(dirname(target), { recursive: true });
        await writeFile(target, bytes); await chmod(target, executable ? 0o755 : 0o644);
      },
      async directoryAt(path) { await mkdir(safe(path), { recursive: true }); },
      async linkAt(path, target) { await symlink(safe(target), safe(path)); },
    };
  } catch (error) { await dispose(); throw error; }
}
