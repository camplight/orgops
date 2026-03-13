import type { Hono } from "hono";
import type { SkillRoot } from "@orgops/skills";

type SkillsDeps = {
  SKILL_ROOT: SkillRoot;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  listSkills: (root: SkillRoot) => any;
};

export function registerSkillsRoutes(app: Hono<any>, deps: SkillsDeps) {
  const { SKILL_ROOT, jsonResponse, listSkills } = deps;

  app.get("/api/skills", (c) => {
    return jsonResponse(c, listSkills(SKILL_ROOT));
  });
}
