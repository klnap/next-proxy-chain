import type { HandlerContext } from "../../src/index";
import { chain as composeChain, defineHandler, next } from "../../src/index";

const defaultChain = composeChain([
  defineHandler({
    handler: (_req, _event, ctx) => {
      const requestId: string = ctx.requestId;
      const signal: AbortSignal = ctx.signal;
      return next({ headers: { "x-request-id": requestId, "x-aborted": String(signal.aborted) } });
    },
  }),
]);
void defaultChain;

type UserCtx = { user: string };
const typedChain = composeChain<UserCtx>([
  defineHandler<UserCtx>({
    handler: (_req, _event, ctx) => {
      const _user: string | undefined = ctx.user;
      ctx.user = "ada";
      // @ts-expect-error requestId is immutable metadata
      ctx.requestId = "spoofed";
      return next();
    },
  }),
]);
void typedChain;

type InvalidContext = HandlerContext<{ requestId: string }>;
void (null as unknown as InvalidContext);
