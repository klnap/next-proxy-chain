/** Multi-host physical folder prefixing for internal routing headers. */

export function physicalFolderPrefix(raw: string): string {
  return (
    "/" +
    raw
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .filter((seg: string) => !/^\(.*\)$/.test(seg))
      .join("/")
  );
}

/** True when `pathname` is `folder` or lies below it. `/tenant-other` is not inside `/tenant`. */
export function isInsideFolder(pathname: string, folder: string): boolean {
  if (folder === "/") return true;
  return pathname === folder || pathname.startsWith(`${folder}/`);
}

export function applyFolderPrefix(rewriteUrl: string, folder: string, baseUrl: string): string {
  try {
    const parsed = new URL(rewriteUrl, baseUrl);
    if (!isInsideFolder(parsed.pathname, folder)) {
      parsed.pathname = folder + (parsed.pathname === "/" ? "" : parsed.pathname);
      return parsed.toString();
    }
    return rewriteUrl;
  } catch {
    if (!isInsideFolder(rewriteUrl, folder)) {
      return folder + (rewriteUrl === "/" ? "" : rewriteUrl);
    }
    return rewriteUrl;
  }
}
