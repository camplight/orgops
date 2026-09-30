import type { Hono } from "hono";
import type {
  SkillDiscovery,
  SkillRoot,
} from "@orgops/skills";

type SkillsDeps = {
  SKILL_ROOTS: SkillRoot[];
  discoverSkills: (roots: SkillRoot[]) => SkillDiscovery;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
};

export function registerSkillsRoutes(app: Hono<any>, deps: SkillsDeps) {
  const { SKILL_ROOTS, discoverSkills, jsonResponse } = deps;

  app.get("/api/skills", (c) => {
    return jsonResponse(c, discoverSkills(SKILL_ROOTS));
  });
}
