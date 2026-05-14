# @speakspec/astro

> AIDP 0.3 publishing channel for Astro 5.

An Astro package that turns your site into a first-class AIDP source: publishes the entity directive at `/.well-known/aidp.json`, exposes signed content endpoints + a paginated content directory, injects `<link rel="aidp">` head tags, receives cache-invalidation webhooks, and observes AI-crawler traffic for upload to your dashboard.

Feature-equivalent to [`@speakspec/nuxt`](https://docs.speakspec.com/developer/sdk-nuxt) and [`@speakspec/next`](https://docs.speakspec.com/developer/sdk-next).

## Install

```bash
pnpm add @speakspec/astro
```

## Configure (env vars)

```env
# .env
SPEAKSPEC_ENTITY_ID=your-entity-slug
SPEAKSPEC_API_KEY=aidp_xxxxxxxxxxx
SPEAKSPEC_WEBHOOK_SECRET=...
PUBLIC_SPEAKSPEC_SITE_ORIGIN=https://yoursite.com
SPEAKSPEC_BOT_TRACKING=true
SPEAKSPEC_BOT_UPLOAD=true
```

## Wire the well-known routes

Astro requires `output: 'server'` (or `output: 'hybrid'`) to serve dynamic API routes. Add one route file per AIDP endpoint:

```ts
// src/pages/.well-known/aidp.json.ts
import { aidpEntityRoute } from '@speakspec/astro'
export const GET = aidpEntityRoute()
```

```ts
// src/pages/.well-known/aidp/content/[id].json.ts
import { aidpContentRoute } from '@speakspec/astro'
export const GET = aidpContentRoute()
```

```ts
// src/pages/.well-known/aidp/content/index.ts
import { aidpDirectoryRoute } from '@speakspec/astro'
export const GET = aidpDirectoryRoute()
```

```ts
// src/pages/api/aidp/invalidate.ts  ← NO leading underscore
import { aidpWebhookRoute } from '@speakspec/astro'
export const POST = aidpWebhookRoute()
```

> Astro 5 excludes any path segment starting with `_` from routing
> (treats it as private). Use `api/aidp/...` (no leading underscore).
> The path you register with the SpeakSpec dashboard must match.

```ts
// src/pages/llms.txt.ts  (optional — serves spec §11.3 llms.txt projection)
import { llmsTxtRoute } from '@speakspec/astro'
export const GET = llmsTxtRoute()
```

## Content inline vs directory (v0.4+)

AIDP v0.4 introduces per-type content strategy. The entity owner can decide, per content type, whether content appears:

- **Inline** (`inline`, default): full content envelopes appear inside `/.well-known/aidp.json`'s `content` array
- **Directory** (`directory`): the type is omitted from `aidp.json.content`; AI agents fetch `/.well-known/aidp/content/directory.json` for the index, and `/.well-known/aidp/content/{id}.json` for individual envelopes

The `content_index` field in `aidp.json` declares which types are inlined vs indexed:

```json
{
  "content_index": {
    "url": "https://example.com/.well-known/aidp/content/directory.json",
    "types_inlined": ["faq", "service"],
    "types_indexed": ["article", "event"],
    "total_by_type": { "article": 1240, "event": 387, "faq": 18, "service": 6 },
    "pinned_count": 3,
    "updated_at": "2026-05-12T10:00:00Z"
  }
}
```

The SDK proxies the upstream response transparently—no client code change is needed when an entity owner switches strategy. AI consumers should check `content_index.types_indexed` and pull `directory.json` when needed.

### Pinned content

Any content can be marked `pinned: true`. Pinned content always appears in `aidp.json.content` regardless of the type's strategy, sorted first.

## Wire the bot-detection middleware

```ts
// src/middleware.ts
import { aidpBotMiddleware } from '@speakspec/astro/middleware'
export const onRequest = aidpBotMiddleware()
```

If you already have middleware, sequence them:

```ts
import { sequence } from 'astro:middleware'
import { aidpBotMiddleware } from '@speakspec/astro/middleware'

export const onRequest = sequence(myExisting, aidpBotMiddleware())
```

## Inject HTML link tags

```astro
---
// src/layouts/BaseLayout.astro
import AidpLinks from '@speakspec/astro/components/AidpLinks.astro'
---
<html>
  <head>
    <AidpLinks />
  </head>
  <body><slot /></body>
</html>
```

For per-page binding on article / product / policy pages:

```astro
---
// src/pages/articles/[id].astro
import AidpContent from '@speakspec/astro/components/AidpContent.astro'
const article = await loadArticle(Astro.params.id)
---
<AidpContent contentId={article.id} pathname={`/articles/${article.id}`} />
<article set:html={article.body} />
```

`<AidpContent />` registers the `(path → content_id)` mapping with the SDK so subsequent AI crawler hits get enriched with `content_id`.

## Cache layer

Default in-memory cache. Plug in Redis / fs / etc. at boot:

```ts
// src/server-init.ts (called from astro:server:setup integration)
import { setCacheStore } from '@speakspec/astro'
import { redisStore } from './my-cache'

setCacheStore(redisStore)
```

Any object satisfying:

```ts
interface FullStore {
  getItem<T>(key: string): Promise<T | null>
  setItem(key: string, value: unknown): Promise<void>
  removeItem(key: string): Promise<void>
  getKeys(base: string): Promise<string[]>
}
```

works.

## Cache tuning

The SDK serves three well-known routes with `Cache-Control` headers
tuned for fast revocation propagation. If you have Cloudflare /
CloudFront in front of your site, those headers are what the CDN
respects — so they directly bound how long it takes a revoked fact
to disappear from AI agent answers.

There are two TTLs to think about:

| Layer | What it does | Default | Affects |
|---|---|---|---|
| **SDK internal** | how long the SDK process reuses a fetched bundle before re-fetching from SpeakSpec | 300s | origin load on SpeakSpec |
| **`Cache-Control: max-age`** | how long downstream caches (CDN + AI agents) reuse the response | 60s (entity/directory), 300s (content) | revocation propagation, CDN cost |

**Why entity = 60s but content = 300s by default?** The entity directive (`/.well-known/aidp.json`) is the revocation pivot — when a customer revokes a fact, this is the document AI agents re-fetch first to learn what's still valid. Short `max-age` keeps revocation fast. Per-content envelopes (`/.well-known/aidp/content/[id].json`) are content-addressed: each `updated_at` produces a new signed bundle, so longer caching is safe.

**Setting `max-age=0`** disables CDN caching for that route but does NOT disable `stale-while-revalidate` — the CDN still serves stale within the SWR window while it revalidates. To fully disable caching, set both `*_MAX_AGE=0` and `*_SWR=0`.

The SDK internal TTL is mostly the safety net for missed webhooks —
when an entity is revoked, SpeakSpec sends a webhook that clears the
SDK cache instantly. Downstream `max-age` is the real ceiling on how
quickly AI agents see the revocation.

All values are configurable via env vars (seconds):

```env
# SDK internal cache (default 300)
SPEAKSPEC_CACHE_TTL_SEC=300

# /.well-known/aidp.json (default 60 / 300)
SPEAKSPEC_ENTITY_MAX_AGE=60
SPEAKSPEC_ENTITY_SWR=300

# /.well-known/aidp/content/[id] (default 300 / 600)
SPEAKSPEC_CONTENT_MAX_AGE=300
SPEAKSPEC_CONTENT_SWR=600

# /.well-known/aidp/content (default 60 / 300)
SPEAKSPEC_DIRECTORY_MAX_AGE=60
SPEAKSPEC_DIRECTORY_SWR=300
```

**Trade-off**: longer `max-age` means lower origin/CDN bill but
slower revocation. Worst-case revocation propagation is bounded by
`max-age + stale-while-revalidate`. If you want sub-minute revocation
across Cloudflare, also wire SpeakSpec's webhook to a Cloudflare
purge — out of SDK scope.

## Caveats vs `@speakspec/nuxt`

- **Output mode**: requires Astro `output: 'server'` or `'hybrid'` for API routes to be dynamic. `output: 'static'` (the default) bakes all routes at build time and won't update directives without a rebuild.
- **Multi-instance**: in-memory cache + impression queue are per-process. Customers running on Cloudflare or similar edge platforms should provide a Redis-backed cache via `setCacheStore`.
- **First-hit content_id**: `<AidpContent />` registers on render, so the very first AI crawler hit on a path lands with `content_id=null`. Subsequent hits are enriched.

## Spec & references

- [AIDP 0.3 §4.8 Cryptographic Proof](https://docs.speakspec.com/spec/transport#cryptographic-proof)
- [AIDP 0.3 §8.5–8.13 Transport](https://docs.speakspec.com/spec/transport)
- [Authenticated API](https://docs.speakspec.com/api/authenticated)

## License

MIT
