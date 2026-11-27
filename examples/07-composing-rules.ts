import { NextResponse } from "next/server";
import { chain as composeChain, defineHandler } from "@klnap/next-proxy-chain";

type Ctx = { locale?: string };

// Each integration exports a factory. The app decides where and in which order it runs.
export function createRequestIdRule() {
  return defineHandler<Ctx>({
    name: "request-id",
    handle: (request, _event, context) => {
      const headers = new Headers(request.headers);
      headers.set("x-request-id", context.requestId);
      return NextResponse.next({ request: { headers } });
    },
  });
}

export function createLocaleRule(locales: readonly string[], fallback: string) {
  return defineHandler<Ctx>({
    name: "locale",
    rules: { include: "/**" },
    handle: (request) => {
      const first = request.nextUrl.pathname.split("/")[1] ?? "";
      if (locales.includes(first)) return NextResponse.next();
      const response = NextResponse.next();
      response.headers.set("content-language", fallback);
      return response;
    },
  });
}

export function createMaintenanceRule(enabled: boolean) {
  return defineHandler<Ctx>({
    name: "maintenance",
    handle: () => {
      if (enabled) return new Response("Maintenance", { status: 503 });
      return NextResponse.next();
    },
  });
}

const requestId = createRequestIdRule();
const locale = createLocaleRule(["en", "pl"], "en");
const maintenance = createMaintenanceRule(false);

export default composeChain<Ctx>([requestId, maintenance, locale]);
