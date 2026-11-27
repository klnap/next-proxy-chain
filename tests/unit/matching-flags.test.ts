import { describe, expect, it } from "bun:test";
import { compileScopes, ruleMatches } from "../../src/core/matching";
import type { BaseHandlerRule, RouteScopeList } from "../../src/core/types";

type Input = { path: string; host?: string | null };

function matcher(include: RouteScopeList, exclude?: RouteScopeList) {
  const rule = {
    run: () => undefined,
    include: compileScopes(include),
    exclude: compileScopes(exclude),
  } as BaseHandlerRule<() => undefined>;
  return (input: Input) => ruleMatches(input.path, input.host ?? null, rule);
}

type Case = {
  name: string;
  include: RouteScopeList;
  exclude?: RouteScopeList;
  input: Input;
  expected: boolean;
};

const cases: Case[] = [
  // Flags are preserved per alternative, not borrowed from a sibling.
  {
    name: "case-insensitive alternative matches",
    include: { path: [/^\/ABC$/i, "/other"] },
    input: { path: "/abc" },
    expected: true,
  },
  {
    name: "case-insensitive alternative matches uppercase",
    include: { path: [/^\/ABC$/i, "/other"] },
    input: { path: "/ABC" },
    expected: true,
  },
  {
    name: "string alternative stays case-sensitive",
    include: { path: [/^\/ABC$/i, "/other"] },
    input: { path: "/OTHER" },
    expected: false,
  },
  {
    name: "case-sensitive regex alternative rejects other case",
    include: { path: [/^\/abc$/, "/x"] },
    input: { path: "/ABC" },
    expected: false,
  },
  {
    name: "single RegExp with i flag",
    include: { path: /^\/ABC$/i },
    input: { path: "/abc" },
    expected: true,
  },
  {
    name: "same RegExp in array and single form agree",
    include: { path: [/^\/ab\/c$/i] },
    input: { path: "/AB/c" },
    expected: true,
  },
  {
    name: "dotAll alternative",
    include: { path: [/^\/a.b$/s, "/z"] },
    input: { path: "/a\nb" },
    expected: true,
  },
  {
    name: "unicode alternative",
    include: { path: [/^\/\u{1F600}$/u, "/z"] },
    input: { path: "/\u{1F600}" },
    expected: true,
  },
  {
    name: "multiline flag does not break anchors in alternative",
    include: { path: [/^\/m$/m, "/z"] },
    input: { path: "/m" },
    expected: true,
  },
  {
    name: "string pattern mixed with regex",
    include: { path: ["/docs/**", /^\/blog\/\d+$/] },
    input: { path: "/docs/a/b" },
    expected: true,
  },
  {
    name: "regex alternative among strings",
    include: { path: ["/docs/**", /^\/blog\/\d+$/] },
    input: { path: "/blog/42" },
    expected: true,
  },
  {
    name: "no alternative matches",
    include: { path: ["/docs/**", /^\/blog\/\d+$/] },
    input: { path: "/blog/x" },
    expected: false,
  },
  {
    name: "parameter segment in string alternative",
    include: { path: ["/users/:id", "/x"] },
    input: { path: "/users/7" },
    expected: true,
  },
  {
    name: "wildcard segment in alternative",
    include: { path: ["/a/*", "/b"] },
    input: { path: "/a/q" },
    expected: true,
  },
  {
    name: "wildcard segment does not span slash",
    include: { path: ["/a/*", "/b"] },
    input: { path: "/a/q/r" },
    expected: false,
  },
  {
    name: "percent-encoded path string passes through matcher",
    include: { path: ["/caf%C3%A9"] },
    input: { path: "/caf%C3%A9" },
    expected: true,
  },
  // Host and path conjunction within one scope; OR between scopes.
  {
    name: "host and path conjunction both match",
    include: { host: "a.example.com", path: "/x" },
    input: { path: "/x", host: "a.example.com" },
    expected: true,
  },
  {
    name: "host and path conjunction host fails",
    include: { host: "a.example.com", path: "/x" },
    input: { path: "/x", host: "b.example.com" },
    expected: false,
  },
  {
    name: "OR between scopes",
    include: [{ host: "a.example.com" }, { path: "/x" }],
    input: { path: "/y", host: "a.example.com" },
    expected: true,
  },
  {
    name: "multiple host alternatives",
    include: { host: ["a.example.com", "*.test.dev"] },
    input: { path: "/", host: "x.test.dev" },
    expected: true,
  },
  {
    name: "host matching stays case-insensitive",
    include: { host: "Api.Example.com" },
    input: { path: "/", host: "API.example.COM" },
    expected: true,
  },
  {
    name: "host regex with alternative path",
    include: { host: [/^app\d\.example\.com$/], path: ["/a", /^\/B$/i] },
    input: { path: "/b", host: "app1.example.com" },
    expected: true,
  },
  // Exclude precedence.
  {
    name: "exclude wins over include",
    include: { path: ["/**"] },
    exclude: { path: [/^\/ADMIN$/i] },
    input: { path: "/admin" },
    expected: false,
  },
  {
    name: "exclude alternative does not fire on other path",
    include: { path: ["/**"] },
    exclude: { path: [/^\/ADMIN$/i] },
    input: { path: "/public" },
    expected: true,
  },
];

describe("path alternatives keep per-alternative RegExp flags", () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(matcher(c.include, c.exclude)(c.input)).toBe(c.expected);
    });
  }

  it("repeated requests against stateful flags return the same result", () => {
    const match = matcher({ path: [/^\/ABC$/gi, /^\/xyz$/y] });
    for (let i = 0; i < 5; i++) {
      expect(match({ path: "/abc" })).toBe(true);
      expect(match({ path: "/xyz" })).toBe(true);
    }
  });
});
