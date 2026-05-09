// Astro API route factory for /.well-known/aidp/content/[id].json
//
// Usage:
//   // src/pages/.well-known/aidp/content/[id].json.ts
//   import { aidpContentRoute } from '@speakspec/astro'
//   export const GET = aidpContentRoute()
//
//   export function getStaticPaths() { return [] }   // for SSG hybrid

import type { APIRoute } from 'astro'
import { fetchContentEnvelope } from '../utils/fetch-content'
import {
  cacheKey,
  isFresh,
  isUpstream4xx,
  respondWithCache,
  DEFAULT_CACHE_TTL_MS,
  type CachedBundle,
} from '../utils/cache'
import { getCacheStore } from '../cache-store'
import { readConfig } from '../../config'

const FRESH_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=300'
const STALE_CACHE_CONTROL = 'public, max-age=10, stale-while-revalidate=60'

export function aidpContentRoute(): APIRoute {
  return async ({ request, params }) => {
    const config = readConfig()
    if (!config.entityId) {
      return errorResponse(503, 'AIDP module not configured: missing entityId')
    }

    const rawId = (params.id ?? '') as string
    if (!rawId) {
      return errorResponse(400, 'content id is required')
    }
    // Astro file `.well-known/aidp/content/[id].json.ts` already strips
    // the .json suffix from the param. Defensive trim in case the
    // host wires the route differently.
    const contentId = rawId.endsWith('.json') ? rawId.slice(0, -5) : rawId

    const inboundIfNoneMatch = request.headers.get('if-none-match') ?? undefined
    const store = getCacheStore()
    const key = cacheKey('content', `${config.entityId}:${contentId}`)
    const cached = await store.getItem<CachedBundle<Record<string, unknown>>>(key)

    if (isFresh(cached)) {
      return respondWithCache(cached!.etag, cached!.payload, FRESH_CACHE_CONTROL, inboundIfNoneMatch)
    }

    const upstreamIfNoneMatch = cached?.etag || undefined

    let result
    try {
      result = await fetchContentEnvelope({
        endpoint: config.endpoint,
        entityId: config.entityId,
        contentId,
        apiKey: config.apiKey || undefined,
        ifNoneMatch: upstreamIfNoneMatch,
      })
    }
    catch (err) {
      if (isUpstream4xx(err)) {
        const status = (err as { response?: { status?: number } }).response?.status
        return errorResponse(502, `AIDP upstream rejected the content fetch (${status})`)
      }
      if (cached) {
        return respondWithCache(cached.etag, cached.payload, STALE_CACHE_CONTROL, inboundIfNoneMatch)
      }
      return errorResponse(502, 'AIDP upstream unreachable and no cached payload available')
    }

    if (result.notModified && cached) {
      const refreshed: CachedBundle<Record<string, unknown>> = {
        payload: cached.payload,
        etag: cached.etag,
        expiresAt: Date.now() + DEFAULT_CACHE_TTL_MS,
      }
      await store.setItem(key, refreshed)
      return respondWithCache(refreshed.etag, refreshed.payload, FRESH_CACHE_CONTROL, inboundIfNoneMatch)
    }

    if (!result.payload) {
      return errorResponse(502, 'AIDP upstream returned empty payload')
    }

    const fresh: CachedBundle<Record<string, unknown>> = {
      payload: result.payload,
      etag: result.etag,
      expiresAt: Date.now() + DEFAULT_CACHE_TTL_MS,
    }
    await store.setItem(key, fresh)
    return respondWithCache(fresh.etag, fresh.payload, FRESH_CACHE_CONTROL, inboundIfNoneMatch)
  }
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { statusCode: status, statusMessage: message } }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
