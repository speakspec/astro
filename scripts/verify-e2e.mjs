// End-to-end verification of @speakspec/astro route handlers + middleware
// against a mock upstream HTTP server. Mirrors aidp-sdk-next/scripts/verify-e2e.mjs.

import { createServer } from 'node:http'
import crypto from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'

const ENTITY_ID = 'verify-fixture'
const API_KEY = 'aidp_verify_fixture_key'
const WEBHOOK_SECRET = 'shh-verify-only'

const fakeDirective = {
  spec_version: '0.3.0',
  entity_id: `urn:aidp:entity:${ENTITY_ID}`,
  entity: { name: 'Verify Fixture Inc.', kind: 'organization' },
  facts: ['Open Tue–Sat 11:30–21:00', 'Established 1987'],
  signature: { algorithm: 'ed25519', value: 'BASE64SIGNATURE==' },
}
const fakeContent = {
  spec_version: '0.3.0',
  content_id: 'fixture-article-1',
  body: { title: 'Hello AIDP', text: 'Body text.' },
  signature: { algorithm: 'ed25519', value: 'BASE64SIGNATURE==' },
}
const fakeDirectory = {
  spec_version: '0.3.0',
  total: 1,
  page: 1,
  per_page: 100,
  items: [{ content_id: 'fixture-article-1', updated_at: '2026-05-10T00:00:00Z' }],
}

const upstreamHits = []

function startUpstream() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      upstreamHits.push({ method: req.method, url: req.url, auth: req.headers.authorization })
      const url = new URL(req.url, `http://localhost`)
      let body = null
      const etag = '"v1"'
      if (url.pathname === `/public/entity/${ENTITY_ID}`) {
        if (req.headers['if-none-match'] === etag) { res.writeHead(304, { etag }); res.end(); return }
        body = fakeDirective
      }
      else if (url.pathname === `/public/entity/${ENTITY_ID}/content/fixture-article-1/publish.json`) body = fakeContent
      else if (url.pathname === `/public/entity/${ENTITY_ID}/content/directory.json`) body = fakeDirectory
      else { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'content-type': 'application/json', etag, 'cache-control': 'public, max-age=300' })
      res.end(JSON.stringify(body))
    })
    server.listen(0, () => resolve({ server, port: server.address().port }))
  })
}

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// Astro APIRoute receives an APIContext object with `request`, `params`, etc.
function makeAstroContext(request, params = {}) {
  return {
    request,
    params,
    url: new URL(request.url),
    site: undefined,
    redirect: () => new Response(null, { status: 302 }),
    cookies: { get: () => undefined, set: () => {}, has: () => false, delete: () => {} },
    locals: {},
    rewrite: () => new Response(null),
    clientAddress: '127.0.0.1',
    generator: 'astro',
    props: {},
    routePattern: '',
    originPathname: new URL(request.url).pathname,
  }
}

