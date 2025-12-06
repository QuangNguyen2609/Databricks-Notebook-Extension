/**
 * Tests for the RequestCache and SimpleRequestCache utilities.
 */
import * as assert from "assert";
import {
  RequestCache,
  SimpleRequestCache,
  FetchResult,
} from "../utils/requestCache";

describe("RequestCache", () => {
  it("caches successful fetch results and skips duplicate fetches", async () => {
    const cache = new RequestCache<string>();
    let fetchCalls = 0;

    const fetcher = async (): Promise<FetchResult<string>> => {
      fetchCalls += 1;
      return { shouldCache: true, data: "value-1" };
    };

    const first = await cache.getOrFetch("k", fetcher);
    const second = await cache.getOrFetch("k", fetcher);

    assert.strictEqual(first, "value-1");
    assert.strictEqual(second, "value-1");
    assert.strictEqual(fetchCalls, 1);
    assert.strictEqual(cache.has("k"), true);
    assert.strictEqual(cache.cacheSize, 1);
  });

  it("does not cache when fetcher opts out (shouldCache=false)", async () => {
    const cache = new RequestCache<string>();
    let fetchCalls = 0;

    const fetcher = async (): Promise<FetchResult<string>> => {
      fetchCalls += 1;
      return { shouldCache: false, data: `miss-${fetchCalls}` };
    };

    const first = await cache.getOrFetch("miss", fetcher);
    const second = await cache.getOrFetch("miss", fetcher);

    assert.strictEqual(first, "miss-1");
    assert.strictEqual(second, "miss-2");
    assert.strictEqual(fetchCalls, 2);
    assert.strictEqual(cache.has("miss"), false);
    assert.strictEqual(cache.cacheSize, 0);
  });

  it("deduplicates concurrent requests and caches once", async () => {
    const cache = new RequestCache<string>();
    let fetchCalls = 0;
    let resolveFetch: (result: FetchResult<string>) => void = () => {};

    const fetcher = (): Promise<FetchResult<string>> => {
      fetchCalls += 1;
      return new Promise<FetchResult<string>>((resolve) => {
        resolveFetch = resolve;
      });
    };

    const pending1 = cache.getOrFetch("concurrent", fetcher);
    const pending2 = cache.getOrFetch("concurrent", fetcher);

    assert.strictEqual(fetchCalls, 1);
    assert.strictEqual(cache.pendingCount, 1);

    resolveFetch({ shouldCache: true, data: "from-first" });
    const [first, second] = await Promise.all([pending1, pending2]);

    assert.strictEqual(first, "from-first");
    assert.strictEqual(second, "from-first");
    assert.strictEqual(cache.pendingCount, 0);
    assert.strictEqual(cache.has("concurrent"), true);
    assert.strictEqual(cache.cacheSize, 1);
  });

  it("respects useCache=false to force refresh", async () => {
    const cache = new RequestCache<string>();
    cache.set("force", "cached");
    let fetchCalls = 0;

    const fetcher = async (): Promise<FetchResult<string>> => {
      fetchCalls += 1;
      return { shouldCache: true, data: "fresh" };
    };

    const result = await cache.getOrFetch("force", fetcher, false);

    assert.strictEqual(result, "fresh");
    assert.strictEqual(fetchCalls, 1);
    assert.strictEqual(cache.get("force"), "fresh");
  });

  it("supports delete and clear operations", () => {
    const cache = new RequestCache<number>();
    cache.set("a", 1);
    cache.set("b", 2);

    assert.strictEqual(cache.cacheSize, 2);
    cache.delete("a");
    assert.strictEqual(cache.has("a"), false);
    assert.strictEqual(cache.cacheSize, 1);

    cache.clear();
    assert.strictEqual(cache.cacheSize, 0);
  });
});

describe("SimpleRequestCache", () => {
  it("always caches successful fetches", async () => {
    const cache = new SimpleRequestCache<number>();
    let fetchCalls = 0;

    const fetcher = async (): Promise<number> => {
      fetchCalls += 1;
      return 42;
    };

    const first = await cache.getOrFetch("simple", fetcher);
    const second = await cache.getOrFetch("simple", fetcher);

    assert.strictEqual(first, 42);
    assert.strictEqual(second, 42);
    assert.strictEqual(fetchCalls, 1);
    assert.strictEqual(cache.has("simple"), true);
    assert.strictEqual(cache.get("simple"), 42);
  });

  it("clears and deletes entries", async () => {
    const cache = new SimpleRequestCache<string>();

    await cache.getOrFetch("x", async () => "one");
    cache.set("y", "two");
    assert.strictEqual(cache.has("x"), true);
    assert.strictEqual(cache.has("y"), true);

    cache.delete("x");
    assert.strictEqual(cache.has("x"), false);

    cache.clear();
    assert.strictEqual(cache.has("y"), false);
  });
});
