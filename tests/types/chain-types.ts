import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";
import * as api from "../../src/index";
import { chain as composeChain, defineHandler } from "../../src/index";

// Positive: a native handler needs no annotations; req and event are inferred.
export const native = composeChain([
  (req, event) => {
    const url: string = req.nextUrl.pathname;
    event.waitUntil(Promise.resolve(url));
    return NextResponse.next();
  },
  async () => undefined,
]);

// Positive: string, array, object and RegExp scopes type-check in configured handlers.
export const scoped = composeChain([
  { name: "admin", handle: (_req: NextRequest) => undefined, rules: { include: "/admin/**" } },
  {
    name: "area",
    handle: (_req: NextRequest) => undefined,
    rules: { include: ["/a/**", "/b/**"] },
  },
  {
    name: "private",
    handle: (_req: NextRequest) => undefined,
    rules: { exclude: /^\/private(\/.*)?$/ },
  },
  {
    name: "x",
    handle: (_req: NextRequest) => undefined,
    rules: { include: "/x/*", exclude: "/x/login" },
  },
]);

// Positive: a typed context rule has optional application state.
type Ctx = { user: string };
const withUser = defineHandler<Ctx>({
  name: "user",
  handle: (_req, _event, ctx) => {
    const name: string | undefined = ctx.user;
    return NextResponse.next({ headers: { "x-user": name ?? "" } });
  },
});
export const typed = composeChain<Ctx>([withUser]);

// Positive: inline and reusable configurations share the same required fields and options.
export const inline = composeChain<Ctx>([
  {
    name: "inline",
    handle: (_req, _event, ctx) => NextResponse.next(),
    rules: { include: "/dashboard/**" },
    timeout: 10,
    debug: false,
    onError: () => NextResponse.next(),
  },
]);

// Positive: reusable configurations infer callback arguments, and function and method syntax work.
const authenticate = async (_request: NextRequest) => new Response("ok");
export const reusable = defineHandler({
  name: "reusable",
  rules: { include: "/dashboard/**" },
  timeout: 500,
  debug: true,
  onError: () => NextResponse.next(),
  handle: authenticate,
});
export const methodSyntax = defineHandler({
  name: "method",
  handle(request, _event, context) {
    const pathname: string = request.nextUrl.pathname;
    const requestId: string = context.requestId;
    return pathname ? NextResponse.next() : new Response(requestId);
  },
});
export const inferredAsync = defineHandler({
  name: "async",
  handle: async (request) => new Response(request.nextUrl.pathname),
});

// Negative: configured handlers require a name and handle.
// @ts-expect-error configured handler needs a name
composeChain([{ handle: () => undefined }]);
// @ts-expect-error configured handler needs a handle
composeChain([{ name: "missing-handle" }]);
// @ts-expect-error nested handler configuration is not supported
composeChain([{ name: "nested", handle: () => undefined, config: { timeout: 10 } }]);
// @ts-expect-error the old configured property is removed
composeChain([{ name: "old-property", handler: () => undefined }]);
// @ts-expect-error invalid callback return type
composeChain([{ name: "bad-return", handle: () => "continue" }]);
// @ts-expect-error the custom next() export is removed
api.next();
// @ts-expect-error helper-specific result types are removed
type RemovedNextResult = api.NextResult;
const incompatibleContext = defineHandler<{ user: string }>({
  name: "user",
  handle: (_request, _event, context) => {
    context.user = "ada";
  },
});
// @ts-expect-error configured handler context must match the chain context
composeChain<{ admin: boolean }>([incompatibleContext]);
// @ts-expect-error function-valued handle remains contravariant in its custom context
const incompatibleHandlerConfig: api.HandlerConfig<{ admin: boolean }> = incompatibleContext;
void incompatibleHandlerConfig;
// @ts-expect-error tuple entries are removed
composeChain([[(_req: NextRequest) => undefined, "/admin/**"]]);

// Negative: unknown option.
// @ts-expect-error unknown option
export const badOption = composeChain([(_req: NextRequest) => undefined], { notAnOption: true });

// Negative: scope is neither a path, a list, nor an object.
// @ts-expect-error scope must be a path matcher or an object
export const badScope = composeChain([[(_req: NextRequest) => undefined, 42]]);

// Negative: a handler must return a Response, NextResponse.next(), or undefined.
// @ts-expect-error string is not a valid proxy result
export const badReturn = composeChain([(_req: NextRequest, _event: NextFetchEvent) => "continue"]);

// Positive: a native handler receives the typed context as its third argument.
export const nativeWithContext = composeChain<Ctx>([
  (_req, _event, ctx) => {
    const user: string | undefined = ctx.user;
    return NextResponse.next({ headers: { "x-user": user ?? "" } });
  },
]);

void nativeWithContext;
void reusable;
void methodSyntax;
void inferredAsync;
void native;
void scoped;
void typed;
void inline;
void badOption;
void badScope;
void badReturn;
