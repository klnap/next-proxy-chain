import { chain as composeChain, defineHandler, next } from "@klnap/next-proxy-chain";

type Ctx = { user?: string };

// 3. A rule that reads the context.
const readSession = defineHandler<Ctx>({
  name: "read-session",
  handler: (req, _event, ctx) => {
    ctx.user = req.cookies.get("user")?.value;
    return next({ headers: { "x-request-id": ctx.requestId } });
  },
});

export default composeChain<Ctx>([readSession]);
