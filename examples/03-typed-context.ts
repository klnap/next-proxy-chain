import { NextResponse } from "next/server";
import { chain as composeChain, defineHandler } from "@klnap/next-proxy-chain";

type RequestState = {
  locale?: string;
};

const detectLocale = defineHandler<RequestState>({
  name: "detect-locale",
  handle: (request, _event, context) => {
    context.locale = request.headers.get("accept-language")?.startsWith("pl") ? "pl" : "en";
    const headers = new Headers(request.headers);
    headers.set("x-request-id", context.requestId);
    return NextResponse.next({ request: { headers } });
  },
});

export default composeChain([detectLocale]);
