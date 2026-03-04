import type { Hono } from "hono";
import type { SkillRoot } from "@orgops/skills";

type SkillsDeps = {
  SKILL_ROOTS: SkillRoot[];
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  listSkills: (roots: SkillRoot[]) => any;
};

export function registerSkillsRoutes(app: Hono<any>, deps: SkillsDeps) {
  const { SKILL_ROOTS, jsonResponse, listSkills } = deps;

  app.get("/api/skills", (c) => {
    return jsonResponse(c, listSkills(SKILL_ROOTS));
  });
}
