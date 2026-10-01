import type { Hono } from "hono";
import type {
  SkillDiscovery,
  SkillRoot,
} from "@orgops/skills";

type SkillsDeps = {
  SKILL_ROOTS: SkillRoot[];
  discoverSkills: (roots: SkillRoot[]) => SkillDiscovery;
  jsonResponse: (c: any, data: unknown, status?: number) => Response;
  requireAuth: (c: any, next: any) => Response | Promise<Response>;
};

export function registerSkillsRoutes(app: Hono<any>, deps: SkillsDeps) {
  const { SKILL_ROOTS, discoverSkills, jsonResponse, requireAuth } = deps;

  app.get("/api/skills", requireAuth, (c) => {
    return jsonResponse(c, discoverSkills(SKILL_ROOTS));
  });
}
