import { describe, expect, it } from "bun:test";
import * as api from "../../src/index";

describe("public API surface", () => {
  it("exports only documented runtime symbols from the package entry", () => {
    expect(Object.keys(api).sort()).toEqual(["chain", "defineHandler"]);
    expect(api).not.toHaveProperty("defineProxy");
    expect(api).not.toHaveProperty("proxyChain");
  });
});
