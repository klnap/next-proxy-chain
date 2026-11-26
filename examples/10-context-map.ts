import { chain as composeChain, defineHandler, next } from "@klnap/next-proxy-chain";
import { NextResponse } from "next/server";

type Context = { session?: { user: string } };

// Sets a value. Later rules in the chain can read it.
const readSession = defineHandler<Context>({
  name: "read-session",
  handler: (req, _event, ctx) => {
    const user = req.cookies.get("user")?.value;
    if (user) ctx.session = { user };
    return next();
  },
});

// Reads the value back.
const requireUser = defineHandler<Context>({
  name: "require-user",
  handler: (req, _event, ctx) => {
    const session = ctx.session;
    if (!session) return NextResponse.redirect(new URL("/login", req.url));
    return next();
  },
});

export default composeChain<Context>([readSession, [requireUser, "/dashboard/**"]]);
