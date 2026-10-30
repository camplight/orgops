import type { Hono } from "hono";
import type { SkillRoot } from "@orgops/skills";

type SkillsDeps = {
  SKILL_ROOTS: SkillRoot[];
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  listSkills: (root: SkillRoot) => any;
  requireAuth: (c: any, next: any) => Response | Promise<Response>;
};

export function registerSkillsRoutes(app: Hono<any>, deps: SkillsDeps) {
  const { SKILL_ROOTS, jsonResponse, listSkills, requireAuth } = deps;

  app.get("/api/skills", requireAuth, (c) => {
    const merged = SKILL_ROOTS.flatMap((root) => listSkills(root));
    const deduped = merged.filter((skill, index, array) => {
      return array.findIndex((candidate) => candidate.name === skill.name) === index;
    });
    return jsonResponse(c, deduped);
  });
}
