/**
 * Request Cache Utility
 *
 * Provides request deduplication to prevent multiple concurrent
 * requests for the same data. Supports conditional caching where
 * results are only cached if a condition is met.
 */

/**
 * Result from a fetch operation that indicates whether caching should occur.
 */
export interface FetchResult<T> {
  /** Whether the result should be cached */
  shouldCache: boolean;
  /** The result data */
  data: T;
}

/**
 * Generic request cache that deduplicates concurrent requests.
 * Supports conditional caching where results are only cached
 * if the fetch indicates success (e.g., executor was available).
 */
export class RequestCache<T> {
  private _pendingRequests = new Map<string, Promise<FetchResult<T>>>();
  private _cache = new Map<string, T>();

  /**
   * Get a cached value or execute a request.
   * If a request for the same key is already in progress, waits for that request.
   *
   * The fetcher returns a FetchResult which indicates:
   * - shouldCache: true to cache the result, false to allow retry on next request
   * - data: the actual result data
   *
   * @param key - Cache key
   * @param fetcher - Function to fetch the value if not cached
   * @param useCache - Whether to check cache first (default: true)
   * @returns The cached or fetched value
   */
  async getOrFetch(
    key: string,
    fetcher: () => Promise<FetchResult<T>>,
    useCache = true
  ): Promise<T> {
    // Return cached value if available and caching enabled
    if (useCache && this._cache.has(key)) {
      return this._cache.get(key)!;
    }

    // Wait for pending request if one exists
    if (this._pendingRequests.has(key)) {
      const result = await this._pendingRequests.get(key)!;
      return result.data;
    }

    // Create new request
    const promise = fetcher();
    this._pendingRequests.set(key, promise);

    try {
      const result = await promise;
      // Only cache if fetcher indicates success (e.g., executor was available)
      if (result.shouldCache) {
        this._cache.set(key, result.data);
      }
      return result.data;
    } finally {
      this._pendingRequests.delete(key);
    }
  }

  /**
   * Check if a value is cached.
   */
  has(key: string): boolean {
    return this._cache.has(key);
  }

  /**
   * Get a cached value directly.
   */
  get(key: string): T | undefined {
    return this._cache.get(key);
  }

  /**
   * Set a cached value directly.
   */
  set(key: string, value: T): void {
    this._cache.set(key, value);
  }

  /**
   * Clear all cached values.
   */
  clear(): void {
    this._cache.clear();
    // Note: pending requests will complete but their results won't be cached
  }

  /**
   * Clear a specific cached value.
   */
  delete(key: string): void {
    this._cache.delete(key);
  }

  /**
   * Get the number of pending requests (useful for testing/debugging).
   */
  get pendingCount(): number {
    return this._pendingRequests.size;
  }

  /**
   * Get the number of cached entries.
   */
  get cacheSize(): number {
    return this._cache.size;
  }
}

/**
 * Simple request cache for cases where caching is always desired on success.
 * This is a convenience wrapper around RequestCache for simpler use cases.
 */
export class SimpleRequestCache<T> {
  private _cache = new RequestCache<T>();

  /**
   * Get a cached value or execute a request.
   * Always caches the result if the fetch succeeds.
   *
   * @param key - Cache key
   * @param fetcher - Function to fetch the value if not cached
   * @param useCache - Whether to check cache first (default: true)
   * @returns The cached or fetched value
   */
  async getOrFetch(
    key: string,
    fetcher: () => Promise<T>,
    useCache = true
  ): Promise<T> {
    return this._cache.getOrFetch(
      key,
      async () => {
        const data = await fetcher();
        return { shouldCache: true, data };
      },
      useCache
    );
  }

  /**
   * Check if a value is cached.
   */
  has(key: string): boolean {
    return this._cache.has(key);
  }

  /**
   * Get a cached value directly.
   */
  get(key: string): T | undefined {
    return this._cache.get(key);
  }

  /**
   * Set a cached value directly.
   */
  set(key: string, value: T): void {
    this._cache.set(key, value);
  }

  /**
   * Clear all cached values.
   */
  clear(): void {
    this._cache.clear();
  }

  /**
   * Clear a specific cached value.
   */
  delete(key: string): void {
    this._cache.delete(key);
  }
}
