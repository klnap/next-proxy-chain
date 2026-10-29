/** Multi-host physical folder prefixing for internal routing headers. */

export function physicalFolderPrefix(raw: string): string {
  return (
    '/' +
    raw
      .replace(/^\/+|\/+$/g, '')
      .split('/')
      .filter((seg: string) => !/^\(.*\)$/.test(seg))
      .join('/')
  )
}

export function applyFolderPrefix(rewriteUrl: string, folder: string, baseUrl: string): string {
  try {
    const parsed = new URL(rewriteUrl, baseUrl)
    if (!parsed.pathname.startsWith(folder)) {
      parsed.pathname = folder + (parsed.pathname === '/' ? '' : parsed.pathname)
      return parsed.toString()
    }
    return rewriteUrl
  } catch {
    if (!rewriteUrl.startsWith(folder)) {
      return folder + (rewriteUrl === '/' ? '' : rewriteUrl)
    }
    return rewriteUrl
  }
}
