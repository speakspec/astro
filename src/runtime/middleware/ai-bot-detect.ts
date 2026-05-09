// Astro middleware factory for AI crawler detection.
//
// Usage:
//   // src/middleware.ts
//   import { aidpBotMiddleware } from '@speakspec/astro/middleware'
//   export const onRequest = aidpBotMiddleware()
//
// Behavior mirrors the Nuxt SDK:
//   - Off when SPEAKSPEC_BOT_TRACKING !== 'true'
//   - Skips paths under SPEAKSPEC_BOT_EXCLUDE_PATHS
//   - On AI crawler match: emits structured impression
//     - upload.enabled → batched POST to SpeakSpec
//     - otherwise → console.log fallback
//   - Never blocks the request — pass-through observer

import type { MiddlewareHandler } from 'astro'
import { detectAICrawler, isExcludedPath } from '../server/utils/bot-detect'
import { lookupContentId } from '../server/utils/content-registry'
import { configureQueue, enqueueImpression, type ImpressionRecord } from '../server/utils/impression-queue'
import { readConfig } from '../config'

let queueConfigured = false

export function aidpBotMiddleware(): MiddlewareHandler {
  return async (context, next) => {
    const config = readConfig()
    if (!config.botTracking.enabled) {
      return next()
    }

    const path = context.url.pathname
    if (isExcludedPath(path, config.botTracking.excludePaths)) {
      return next()
    }

    const ua = context.request.headers.get('user-agent') ?? ''
    const matched = detectAICrawler(ua)
    if (!matched) {
      return next()
    }

    const impression: ImpressionRecord = {
      msg: 'aidp.crawler_impression',
      crawler: matched.label,
      crawler_source: matched.source,
      path,
      user_agent: ua.slice(0, 256),
      ts: new Date().toISOString(),
    }
    if (config.entityId) impression.entity_id = config.entityId
    const cid = lookupContentId(path)
    if (cid) impression.content_id = cid
    const ip = context.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? context.request.headers.get('x-real-ip')
      ?? undefined
    if (ip) impression.client_ip = ip

    const upload = config.botTracking.upload
    if (upload.enabled && config.entityId && config.apiKey) {
      if (!queueConfigured) {
        configureQueue({
          endpoint: config.endpoint,
          apiKey: config.apiKey,
          batchSize: upload.batchSize,
          flushIntervalMs: upload.flushIntervalMs,
          maxQueueBytes: upload.maxQueueBytes,
          onError: upload.onError,
        })
        queueConfigured = true
      }
      enqueueImpression(impression)
    }
    else {
      console.log(JSON.stringify(impression))
    }

    return next()
  }
}
