function appendPath(root: string, endpoint: string): string {
  return `${root}/${endpoint}`.replace(/^\/+/, '/')
}

function trimTrailingSlashes(pathname: string): string {
  return pathname.replace(/\/+$/, '')
}

function stripEndpoint(pathname: string, endpoint: string): string {
  return pathname.endsWith(`/${endpoint}`) ? pathname.slice(0, -endpoint.length - 1) : pathname
}

/**
 * Resolves an OpenAI-style endpoint from an API root. A configured terminal
 * version (`/v1`, `/v2`, ...) is authoritative; only an unversioned root
 * receives the conventional `/v1` fallback.
 */
function getVersionedApiUrl(baseUrl: string, endpoint: string): string {
  const url = new URL(baseUrl)
  const root = trimTrailingSlashes(url.pathname)
  url.pathname = root.endsWith(`/${endpoint}`)
    ? root
    : appendPath(/\/v\d+$/.test(root) ? root : appendPath(root, 'v1'), endpoint)
  return url.toString()
}

function getVersionedSiblingApiUrl(
  baseUrl: string,
  configuredEndpoint: string,
  endpoint: string
): string {
  const url = new URL(baseUrl)
  url.pathname = stripEndpoint(trimTrailingSlashes(url.pathname), configuredEndpoint)
  return getVersionedApiUrl(url.toString(), endpoint)
}

/**
 * Resolves a native endpoint without inferring an API version. Unlike
 * `new URL('/path', baseUrl)`, it retains a configured gateway path prefix.
 */
function getNativeApiUrl(baseUrl: string, endpoint: string): string {
  const url = new URL(baseUrl)
  const root = trimTrailingSlashes(url.pathname)
  url.pathname = root.endsWith(`/${endpoint}`) ? root : appendPath(root, endpoint)
  return url.toString()
}

export { getNativeApiUrl, getVersionedApiUrl, getVersionedSiblingApiUrl }
