import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DEFAULT_CACHE_CONFIG, buildCacheControl, readConfig } from '../src/runtime/config'

const ENV_KEYS = [
  'SPEAKSPEC_ENTITY_ID',
  'SPEAKSPEC_API_KEY',
  'SPEAKSPEC_WEBHOOK_SECRET',
  'SPEAKSPEC_ENDPOINT',
  'SPEAKSPEC_CACHE_TTL_SEC',
  'SPEAKSPEC_ENTITY_MAX_AGE',
  'SPEAKSPEC_ENTITY_SWR',
  'SPEAKSPEC_CONTENT_MAX_AGE',
  'SPEAKSPEC_CONTENT_SWR',
  'SPEAKSPEC_DIRECTORY_MAX_AGE',
  'SPEAKSPEC_DIRECTORY_SWR',
] as const

let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  for (const k of ENV_KEYS) delete process.env[k]
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('DEFAULT_CACHE_CONFIG', () => {
  it('matches the documented defaults (revocation-friendly)', () => {
    expect(DEFAULT_CACHE_CONFIG).toEqual({
      ttlSec: 300,
      entityMaxAge: 60,
      entitySwr: 300,
      contentMaxAge: 300,
      contentSwr: 600,
      directoryMaxAge: 60,
      directorySwr: 300,
    })
  })
})

describe('buildCacheControl', () => {
  it('emits the canonical Cache-Control format', () => {
    expect(buildCacheControl(60, 300)).toBe('public, max-age=60, stale-while-revalidate=300')
  })
  it('preserves zero', () => {
    expect(buildCacheControl(0, 0)).toBe('public, max-age=0, stale-while-revalidate=0')
  })
})

describe('readConfig — cache section', () => {
  it('falls back to defaults when no env vars set', () => {
    expect(readConfig().cache).toEqual(DEFAULT_CACHE_CONFIG)
  })

  it('reads each cache env var as integer seconds', () => {
    process.env.SPEAKSPEC_CACHE_TTL_SEC = '900'
    process.env.SPEAKSPEC_ENTITY_MAX_AGE = '600'
    process.env.SPEAKSPEC_ENTITY_SWR = '1800'
    process.env.SPEAKSPEC_CONTENT_MAX_AGE = '3600'
    process.env.SPEAKSPEC_CONTENT_SWR = '7200'
    process.env.SPEAKSPEC_DIRECTORY_MAX_AGE = '120'
    process.env.SPEAKSPEC_DIRECTORY_SWR = '600'

    expect(readConfig().cache).toEqual({
      ttlSec: 900,
      entityMaxAge: 600,
      entitySwr: 1800,
      contentMaxAge: 3600,
      contentSwr: 7200,
      directoryMaxAge: 120,
      directorySwr: 600,
    })
  })

  it('treats max-age=0 as a valid (no-cache) value', () => {
    process.env.SPEAKSPEC_ENTITY_MAX_AGE = '0'
    expect(readConfig().cache.entityMaxAge).toBe(0)
  })

  it.each([
    ['negative', '-1'],
    ['fractional', '12.5'],
    ['non-numeric', 'forever'],
    ['hex literal', '0x10'],
    ['scientific notation', '1e3'],
    ['leading plus sign', '+60'],
    ['trailing junk', '60s'],
    ['empty string treated as default', ''],
    ['whitespace-only treated as default', '  '],
  ])('rejects %s value and falls back', (label, badValue) => {
    process.env.SPEAKSPEC_ENTITY_MAX_AGE = badValue
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(readConfig().cache.entityMaxAge).toBe(DEFAULT_CACHE_CONFIG.entityMaxAge)
    if (badValue.trim() !== '') {
      expect(warn).toHaveBeenCalled()
    }
    warn.mockRestore()
  })

  it('rejects values past Number.MAX_SAFE_INTEGER and warns', () => {
    process.env.SPEAKSPEC_ENTITY_MAX_AGE = '99999999999999999999'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(readConfig().cache.entityMaxAge).toBe(DEFAULT_CACHE_CONFIG.entityMaxAge)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('tolerates surrounding whitespace on a valid integer', () => {
    process.env.SPEAKSPEC_ENTITY_MAX_AGE = '  60  '
    expect(readConfig().cache.entityMaxAge).toBe(60)
  })

  it('one bad env var does not poison sibling values', () => {
    process.env.SPEAKSPEC_ENTITY_MAX_AGE = 'bogus'
    process.env.SPEAKSPEC_CONTENT_MAX_AGE = '1800'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cfg = readConfig()
    expect(cfg.cache.entityMaxAge).toBe(DEFAULT_CACHE_CONFIG.entityMaxAge)
    expect(cfg.cache.contentMaxAge).toBe(1800)
    warn.mockRestore()
  })
})
