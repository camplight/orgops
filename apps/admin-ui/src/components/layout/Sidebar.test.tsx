import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Sidebar } from "./Sidebar";

it.each([undefined, false])("hides Source Library without capability (%s) and preserves ordinary items", canManageCatalogs => {
  const html = renderToStaticMarkup(<Sidebar activeScreen="skills" onScreenChange={() => {}} canManageCatalogs={canManageCatalogs} />);
  expect(html).not.toContain('>Source Library</button>');
  for (const item of ["Dashboard", "Skills", "Secrets", "Profile"]) expect(html).toContain(`>${item}</button>`);
});
it("adds a native Source Library navigation button only with capability", () => {
  const html = renderToStaticMarkup(<Sidebar activeScreen="source-library" onScreenChange={() => {}} canManageCatalogs />);
  expect(html).toMatch(/<button[^>]*type="button"[^>]*>Source Library<\/button>/);
  expect(html.indexOf('>Skills</button>')).toBeLessThan(html.indexOf('>Source Library</button>'));
  expect(html.indexOf('>Source Library</button>')).toBeLessThan(html.indexOf('>Secrets</button>'));
});
