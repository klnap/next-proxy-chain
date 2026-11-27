import { describe, expect, it } from "bun:test";
import { compileScopes, host, ruleMatches } from "../../src/core/matching";
import type { BaseHandlerRule } from "../../src/core/types";

const rule = (include: Parameters<typeof compileScopes>[0]) =>
  ({ run: () => undefined, include: compileScopes(include) }) as BaseHandlerRule<() => undefined>;
const hostMatches = (matcher: Parameters<typeof host>[0], name: string) =>
  host(matcher).some((re) => re.test(name));

describe("host alternatives keep individual semantics", () => {
  it("each alternative's backreference refers to its own group", () => {
    const m = [/^(\w)\1\.a\.com$/, /^(\w)\1\.b\.com$/] as RegExp[];
    expect(hostMatches(m, "aa.a.com")).toBe(true);
    expect(hostMatches(m, "bb.b.com")).toBe(true);
    expect(hostMatches(m, "aa.b.com")).toBe(true);
  });

  it("duplicate named groups across alternatives compile and match", () => {
    const m = [/^(?<x>a)\.a\.com$/, /^(?<x>b)\.b\.com$/] as RegExp[];
    expect(hostMatches(m, "b.b.com")).toBe(true);
    expect(hostMatches(m, "a.a.com")).toBe(true);
  });

  it("unanchored RegExp alternatives still require a full hostname", () => {
    expect(hostMatches([/example\.com/], "example.com.evil")).toBe(false);
    expect(hostMatches([/example\.com/, "other.test"], "x.example.com")).toBe(false);
  });

  it("case-insensitive contract holds for regex and string alternatives", () => {
    expect(hostMatches([/^API\.example\.com$/, "*.TEST.dev"], "api.example.com")).toBe(true);
    expect(hostMatches(["Shop.Localhost"], "SHOP.localhost")).toBe(true);
  });

  it("mixed string and RegExp alternatives with a wildcard", () => {
    const m = ["shop.localhost", /^app\d\.example\.com$/, "*.test.dev"] as const;
    expect(hostMatches([...m], "app7.example.com")).toBe(true);
    expect(hostMatches([...m], "a.b.test.dev")).toBe(false);
    expect(hostMatches([...m], "x.test.dev")).toBe(true);
  });

  it("repeated tests with a global or sticky regex stay deterministic", () => {
    const [a, b] = host([/^a\.com$/g, /^b\.com$/y] as RegExp[]);
    for (let i = 0; i < 4; i++) {
      expect(a!.test("a.com")).toBe(true);
      expect(b!.test("b.com")).toBe(true);
    }
  });

  it("host and path conjunction and exclude precedence", () => {
    const include = rule([{ host: [/^(\w)\1\.a\.com$/, /^(\w)\1\.b\.com$/], path: "/x" }]);
    expect(ruleMatches("/x", "bb.b.com", include)).toBe(true);
    expect(ruleMatches("/y", "bb.b.com", include)).toBe(false);
    const excluded = { ...include, exclude: compileScopes({ host: [/^(\w)\1\.b\.com$/] }) };
    expect(ruleMatches("/x", "bb.b.com", excluded)).toBe(false);
  });
});
