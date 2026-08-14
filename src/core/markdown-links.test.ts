import { describe, expect, test } from "vitest";

import { extractMarkdownLinks, toLocalLinkPath } from "./markdown-links.js";

describe("extractMarkdownLinks", () => {
  test("strips quoted, single-quoted, and parenthesized titles", () => {
    const links = extractMarkdownLinks(
      [
        '[a](docs/a.md "Title")',
        "[b](docs/b.md 'Title')",
        "[c](docs/c.md (Title))",
        '[d](<docs/with space.md> "Title")',
      ].join("\n"),
    );

    expect(links).toEqual([
      { destination: "docs/a.md", line: 1 },
      { destination: "docs/b.md", line: 2 },
      { destination: "docs/c.md", line: 3 },
      { destination: "docs/with space.md", line: 4 },
    ]);
  });

  test("unwraps angle-bracket destinations and keeps balanced parentheses", () => {
    const links = extractMarkdownLinks(
      ["[a](<docs/a b.md>)", "[b](docs/note(1).md)", "[c](docs/esc\\(1\\).md)"].join("\n"),
    );

    expect(links).toEqual([
      { destination: "docs/a b.md", line: 1 },
      { destination: "docs/note(1).md", line: 2 },
      { destination: "docs/esc(1).md", line: 3 },
    ]);
  });

  test("ignores links inside fenced code blocks", () => {
    const links = extractMarkdownLinks(
      [
        "[before](docs/before.md)",
        "```markdown",
        "[fenced](docs/fenced.md)",
        "```",
        "  ~~~",
        "[tilde](docs/tilde.md)",
        "  ~~~",
        "````",
        "```",
        "[still fenced](docs/still.md)",
        "````",
        "[after](docs/after.md)",
      ].join("\n"),
    );

    expect(links).toEqual([
      { destination: "docs/before.md", line: 1 },
      { destination: "docs/after.md", line: 12 },
    ]);
  });

  test("skips malformed links and empty destinations", () => {
    expect(extractMarkdownLinks(["[no destination]", "[empty]()", "[ok](docs/ok.md)"].join("\n"))).toEqual([
      { destination: "docs/ok.md", line: 3 },
    ]);
  });
});

describe("toLocalLinkPath", () => {
  test("ignores non-path destinations", () => {
    expect(toLocalLinkPath("#section")).toBeUndefined();
    expect(toLocalLinkPath("http://example.com/a.md")).toBeUndefined();
    expect(toLocalLinkPath("https://example.com/a.md")).toBeUndefined();
    expect(toLocalLinkPath("mailto:test@example.com")).toBeUndefined();
    expect(toLocalLinkPath("")).toBeUndefined();
  });

  test("strips fragments and percent-decodes path destinations", () => {
    expect(toLocalLinkPath("docs/guide.md#anchor")).toBe("docs/guide.md");
    expect(toLocalLinkPath("docs/my%20guide.md")).toBe("docs/my guide.md");
    expect(toLocalLinkPath("docs/%C3%BCbersicht.md")).toBe("docs/übersicht.md");
  });

  test("keeps malformed percent sequences verbatim instead of throwing", () => {
    expect(toLocalLinkPath("docs/100%discount.md")).toBe("docs/100%discount.md");
  });

  test("rejects destinations containing NUL bytes", () => {
    expect(toLocalLinkPath("docs/%00evil.md")).toBeUndefined();
  });
});
