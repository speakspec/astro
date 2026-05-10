import { describe, it, expect } from 'vitest'
import {
  cacheKey,
  isFresh,
  isUpstream4xx,
  etagMatches,
  respondWithCache,
  DEFAULT_CACHE_TTL_MS,
  invalidateEntityCache,
  invalidateContentCache,
  type CachedBundle,
  type CacheStorage,
} from '../src/runtime/server/utils/cache'

describe('cacheKey', () => {
  it('namespaces scope and id with a colon', () => {
    expect(cacheKey('entity', 'stockfeel')).toBe('entity:stockfeel')
    expect(cacheKey('content', 'etf-explainer-2026-04')).toBe('content:etf-explainer-2026-04')
  })

  it('does not URL-encode — keys are storage-internal, not HTTP paths', () => {
    expect(cacheKey('entity', 'with spaces')).toBe('entity:with spaces')
    expect(cacheKey('entity', 'with/slash')).toBe('entity:with/slash')
  })
})

describe('isFresh', () => {
  it('returns false on null', () => {
    expect(isFresh(null)).toBe(false)
  })

  it('returns true when expiresAt is in the future', () => {
    const bundle: CachedBundle<unknown> = { payload: {}, etag: '', expiresAt: Date.now() + 60_000 }
    expect(isFresh(bundle)).toBe(true)
  })

  it('returns false when expiresAt has passed', () => {
    const bundle: CachedBundle<unknown> = { payload: {}, etag: '', expiresAt: Date.now() - 1 }
    expect(isFresh(bundle)).toBe(false)
  })

  it('returns false when expiresAt is exactly now (boundary)', () => {
    const bundle: CachedBundle<unknown> = { payload: {}, etag: '', expiresAt: Date.now() }
    expect(isFresh(bundle)).toBe(false)
  })
})

describe('DEFAULT_CACHE_TTL_MS', () => {
  it('is 5 minutes', () => {
    expect(DEFAULT_CACHE_TTL_MS).toBe(5 * 60 * 1000)
  })
})

class FakeStorage implements CacheStorage {
  store = new Map<string, unknown>()
  removed: string[] = []

  async setItem(key: string, value: unknown) {
    this.store.set(key, value)
  }

  async removeItem(key: string) {
    this.removed.push(key)
    this.store.delete(key)
  }

  async getKeys(base: string) {
    return [...this.store.keys()].filter(k => k.startsWith(base))
  }
}

describe('invalidateEntityCache', () => {
  it('removes the entity-level directive key', async () => {
    const s = new FakeStorage()
    await s.setItem(cacheKey('entity', 'stockfeel'), { foo: 'bar' })
    await invalidateEntityCache(s, 'stockfeel')
    expect(s.removed).toContain('entity:stockfeel')
    expect(s.store.has('entity:stockfeel')).toBe(false)
  })

  it('sweeps every per-content key under the same slug', async () => {
    const s = new FakeStorage()
    await s.setItem(cacheKey('entity', 'stockfeel'), { e: 1 })
    await s.setItem(cacheKey('content', 'stockfeel:etf-explainer'), { c: 1 })
    await s.setItem(cacheKey('content', 'stockfeel:tax-guide-2026'), { c: 2 })
    await s.setItem(cacheKey('content', 'other:thing'), { c: 3 })

    await invalidateEntityCache(s, 'stockfeel')

    expect(s.removed).toContain('entity:stockfeel')
    expect(s.removed).toContain('content:stockfeel:etf-explainer')
    expect(s.removed).toContain('content:stockfeel:tax-guide-2026')
    expect(s.removed).not.toContain('content:other:thing')
    expect(s.store.has('content:other:thing')).toBe(true)
  })

  it('also sweeps every paginated directory variant under the same slug', async () => {
    const s = new FakeStorage()
    await s.setItem(cacheKey('directory', 'stockfeel:p1s100t'), { d: 1 })
    await s.setItem(cacheKey('directory', 'stockfeel:p2s100t'), { d: 2 })
    await s.setItem(cacheKey('directory', 'stockfeel:p1s100tarticle'), { d: 3 })
    await s.setItem(cacheKey('directory', 'other:p1s100t'), { d: 4 })

    await invalidateEntityCache(s, 'stockfeel')

    expect(s.removed).toContain('directory:stockfeel:p1s100t')
    expect(s.removed).toContain('directory:stockfeel:p2s100t')
    expect(s.removed).toContain('directory:stockfeel:p1s100tarticle')
    expect(s.removed).not.toContain('directory:other:p1s100t')
  })

  it('is a no-op when no matching keys exist', async () => {
    const s = new FakeStorage()
    await invalidateEntityCache(s, 'nobody')
    expect(s.removed).toEqual(['entity:nobody'])
  })
})

