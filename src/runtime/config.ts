// Runtime configuration for @speakspec/astro.
//
// Astro reads env vars from import.meta.env (build-time) for client
// code, and process.env (runtime) for server code. Since AIDP route
// handlers are server-only, we read process.env directly.

export interface SpeakspecCacheConfig {
  /** SDK-internal cache TTL (seconds) — how long the SDK process
   *  reuses a fetched bundle before re-fetching from SpeakSpec. The
   *  webhook receiver invalidates this cache on directive change, so
   *  this TTL is mostly the safety net for missed webhooks. */
  ttlSec: number
  /** /.well-known/aidp.json `Cache-Control: max-age` (seconds). This
   *  is the floor for revocation propagation through downstream CDN
   *  caches (Cloudflare, CloudFront, etc.). Lower = faster revocation
   *  + more origin load; higher = the opposite. */
  entityMaxAge: number
  /** /.well-known/aidp.json `Cache-Control: stale-while-revalidate`. */
  entitySwr: number
  /** /.well-known/aidp/content/[id] `Cache-Control: max-age`. */
  contentMaxAge: number
  /** /.well-known/aidp/content/[id] `Cache-Control: stale-while-revalidate`. */
  contentSwr: number
  /** /.well-known/aidp/content `Cache-Control: max-age`. */
  directoryMaxAge: number
  /** /.well-known/aidp/content `Cache-Control: stale-while-revalidate`. */
  directorySwr: number
}

export interface SpeakspecConfig {
  entityId: string
  apiKey: string
  webhookSecret: string
  endpoint: string
  siteOrigin: string
  cache: SpeakspecCacheConfig
  botTracking: {
    enabled: boolean
    excludePaths: string[]
    upload: {
      enabled: boolean
      batchSize: number
      flushIntervalMs: number
      maxQueueBytes: number
      onError: 'fallback-stdout' | 'silent'
    }
  }
}

const DEFAULT_EXCLUDE_PATHS = ['/_astro/', '/api/aidp/']

export const DEFAULT_CACHE_CONFIG: SpeakspecCacheConfig = {
  ttlSec: 300,
  entityMaxAge: 60,
  entitySwr: 300,
  contentMaxAge: 300,
  contentSwr: 600,
  directoryMaxAge: 60,
  directorySwr: 300,
}

/** Strict integer-seconds parser. Rejects anything that isn't a plain
 *  decimal digit string ("60"), so quirky `Number()` coercions like
 *  `0x10`, `1e3`, `+60`, or numbers past `Number.MAX_SAFE_INTEGER`
 *  fall back instead of silently producing surprising Cache-Control
 *  values. Empty / unset env vars are treated as "use the default". */
function readPositiveInt(value: string | undefined, fallback: number, label: string): number {
  if (value == null) return fallback
  const trimmed = value.trim()
  if (trimmed === '') return fallback
  if (!/^\d+$/.test(trimmed)) {
    console.warn(`[@speakspec/astro] invalid ${label}=${value}, falling back to ${fallback}`)
    return fallback
  }
  const n = Number(trimmed)
  if (!Number.isSafeInteger(n)) {
    console.warn(`[@speakspec/astro] ${label}=${value} exceeds safe integer range, falling back to ${fallback}`)
    return fallback
  }
  return n
}

export function readConfig(): SpeakspecConfig {
  const env = process.env
  return {
    entityId: env.SPEAKSPEC_ENTITY_ID ?? '',
    apiKey: env.SPEAKSPEC_API_KEY ?? '',
    webhookSecret: env.SPEAKSPEC_WEBHOOK_SECRET ?? '',
    endpoint: env.SPEAKSPEC_ENDPOINT ?? 'https://api.speakspec.com',
    siteOrigin: env.PUBLIC_SPEAKSPEC_SITE_ORIGIN ?? env.PUBLIC_SITE_URL ?? '',
    cache: {
      ttlSec: readPositiveInt(env.SPEAKSPEC_CACHE_TTL_SEC, DEFAULT_CACHE_CONFIG.ttlSec, 'SPEAKSPEC_CACHE_TTL_SEC'),
      entityMaxAge: readPositiveInt(env.SPEAKSPEC_ENTITY_MAX_AGE, DEFAULT_CACHE_CONFIG.entityMaxAge, 'SPEAKSPEC_ENTITY_MAX_AGE'),
      entitySwr: readPositiveInt(env.SPEAKSPEC_ENTITY_SWR, DEFAULT_CACHE_CONFIG.entitySwr, 'SPEAKSPEC_ENTITY_SWR'),
      contentMaxAge: readPositiveInt(env.SPEAKSPEC_CONTENT_MAX_AGE, DEFAULT_CACHE_CONFIG.contentMaxAge, 'SPEAKSPEC_CONTENT_MAX_AGE'),
      contentSwr: readPositiveInt(env.SPEAKSPEC_CONTENT_SWR, DEFAULT_CACHE_CONFIG.contentSwr, 'SPEAKSPEC_CONTENT_SWR'),
      directoryMaxAge: readPositiveInt(env.SPEAKSPEC_DIRECTORY_MAX_AGE, DEFAULT_CACHE_CONFIG.directoryMaxAge, 'SPEAKSPEC_DIRECTORY_MAX_AGE'),
      directorySwr: readPositiveInt(env.SPEAKSPEC_DIRECTORY_SWR, DEFAULT_CACHE_CONFIG.directorySwr, 'SPEAKSPEC_DIRECTORY_SWR'),
    },
    botTracking: {
      enabled: env.SPEAKSPEC_BOT_TRACKING === 'true',
      excludePaths: env.SPEAKSPEC_BOT_EXCLUDE_PATHS
        ? env.SPEAKSPEC_BOT_EXCLUDE_PATHS.split(',').map(s => s.trim()).filter(Boolean)
        : DEFAULT_EXCLUDE_PATHS,
      upload: {
        enabled: env.SPEAKSPEC_BOT_UPLOAD === 'true',
        batchSize: Number(env.SPEAKSPEC_BOT_BATCH_SIZE ?? 50),
        flushIntervalMs: Number(env.SPEAKSPEC_BOT_FLUSH_MS ?? 60_000),
        maxQueueBytes: Number(env.SPEAKSPEC_BOT_QUEUE_BYTES ?? 2 * 1024 * 1024),
        onError: (env.SPEAKSPEC_BOT_ON_ERROR === 'silent' ? 'silent' : 'fallback-stdout'),
      },
    },
  }
}

export function validateEntityId(entityId: string): void {
  if (entityId && !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(entityId)) {
    console.warn(
      `[@speakspec/astro] entityId %o does not match SpeakSpec's slug rule `
      + `(lowercase alphanumerics and hyphens, no leading/trailing hyphen). `
      + `Verify against your SpeakSpec dashboard — pasting the URN form `
      + `(urn:aidp:entity:foo) instead of the bare slug is a common mistake.`,
      entityId,
    )
  }
}

/** Build a `Cache-Control` header value from max-age + swr seconds. */
export function buildCacheControl(maxAge: number, swr: number): string {
  return `public, max-age=${maxAge}, stale-while-revalidate=${swr}`
}