async function main() {
  const { server, port } = await startUpstream()
  process.env.SPEAKSPEC_ENTITY_ID = ENTITY_ID
  process.env.SPEAKSPEC_API_KEY = API_KEY
  process.env.SPEAKSPEC_WEBHOOK_SECRET = WEBHOOK_SECRET
  process.env.SPEAKSPEC_ENDPOINT = `http://127.0.0.1:${port}`

  const sdk = await import('../src/index.ts')
  const sdkMiddleware = await import('../src/middleware/index.ts')

  console.log('\n— public exports —')
  check('aidpEntityRoute is a function', typeof sdk.aidpEntityRoute === 'function')
  check('aidpContentRoute is a function', typeof sdk.aidpContentRoute === 'function')
  check('aidpDirectoryRoute is a function', typeof sdk.aidpDirectoryRoute === 'function')
  check('aidpWebhookRoute is a function', typeof sdk.aidpWebhookRoute === 'function')
  check('setCacheStore exported', typeof sdk.setCacheStore === 'function')
  check('verifyBundle exported', typeof sdk.verifyBundle === 'function')
  check('detectAICrawler exported', typeof sdk.detectAICrawler === 'function')
  check('aidpBotMiddleware exported', typeof sdkMiddleware.aidpBotMiddleware === 'function')

  const { setCacheStore } = sdk
  function freshStore() {
    const map = new Map()
    return {
      async getItem(key) { return map.has(key) ? map.get(key) : null },
      async setItem(key, value) { map.set(key, value) },
      async removeItem(key) { map.delete(key) },
      async getKeys(base) { return [...map.keys()].filter((k) => k.startsWith(base)) },
    }
  }

  // 1. Entity
  console.log('\n— aidpEntityRoute() —')
  {
    setCacheStore(freshStore())
    const handler = sdk.aidpEntityRoute()
    const req = new Request('https://yoursite.com/.well-known/aidp.json')
    const ctx = makeAstroContext(req)
    const res = await handler(ctx)
    check('returns Response', res instanceof Response)
    check('status 200', res.status === 200, `got ${res.status}`)
    check('content-type is JSON', (res.headers.get('content-type') ?? '').includes('application/json'))
    check('etag present', !!res.headers.get('etag'), res.headers.get('etag') ?? '(none)')
    check('cache-control present', !!res.headers.get('cache-control'))
    const body = await res.json()
    check('body.entity_id matches', body.entity_id === fakeDirective.entity_id, body.entity_id)
    check('body.signature present', !!body.signature)

    const before = upstreamHits.length
    const res2 = await handler(makeAstroContext(req))
    check('second call status 200', res2.status === 200)
    check('second call did NOT hit upstream', upstreamHits.length === before, `+${upstreamHits.length - before} hits`)

    const etag = res.headers.get('etag') ?? ''
    const reqIfMatch = new Request('https://yoursite.com/.well-known/aidp.json', { headers: { 'if-none-match': etag } })
    const res304 = await handler(makeAstroContext(reqIfMatch))
    check('If-None-Match returns 304', res304.status === 304, `got ${res304.status}`)
  }

  // 2. Content
  console.log('\n— aidpContentRoute() —')
  {
    setCacheStore(freshStore())
    const handler = sdk.aidpContentRoute()
    const req = new Request('https://yoursite.com/.well-known/aidp/content/fixture-article-1.json')
    const ctx = makeAstroContext(req, { id: 'fixture-article-1' })
    const res = await handler(ctx)
    check('returns Response', res instanceof Response)
    check('status 200', res.status === 200, `got ${res.status}`)
    const body = await res.json()
    check('body.content_id matches', body.content_id === fakeContent.content_id, body.content_id)
  }

  // 3. Directory
  console.log('\n— aidpDirectoryRoute() —')
  {
    setCacheStore(freshStore())
    const handler = sdk.aidpDirectoryRoute()
    const req = new Request('https://yoursite.com/.well-known/aidp/content/?page=1&page_size=100')
    const ctx = makeAstroContext(req)
    const res = await handler(ctx)
    check('returns Response', res instanceof Response)
    check('status 200', res.status === 200, `got ${res.status}`)
    const body = await res.json()
    check('body.items is array', Array.isArray(body.items))
    check('body.total numeric', typeof body.total === 'number')
  }

  // 4. Webhook
  console.log('\n— aidpWebhookRoute() —')
  {
    setCacheStore(freshStore())
    const handler = sdk.aidpWebhookRoute()
    const timestamp = new Date().toISOString()
    const body = JSON.stringify({
      $aidp: '0.3.0',
      event: 'directive.updated',
      scope: 'entity',
      entity_id: `urn:aidp:entity:${ENTITY_ID}`,
      timestamp,
    })

    {
      const req = new Request('https://yoursite.com/api/_aidp/invalidate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-aidp-signature': 'hmac-sha256=deadbeef', 'x-aidp-timestamp': timestamp },
        body,
      })
      const res = await handler(makeAstroContext(req))
      check('bad signature returns 4xx', res.status >= 400 && res.status < 500, `got ${res.status}`)
    }
    {
      const sig = 'hmac-sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(timestamp + '\n' + body).digest('hex')
      const req = new Request('https://yoursite.com/api/_aidp/invalidate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-aidp-signature': sig, 'x-aidp-timestamp': timestamp },
        body,
      })
      const res = await handler(makeAstroContext(req))
      check('good signature returns 2xx', res.status >= 200 && res.status < 300, `got ${res.status}`)
    }
  }

  // 5. Bot middleware
  console.log('\n— aidpBotMiddleware() —')
  {
    process.env.SPEAKSPEC_BOT_TRACKING = 'true'
    const mw = sdkMiddleware.aidpBotMiddleware()
    const req = new Request('https://yoursite.com/articles/foo', {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +https://anthropic.com/)' },
    })
    const ctx = makeAstroContext(req)
    let crashed = null
    try {
      const res = await mw(ctx, () => Promise.resolve(new Response('ok')))
      check('middleware returns Response', res instanceof Response)
    }
    catch (e) { crashed = e }
    check('middleware did not throw', !crashed, crashed?.message)
  }

  // 6. .astro components — check the file imports parse without errors
  console.log('\n— Astro components —')
  {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const componentsDir = path.resolve(import.meta.dirname, '../src/components')
    const entries = await fs.readdir(componentsDir)
    check('components dir non-empty', entries.length > 0, entries.join(', '))
    check('AidpLinks.astro exists', entries.includes('AidpLinks.astro'))
    check('AidpContent.astro exists', entries.includes('AidpContent.astro'))
    const aidpLinks = await fs.readFile(path.join(componentsDir, 'AidpLinks.astro'), 'utf8')
    check('AidpLinks.astro has frontmatter', aidpLinks.includes('---'))
    check('AidpLinks.astro emits <link rel="aidp"', aidpLinks.includes('rel="aidp"') || aidpLinks.includes("rel='aidp'"))
  }

  server.close()
  await sleep(50)
  console.log('\n— summary —')
  const passed = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok)
  console.log(`  ${passed}/${results.length} checks passed`)
  if (failed.length > 0) {
    console.log('\n  FAILED:')
    failed.forEach((f) => console.log(`    ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ''}`))
    process.exit(1)
  }
  console.log('\n  All E2E checks pass against mock upstream.')
}

main().catch((err) => { console.error(err); process.exit(1) })
