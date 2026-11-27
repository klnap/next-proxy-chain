import { describe, expect, it } from "bun:test";
import type { NextFetchEvent } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { chain, defineHandler } from "../../src/index";
import type { ChainTrace, DebugLevel, HandlerTrace } from "../../src/core/diagnostics/types";

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const fakeEvent = {} as NextFetchEvent;

const ok = (name: string) => defineHandler({ name, handle: () => undefined });
const fails = (name: string) =>
  defineHandler({
    name,
    handle: () => {
      throw new Error(`${name} failed`);
    },
  });
const recovers = (name: string, value: () => NextResponse | Response | undefined) =>
  defineHandler({
    name,
    handle: () => {
      throw new Error(`${name} failed`);
    },
    onError: () => value(),
  });

type Entry = Parameters<typeof chain>[0][number];

async function traceOf(
  entries: Entry[],
  url = "http://localhost/admin",
  options: { debug?: DebugLevel; logger?: typeof silent } = {},
): Promise<{ trace: ChainTrace; res: Response }> {
  let captured: ChainTrace | undefined;
  const handler = chain(entries, {
    logger: options.logger ?? silent,
    debug: options.debug ?? false,
    onTrace: (trace) => {
      captured = trace;
    },
  });
  const res = await handler(new NextRequest(url), fakeEvent);
  if (!captured) throw new Error("no trace emitted");
  return { trace: captured, res };
}

/** Compact projection: "name:outcome" in chain order. */
function summarize(handlers: readonly HandlerTrace[]): string[] {
  return handlers.map((h) => {
    if (h.outcome === "recovered") return `${h.name}:recovered(${h.recovery})`;
    if (h.outcome === "skipped") return `${h.name}:skipped(${h.reason})`;
    if (h.outcome === "rewrite") return `${h.name}:rewrite(${h.final ? "final" : "staged"})`;
    if (h.outcome === "redirect") return `${h.name}:redirect`;
    if (h.outcome === "response") return `${h.name}:response`;
    return `${h.name}:${h.outcome}`;
  });
}

const redirect = () =>
  defineHandler({
    name: "redirect",
    handle: () => NextResponse.redirect(new URL("/login", "http://localhost")),
  });
const respond = () =>
  defineHandler({ name: "respond", handle: () => new Response("stop", { status: 403 }) });
const rewrite = (name: string, to: string) =>
  defineHandler({ name, handle: () => NextResponse.rewrite(new URL(to, "http://localhost")) });
const skippedByScope = (name: string) =>
  defineHandler({
    name,
    rules: { include: "/other" },
    handle: () => {
      throw new Error("must not run");
    },
  });

describe("structured trace after recovery", () => {
  it("records every successful continuation after a recovered failure", async () => {
    const { trace } = await traceOf([
      recovers("thrower", () => NextResponse.next()),
      ok("first"),
      ok("second"),
    ]);
    expect(summarize(trace.handlers)).toEqual([
      "thrower:recovered(continue)",
      "first:continue",
      "second:continue",
    ]);
    expect(trace.outcome).toEqual({ type: "next" });
  });

  it("records a skipped handler after a recovered failure", async () => {
    const { trace } = await traceOf([
      recovers("thrower", () => NextResponse.next()),
      skippedByScope("scoped"),
      ok("last"),
    ]);
    expect(summarize(trace.handlers)).toEqual([
      "thrower:recovered(continue)",
      "scoped:skipped(include-mismatch)",
      "last:continue",
    ]);
  });

  it("records a staged rewrite after a recovered failure", async () => {
    const { trace } = await traceOf([
      recovers("thrower", () => NextResponse.next()),
      rewrite("router", "/next"),
      ok("last"),
    ]);
    expect(summarize(trace.handlers)).toEqual([
      "thrower:recovered(continue)",
      "router:rewrite(final)",
      "last:continue",
    ]);
    expect(trace.outcome).toEqual({ type: "rewrite", destination: "/next" });
  });

  it("records a rewrite that a failure recovered into", async () => {
    const { trace } = await traceOf([
      recovers("thrower", () => NextResponse.rewrite(new URL("/recovered", "http://localhost"))),
      ok("last"),
    ]);
    expect(summarize(trace.handlers)).toEqual(["thrower:recovered(rewrite)", "last:continue"]);
    expect(trace.outcome).toEqual({ type: "rewrite", destination: "/recovered" });
  });

  it("records a redirect after a recovered failure", async () => {
    const { trace } = await traceOf([
      recovers("thrower", () => NextResponse.next()),
      redirect(),
      ok("unreached"),
    ]);
    expect(summarize(trace.handlers)).toEqual([
      "thrower:recovered(continue)",
      "redirect:redirect",
      "unreached:not-reached",
    ]);
    expect(trace.outcome.type).toBe("redirect");
  });

  it("records a terminal response after a recovered failure", async () => {
    const { trace } = await traceOf([
      recovers("thrower", () => NextResponse.next()),
      respond(),
      ok("unreached"),
    ]);
    expect(summarize(trace.handlers)).toEqual([
      "thrower:recovered(continue)",
      "respond:response",
      "unreached:not-reached",
    ]);
  });

  it("records consecutive recovered failures independently", async () => {
    const { trace } = await traceOf([
      recovers("first-fail", () => NextResponse.next()),
      recovers("second-fail", () => NextResponse.next()),
      ok("last"),
    ]);
    expect(summarize(trace.handlers)).toEqual([
      "first-fail:recovered(continue)",
      "second-fail:recovered(continue)",
      "last:continue",
    ]);
  });

  it("records an unrecovered failure after a recovered one", async () => {
    const { trace, res } = await traceOf([
      recovers("first-fail", () => NextResponse.next()),
      fails("second-fail"),
      ok("unreached"),
    ]);
    expect(summarize(trace.handlers)).toEqual([
      "first-fail:recovered(continue)",
      "second-fail:failed",
      "unreached:not-reached",
    ]);
    expect(res.status).toBe(500);
  });

  it("attributes outcomes by position when handler names repeat", async () => {
    const { trace } = await traceOf([
      ok("same"),
      recovers("same", () => NextResponse.next()),
      ok("same"),
    ]);
    expect(summarize(trace.handlers)).toEqual([
      "same:continue",
      "same:recovered(continue)",
      "same:continue",
    ]);
  });

  it("keeps one trace per configured entry under concurrent requests", async () => {
    const entries: Entry[] = [
      recovers("thrower", () => NextResponse.next()),
      ok("first"),
      ok("second"),
    ];
    const traces = await Promise.all(
      Array.from({ length: 8 }, () => traceOf(entries).then((result) => result.trace)),
    );
    for (const trace of traces) {
      expect(summarize(trace.handlers)).toEqual([
        "thrower:recovered(continue)",
        "first:continue",
        "second:continue",
      ]);
    }
  });

  for (const debug of [false, true, "compact", "detailed", "verbose"] as const) {
    it(`keeps the complete trace in debug mode ${String(debug)}`, async () => {
      const lines: string[] = [];
      const { trace } = await traceOf(
        [recovers("thrower", () => NextResponse.next()), ok("first"), ok("second")],
        "http://localhost/admin",
        {
          debug,
          logger: {
            debug() {},
            info: (...args: unknown[]) => {
              lines.push(args.map(String).join(" "));
            },
            warn() {},
            error() {},
          },
        },
      );
      expect(summarize(trace.handlers)).toEqual([
        "thrower:recovered(continue)",
        "first:continue",
        "second:continue",
      ]);
      if (debug !== false) expect(lines.length).toBeGreaterThan(0);
    });
  }
});
