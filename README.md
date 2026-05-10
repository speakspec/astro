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
