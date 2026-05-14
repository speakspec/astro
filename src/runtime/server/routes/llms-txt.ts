// Factory returning an Astro API route handler for src/pages/llms.txt.ts
//
// Usage:
//   // src/pages/llms.txt.ts
//   import { llmsTxtRoute } from '@speakspec/astro'
//   export const GET = llmsTxtRoute()
//
// Serves a live llms.txt projection of the entity's AIDP document per
// spec §11.3. The upstream generates the text from the same data as
// /.well-known/aidp.json, so content is always consistent. The cache
// is keyed separately from the entity directive and swept together with
// it on webhook invalidation.

import type { APIRoute } from 'astro'
import { ofetch } from 'ofetch'
import { cacheKey, isFresh, type CachedBundle } from '../utils/cache'
import { getCacheStore } from '../cache-store'
import { readConfig } from '../../config'
import { SDK_USER_AGENT } from '../../version'

export function llmsTxtRoute(): APIRoute {
  return async () => {
    const config = readConfig()
    if (!config.entityId) {
      return errorResponse(503, 'AIDP module not configured: missing entityId')
    }

    const ttlMs = config.cache.ttlSec * 1000
    const store = getCacheStore()
    const key = cacheKey('llmstxt', config.entityId)
    const cached = await store.getItem<CachedBundle<string>>(key)

    if (isFresh(cached)) {
      return textResponse(cached!.payload)
    }

    const url = `${config.endpoint.replace(/\/$/, '')}/public/entity/${encodeURIComponent(config.entityId)}`
    let text: string
    try {
      text = await ofetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': SDK_USER_AGENT,
          'Accept': 'text/markdown',
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        responseType: 'text',
        retry: 0,
        timeout: 5000,
      })
    }
    catch {
      if (cached) return staleTextResponse(cached.payload)
      return errorResponse(502, 'AIDP upstream unreachable and no cached llms.txt available')
    }

    const fresh: CachedBundle<string> = { payload: text, etag: '', expiresAt: Date.now() + ttlMs }
    await store.setItem(key, fresh)
    return textResponse(text)
  }
}

function textResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  })
}

function staleTextResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
    },
  })
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { statusCode: status, statusMessage: message } }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
