// Astro API route factory for POST /api/_aidp/invalidate
//
// Usage:
//   // src/pages/api/_aidp/invalidate.ts
//   import { aidpWebhookRoute } from '@speakspec/astro'
//   export const POST = aidpWebhookRoute()

import type { APIRoute } from 'astro'
import { Buffer } from 'node:buffer'
import { verifyHmacSignature, isTimestampFresh, urnToSlug } from '../utils/hmac-verify'
import {
  invalidateEntityCache,
  invalidateContentCache,
} from '../utils/cache'
import { getCacheStore } from '../cache-store'
import { readConfig } from '../../config'

const MAX_WEBHOOK_BODY_BYTES = 64 * 1024
const VALID_SCOPES = new Set(['entity', 'content'])
const VALID_EVENTS = new Set(['directive.updated'])

interface InvalidationPayload {
  $aidp?: string
  event?: string
  entity_id?: string
  scope?: 'entity' | 'content'
  content_id?: string
  timestamp?: string
}

export function aidpWebhookRoute(): APIRoute {
  return async ({ request }) => {
    const config = readConfig()

    if (!config.webhookSecret) {
      return errorResponse(503, 'AIDP webhook receiver not configured: missing webhookSecret')
    }

    const signature = request.headers.get('x-aidp-signature')
    const timestamp = request.headers.get('x-aidp-timestamp')

    if (!signature || !timestamp) {
      return errorResponse(400, 'missing X-AIDP-Signature or X-AIDP-Timestamp header')
    }

    if (!isTimestampFresh(timestamp)) {
      return errorResponse(401, 'X-AIDP-Timestamp outside ±5 minute window (replay protection)')
    }

    const rawBuffer = Buffer.from(await request.arrayBuffer())
    if (rawBuffer.byteLength === 0) {
      return errorResponse(400, 'empty request body')
    }
    if (rawBuffer.byteLength > MAX_WEBHOOK_BODY_BYTES) {
      return errorResponse(413, `webhook body exceeds ${MAX_WEBHOOK_BODY_BYTES} bytes`)
    }
    const bodyString = rawBuffer.toString('utf8')

    const valid = verifyHmacSignature({
      secret: config.webhookSecret,
      timestamp,
      body: bodyString,
      signature,
    })
    if (!valid) {
      return errorResponse(401, 'X-AIDP-Signature does not match')
    }

    let payload: InvalidationPayload
    try {
      payload = JSON.parse(bodyString)
    }
    catch {
      return errorResponse(400, 'invalid JSON body')
    }

    if (!payload.scope || !payload.entity_id) {
      return errorResponse(400, 'payload missing required fields (scope, entity_id)')
    }
    if (payload.event && !VALID_EVENTS.has(payload.event)) {
      return errorResponse(400, `unsupported event "${payload.event}" (expected one of: ${[...VALID_EVENTS].join(', ')})`)
    }
    if (!VALID_SCOPES.has(payload.scope)) {
      return errorResponse(400, `unsupported scope "${payload.scope}" (expected entity|content)`)
    }
    if (payload.scope === 'content' && !payload.content_id) {
      return errorResponse(400, 'scope=content requires content_id')
    }
    if (payload.timestamp && payload.timestamp !== timestamp) {
      return errorResponse(400, 'body.timestamp does not match X-AIDP-Timestamp header')
    }

    let slug: string
    try {
      slug = urnToSlug(payload.entity_id)
    }
    catch (err) {
      return errorResponse(400, (err as Error).message)
    }
    const store = getCacheStore()

    if (payload.scope === 'entity') {
      await invalidateEntityCache(store, slug)
    }
    else {
      await invalidateContentCache(store, slug, payload.content_id!)
    }

    return new Response(null, { status: 204 })
  }
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { statusCode: status, statusMessage: message } }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