describe('etagMatches', () => {
  it('matches identical strong tags', () => {
    expect(etagMatches('"abc"', '"abc"')).toBe(true)
  })
  it('matches identical weak tags', () => {
    expect(etagMatches('W/"abc"', 'W/"abc"')).toBe(true)
  })
  it('matches a weak tag against a strong tag with the same opaque value (RFC 7232 §2.3.2 weak compare)', () => {
    expect(etagMatches('W/"abc"', '"abc"')).toBe(true)
    expect(etagMatches('"abc"', 'W/"abc"')).toBe(true)
  })
  it('does not match different values', () => {
    expect(etagMatches('"abc"', '"def"')).toBe(false)
  })
  it('returns false on missing inputs', () => {
    expect(etagMatches('', '"abc"')).toBe(false)
    expect(etagMatches('"abc"', '')).toBe(false)
    expect(etagMatches(undefined, '"abc"')).toBe(false)
    expect(etagMatches(null, null)).toBe(false)
  })
})

describe('respondWithCache', () => {
  it('returns 200 + JSON body with ETag + Cache-Control when no inbound match', async () => {
    const res = respondWithCache('"abc"', { hello: 'world' }, 'public, max-age=60', undefined)
    expect(res.status).toBe(200)
    expect(res.headers.get('etag')).toBe('"abc"')
    expect(res.headers.get('cache-control')).toBe('public, max-age=60')
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ hello: 'world' })
  })

  it('returns 304 with no body when the inbound If-None-Match matches', async () => {
    const res = respondWithCache('"abc"', { hello: 'world' }, 'public, max-age=60', '"abc"')
    expect(res.status).toBe(304)
    expect(res.headers.get('etag')).toBe('"abc"')
    expect(res.headers.get('cache-control')).toBe('public, max-age=60')
    expect(await res.text()).toBe('')
  })

  it('treats W/"abc" inbound and "abc" current as a match (weak compare)', () => {
    const res = respondWithCache('"abc"', {}, 'public, max-age=60', 'W/"abc"')
    expect(res.status).toBe(304)
  })

  it('omits ETag header when the etag is empty', () => {
    const res = respondWithCache('', { x: 1 }, 'public, max-age=60', undefined)
    expect(res.headers.get('etag')).toBeNull()
  })
})

describe('isUpstream4xx', () => {
  it('detects ofetch-style { response: { status: 4xx } }', () => {
    expect(isUpstream4xx({ response: { status: 401 } })).toBe(true)
    expect(isUpstream4xx({ response: { status: 404 } })).toBe(true)
    expect(isUpstream4xx({ response: { status: 499 } })).toBe(true)
  })
  it('detects bare { statusCode: 4xx }', () => {
    expect(isUpstream4xx({ statusCode: 403 })).toBe(true)
  })
  it('returns false for 5xx', () => {
    expect(isUpstream4xx({ response: { status: 502 } })).toBe(false)
    expect(isUpstream4xx({ statusCode: 503 })).toBe(false)
  })
  it('returns false for non-error shapes', () => {
    expect(isUpstream4xx(undefined)).toBe(false)
    expect(isUpstream4xx(null)).toBe(false)
    expect(isUpstream4xx('not-an-object')).toBe(false)
    expect(isUpstream4xx(new Error('network'))).toBe(false)
  })
})

describe('invalidateContentCache', () => {
  it('removes the named content key without touching siblings', async () => {
    const s = new FakeStorage()
    await s.setItem(cacheKey('content', 'stockfeel:a'), 1)
    await s.setItem(cacheKey('content', 'stockfeel:b'), 2)
    await invalidateContentCache(s, 'stockfeel', 'a')
    expect(s.removed).toContain('content:stockfeel:a')
    expect(s.store.has('content:stockfeel:b')).toBe(true)
  })

  it('does not cascade to entity-level key', async () => {
    const s = new FakeStorage()
    await s.setItem(cacheKey('entity', 'stockfeel'), { e: 1 })
    await s.setItem(cacheKey('content', 'stockfeel:a'), 1)
    await invalidateContentCache(s, 'stockfeel', 'a')
    expect(s.store.has('entity:stockfeel')).toBe(true)
  })

  it('sweeps directory variants for the same entity', async () => {
    const s = new FakeStorage()
    await s.setItem(cacheKey('content', 'stockfeel:a'), 1)
    await s.setItem(cacheKey('directory', 'stockfeel:p1s100t'), { d: 1 })
    await s.setItem(cacheKey('directory', 'stockfeel:p2s100t'), { d: 2 })
    await s.setItem(cacheKey('directory', 'other:p1s100t'), { d: 3 })

    await invalidateContentCache(s, 'stockfeel', 'a')

    expect(s.removed).toContain('content:stockfeel:a')
    expect(s.removed).toContain('directory:stockfeel:p1s100t')
    expect(s.removed).toContain('directory:stockfeel:p2s100t')
    expect(s.removed).not.toContain('directory:other:p1s100t')
  })
})
