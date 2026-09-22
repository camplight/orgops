import type { Hono } from "hono";
import type { SkillRoot } from "@orgops/skills";

type SkillsDeps = {
  SKILL_ROOT: SkillRoot;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  listSkills: (root: SkillRoot) => any;
};

export function registerSkillsRoutes(app: Hono<any>, deps: SkillsDeps) {
  const { SKILL_ROOT, jsonResponse, listSkills } = deps;

  // Compatibility adapter: keep the historical local-only response shape while
  // using the same trusted local read source as the unified inventory.
  const readLocalSkills = () => listSkills(SKILL_ROOT);
  app.get("/api/skills", (c) => {
    return jsonResponse(c, readLocalSkills());
  });
}
