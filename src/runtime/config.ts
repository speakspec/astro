// Runtime configuration for @speakspec/astro.
//
// Astro reads env vars from import.meta.env (build-time) for client
// code, and process.env (runtime) for server code. Since AIDP route
// handlers are server-only, we read process.env directly.

export interface SpeakspecConfig {
  entityId: string
  apiKey: string
  webhookSecret: string
  endpoint: string
  siteOrigin: string
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

const DEFAULT_EXCLUDE_PATHS = ['/_astro/', '/api/_aidp/']

export function readConfig(): SpeakspecConfig {
  const env = process.env
  return {
    entityId: env.SPEAKSPEC_ENTITY_ID ?? '',
    apiKey: env.SPEAKSPEC_API_KEY ?? '',
    webhookSecret: env.SPEAKSPEC_WEBHOOK_SECRET ?? '',
    endpoint: env.SPEAKSPEC_ENDPOINT ?? 'https://api.speakspec.com',
    siteOrigin: env.PUBLIC_SPEAKSPEC_SITE_ORIGIN ?? env.PUBLIC_SITE_URL ?? '',
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
