const MAX_TEXT_LENGTH = 160;

export function safeDiagnosticText(value: string, limit = MAX_TEXT_LENGTH): string {
  let output = "";
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (
      code === 0x1b ||
      code < 0x20 ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x00ad ||
      code === 0x061c ||
      code === 0x180e ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x2028 && code <= 0x202e) ||
      (code >= 0x2060 && code <= 0x206f) ||
      code === 0xfeff
    ) {
      output += "�";
    } else {
      output += char;
    }
    if (output.length >= limit) return `${output.slice(0, limit)}…`;
  }
  return output;
}

export function safeDestination(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, "http://proxy-chain.invalid");
    return safeDiagnosticText(`${url.pathname}${url.search ? "?[query]" : ""}`);
  } catch {
    return safeDiagnosticText(value.split(/[?#]/, 1)[0] ?? "");
  }
}
