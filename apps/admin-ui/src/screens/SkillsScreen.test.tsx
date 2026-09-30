import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SkillsScreen } from "./SkillsScreen";

const externalSkill = {
  name: "private",
  description: "Private skill",
  path: "/private/private",
  root: { kind: "EXTERNAL" as const, path: "/private" },
};

describe("SkillsScreen", () => {
  it("shows skill roots and bounded discovery warnings without listing conflicts", () => {
    const markup = renderToStaticMarkup(
      <SkillsScreen
        skills={[externalSkill]}
        conflicts={[{ name: "duplicate", paths: ["/a/duplicate", "/b/duplicate"] }]}
        diagnostics={[{ path: "/missing", code: "MISSING" }]}
      />,
    );

    expect(markup).toContain("External");
    expect(markup).toContain("/private");
    expect(markup).toContain("duplicate");
    expect(markup).toContain("/a/duplicate");
    expect(markup).toContain("/b/duplicate");
    expect(markup).toContain("MISSING: /missing");
    expect(markup).not.toContain('class="text-slate-200">duplicate</div>');
  });
});
