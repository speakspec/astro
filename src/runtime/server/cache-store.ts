// In-memory cache store for SDK runtime. Per-process; customers can
// plug in Redis / fs / etc. via setCacheStore().

import type { CacheStorage } from './utils/cache'

interface FullStore extends CacheStorage {
  setItem: (key: string, value: unknown) => Promise<void>
  getItem: <T = unknown>(key: string) => Promise<T | null>
}

class InMemoryStore implements FullStore {
  private map = new Map<string, unknown>()

  async getItem<T = unknown>(key: string): Promise<T | null> {
    return (this.map.get(key) as T | undefined) ?? null
  }

  async setItem(key: string, value: unknown): Promise<void> {
    this.map.set(key, value)
  }

  async removeItem(key: string): Promise<void> {
    this.map.delete(key)
  }

  async getKeys(base: string): Promise<string[]> {
    return [...this.map.keys()].filter(k => k.startsWith(base))
  }
}

let activeStore: FullStore = new InMemoryStore()

export function getCacheStore(): FullStore {
  return activeStore
}

export function setCacheStore(store: FullStore): void {
  activeStore = store
}

export function resetCacheStoreForTesting(): void {
  activeStore = new InMemoryStore()
}
