declare module "@orgops/skills" {
  export function loadSkillMeta(skillDir: string): { name: string; path: string } | null;
}
