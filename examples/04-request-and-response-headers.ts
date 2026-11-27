import { NextResponse } from "next/server";
import { chain as composeChain, defineHandler } from "@klnap/next-proxy-chain";

const tagUser = defineHandler({
  name: "tag-user",
  handle: (request) => {
    const headers = new Headers(request.headers);
    headers.set("x-user-tier", "free");
    const response = NextResponse.next({ request: { headers } });
    response.headers.set("cache-control", "no-store");
    return response;
  },
});

export default composeChain([tagUser]);
