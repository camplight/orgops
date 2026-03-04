import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { listSkills } from "./index";

describe("skills", () => {
  it("reads built-in skills", () => {
    const skillsDir = join(import.meta.dir, "..", "..", "..", "skills");
    const skills = listSkills([{ path: skillsDir, location: "workspace" }]);
    expect(skills.length).toBeGreaterThan(0);
    expect(skills.find((skill) => skill.name === "events")).toBeTruthy();
  });
});
