import { NextResponse } from "next/server";

export function nextWithResponseHeaders(headers: HeadersInit): NextResponse {
  const response = NextResponse.next();
  const supplied = new Headers(headers);
  supplied.forEach((value, name) => {
    if (name !== "set-cookie") response.headers.set(name, value);
  });
  for (const cookie of supplied.getSetCookie()) response.headers.append("set-cookie", cookie);
  return response;
}
