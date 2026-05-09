// @speakspec/astro — main entry. Exports the route-handler factories
// and top-level config / cache primitives.

export { aidpEntityRoute } from './runtime/server/routes/well-known-aidp'
export { aidpContentRoute } from './runtime/server/routes/well-known-content'
export { aidpDirectoryRoute } from './runtime/server/routes/well-known-directory'
export { aidpWebhookRoute } from './runtime/server/routes/webhook'

export { setCacheStore, getCacheStore } from './runtime/server/cache-store'
export { readConfig, validateEntityId, type SpeakspecConfig } from './runtime/config'

// Re-export framework-agnostic primitives.
export {
  verifyBundle,
  fetchJwks,
  fetchRevocationList,
  type VerifyResult,
  type VerifyFailReason,
} from './runtime/server/utils/aidp-verify'
export { detectAICrawler, isAICrawler, type CrawlerMatch, type CrawlerSource } from './runtime/server/utils/bot-detect'
export { registerContent, lookupContentId } from './runtime/server/utils/content-registry'
