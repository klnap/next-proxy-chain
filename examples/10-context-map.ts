import { chain as composeChain, defineHandler } from "@klnap/next-proxy-chain";
import { NextResponse } from "next/server";

type Context = { session?: { user: string } };

// Sets a value. Later rules in the chain can read it.
const readSession = defineHandler<Context>({
  name: "read-session",
  handle: (request, _event, context) => {
    const user = request.cookies.get("user")?.value;
    if (user) context.session = { user };
    return NextResponse.next();
  },
});

// Reads the value back.
const requireUser = defineHandler<Context>({
  name: "require-user",
  rules: { include: "/dashboard/**" },
  handle: (request, _event, context) => {
    const session = context.session;
    if (!session) return NextResponse.redirect(new URL("/login", request.url));
    return NextResponse.next();
  },
});

export default composeChain<Context>([readSession, requireUser]);
