import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { chain as composeChain, defineHandler, next, path } from "../../src/index";

// Positive: a native handler needs no annotations; req and event are inferred.
export const native = composeChain([
  (req, event) => {
    const url: string = req.nextUrl.pathname;
    event.waitUntil(Promise.resolve(url));
    return NextResponse.next();
  },
  async () => undefined,
]);

// Positive: string, array, object and RegExp scopes all type-check in tuples.
export const scoped = composeChain([
  [(_req: NextRequest) => undefined, "/admin/**"],
  [(_req: NextRequest) => undefined, ["/a/**", "/b/**"]],
  [(_req: NextRequest) => undefined, { exclude: /^\/private(\/.*)?$/ }],
  [(_req: NextRequest) => undefined, { include: path("/x/*"), exclude: "/x/login" }],
]);

// Positive: a typed context rule has optional application state.
type Ctx = { user: string };
const withUser = defineHandler<Ctx>({
  name: "user",
  handler: (_req, _event, ctx) => {
    const name: string | undefined = ctx.user;
    return next({ headers: { "x-user": name ?? "" } });
  },
});
export const typed = composeChain<Ctx>([withUser]);

// Negative: unknown option.
// @ts-expect-error unknown option
export const badOption = composeChain([(_req: NextRequest) => undefined], { notAnOption: true });

// Negative: scope is neither a path, a list, nor an object.
// @ts-expect-error scope must be a path matcher or an object
export const badScope = composeChain([[(_req: NextRequest) => undefined, 42]]);

// Negative: a handler must return a Response, next(), or undefined.
// @ts-expect-error string is not a valid proxy result
export const badReturn = composeChain([(_req: NextRequest, _event: NextFetchEvent) => "continue"]);

// Positive: a native handler receives the typed context as its third argument.
export const nativeWithContext = composeChain<Ctx>([
  (_req, _event, ctx) => {
    const user: string | undefined = ctx.user;
    return next({ headers: { "x-user": user ?? "" } });
  },
]);

void nativeWithContext;
void native;
void scoped;
void typed;
void badOption;
void badScope;
void badReturn;
