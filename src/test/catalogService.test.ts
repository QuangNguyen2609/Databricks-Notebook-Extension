import * as assert from "assert";
import { CatalogService } from "../intellisense/catalogService";

class MockExecutor {
  constructor(public running = true, public stdout: string = "[]") {}
  executeCalls = 0;

  isRunning() {
    return this.running;
  }

  async execute(_code: string) {
    this.executeCalls += 1;
    return { success: true, stdout: this.stdout };
  }
}

describe("CatalogService", () => {
  it("does not cache when executor unavailable", async () => {
    const exec = new MockExecutor(false);
    const service = new CatalogService(() => exec as any);

    const first = await service.getCatalogs();
    assert.deepStrictEqual(first, []);
    assert.strictEqual(exec.executeCalls, 0);

    // Now enable executor and ensure fetch happens
    exec.running = true;
    exec.stdout = '[{"name":"main"}]';
    const second = await service.getCatalogs();
    assert.strictEqual(exec.executeCalls, 1);
    assert.deepStrictEqual(second[0].name, "main");

    // Cached result should avoid another execute
    await service.getCatalogs();
    assert.strictEqual(exec.executeCalls, 1);
  });

  it("parses JSON from stdout and supports isCatalog helpers", async () => {
    const exec = new MockExecutor(true, 'junk\n[{"name":"hive_metastore"}]');
    const service = new CatalogService(() => exec as any);

    const catalogs = await service.getCatalogs();
    assert.strictEqual(catalogs.length, 1);
    assert.strictEqual(await service.isCatalog("hive_metastore"), true);
    assert.strictEqual(await service.isCatalog("other"), false);
  });
});
