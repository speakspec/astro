// Pure cache helpers for the AIDP SDK's Next.js route handlers.
//
// Storage IO is pluggable — Next App Router handlers don't have a
// built-in storage primitive like Nitro's `useStorage`, so this
// module stays framework-free and accepts any object satisfying the
// `CacheStorage` interface. Default implementations (in-memory map,
// fs-backed, Redis) are exposed from `./cache-store`.

export interface CachedBundle<T = unknown> {
  payload: T
  etag: string
  expiresAt: number
}

export const STORAGE_NAMESPACE = 'cache:speakspec'

export const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000

export function cacheKey(scope: string, id: string): string {
  return `${scope}:${id}`
}

export function isFresh<T>(bundle: CachedBundle<T> | null): boolean {
  return !!bundle && bundle.expiresAt > Date.now()
}

/**
 * RFC 7232 §2.3.2 weak comparison. Strips any `W/` prefix on either
 * side before comparing the opaque value. Wildcard `*` is NOT
 * supported (treated as literal); AIDP agents send specific tags.
 */
export function etagMatches(inbound: string | undefined | null, current: string | undefined | null): boolean {
  if (!inbound || !current) return false
  const norm = (e: string) => (e.startsWith('W/') ? e.slice(2) : e).trim()
  return norm(inbound) === norm(current)
}

/**
 * True when `err` looks like a fetch failure with a 4xx status.
 * Used by route handlers to distinguish operator-action errors
 * (bad apiKey, removed entity) from transient outages — the former
 * surface as 502 with detail; the latter serve stale.
 */
export function isUpstream4xx(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const status = (err as { response?: { status?: number }, statusCode?: number }).response?.status
    ?? (err as { statusCode?: number }).statusCode
  return typeof status === 'number' && status >= 400 && status < 500
}

export interface CacheStorage {
  removeItem: (key: string) => Promise<unknown>
  getKeys: (base: string) => Promise<string[]>
}

export async function invalidateEntityCache(storage: CacheStorage, slug: string): Promise<void> {
  await storage.removeItem(cacheKey('entity', slug))
  for (const prefix of [cacheKey('content', `${slug}:`), cacheKey('directory', `${slug}:`)]) {
    const keys = await storage.getKeys(prefix)
    for (const key of keys) {
      await storage.removeItem(key)
    }
  }
}

export async function invalidateContentCache(
  storage: CacheStorage,
  slug: string,
  contentId: string,
): Promise<void> {
  await storage.removeItem(cacheKey('content', `${slug}:${contentId}`))
  const dirPrefix = cacheKey('directory', `${slug}:`)
  const keys = await storage.getKeys(dirPrefix)
  for (const key of keys) {
    await storage.removeItem(key)
  }
}

/**
 * Build a JSON Response with cache headers, short-circuiting to 304
 * when the inbound `If-None-Match` matches the response ETag (per
 * AIDP §8.7 + RFC 7232 §2.3.2 weak comparison via `etagMatches`).
 *
 * 304 responses still carry ETag + Cache-Control per RFC 7232 §4.1.
 */
export function respondWithCache<T>(
  etag: string,
  payload: T,
  cacheControl: string,
  inboundIfNoneMatch: string | undefined | null,
): Response {
  const headers: Record<string, string> = {
    'cache-control': cacheControl,
  }
  if (etag) headers.etag = etag

  if (etagMatches(inboundIfNoneMatch, etag)) {
    return new Response(null, { status: 304, headers })
  }

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      ...headers,
      'content-type': 'application/json; charset=utf-8',
    },
  })
}
