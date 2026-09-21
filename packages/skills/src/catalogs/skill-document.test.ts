import { expect, it } from "vitest";
import { parseSkillDocument } from "./skill-document";
import { expectCode } from "./fixtures";

it.each(["", "Body.\n", "---not frontmatter\n"])("accepts frontmatter with inert body %j", body => {
  expect(parseSkillDocument(`---\nname: echo-skill\ndescription: Echo.\nmetadata:\n  command: never-run\n---\n${body}`, "echo-skill"))
    .toEqual({ ok: true, value: { name: "echo-skill", description: "Echo." } });
});
it("preserves license and authored strings with CRLF", () => {
  expect(parseSkillDocument('---\r\nname: echo-skill\r\ndescription: " Echo. "\r\nlicense: MIT\r\n---', "echo-skill"))
    .toEqual({ ok: true, value: { name: "echo-skill", description: " Echo. ", license: "MIT" } });
});
it.each([
  "name: wrong\ndescription: Echo.", "name: echo-skill\nname: echo-skill\ndescription: Echo.",
  "name: echo-skill\ndescription: &a Echo\nmetadata: *a", "name: echo-skill\ndescription: !custom Echo",
  "name: echo-skill\ndescription: Echo\nmetadata: &a unused", "name: echo-skill\ndescription: 42",
  "name: echo-skill\ndescription: ' '\n", "name: echo-skill\ndescription: Echo\nlicense: 7",
  "[echo-skill, Echo]", "name: echo-skill\ndescription: [", "name: echo-skill\ndescription: Echo\nmetadata: !!js/function code",
])("rejects invalid or tagged frontmatter %j", yaml => {
  expectCode(parseSkillDocument(`---\n${yaml}\n---\nBody`, "echo-skill"), "INVALID_SKILL");
});
it.each(["\ufeff---\nname: echo-skill\ndescription: Echo\n---", " ---\nname: echo-skill\ndescription: Echo\n---", "---\nname: echo-skill\ndescription: Echo\n---oops", "--- name: echo-skill\n---"])("requires exact delimiters %j", text => {
  expectCode(parseSkillDocument(text, "echo-skill"), "INVALID_SKILL");
});
it("bounds JSON before parsing and rejects invalid string data", () => {
  expectCode(parseSkillDocument("x".repeat(12582912), "echo-skill"), "LIMIT_EXCEEDED");
  expectCode(parseSkillDocument("\ud800", "echo-skill"), "INVALID_JSON");
  let calls = 0;
  const text = Object.defineProperty({}, "text", { enumerable: true, get() { calls++; throw Error("called"); } });
  expectCode(parseSkillDocument(text as unknown as string, "echo-skill"), "INVALID_JSON");
  expect(calls).toBe(0);
});
