import { NextResponse } from "next/server";
import { chain as composeChain, defineHandler } from "@klnap/next-proxy-chain";

type Ctx = { user?: string };

// 3. A rule that reads the context.
const readSession = defineHandler<Ctx>({
  name: "read-session",
  handle: (request, _event, context) => {
    context.user = request.cookies.get("user")?.value;
    const response = NextResponse.next();
    response.headers.set("x-request-id", context.requestId);
    return response;
  },
});

export default composeChain<Ctx>([readSession]);
