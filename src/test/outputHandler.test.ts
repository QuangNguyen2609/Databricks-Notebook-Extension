import * as assert from "assert";
import Module from "module";

// Mock vscode API
const mockVscode = (() => {
  class NotebookCellOutput {
    items: any[];
    constructor(items: any[]) {
      this.items = items;
    }
  }

  class NotebookCellOutputItem {
    static stdout(text: string) {
      return { mime: "stdout", text };
    }
    static text(text: string, mime?: string) {
      return { mime: mime || "text/plain", text };
    }
    static json(data: unknown) {
      return { mime: "application/json", data };
    }
  }

  return {
    NotebookCellOutput,
    NotebookCellOutputItem,
  } as unknown as typeof import("vscode");
})();

// Patch module resolution for vscode
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id: string) {
  if (id === "vscode") {
    return mockVscode;
  }
  return originalRequire.apply(this, [id]);
};

// Clear require cache to ensure fresh module load with our mock
const outputHandlerPath = require.resolve("../utils/outputHandler");
delete require.cache[outputHandlerPath];

import { OutputHandler } from "../utils/outputHandler";
import { ExecutionResult } from "../kernels/persistentExecutor";

describe("OutputHandler", () => {
  const handler = new OutputHandler();

  after(() => {
    Module.prototype.require = originalRequire;
    // Clean up cache after tests
    delete require.cache[outputHandlerPath];
  });

  it("converts display data before stdout and stderr", () => {
    const result: ExecutionResult = {
      success: true,
      displayData: ["<div>html</div>"],
      stdout: "hello",
      stderr: "warn",
    } as any;

    const outputs = handler.convertResult(result);
    assert.strictEqual(outputs.length, 3);
    assert.deepStrictEqual(outputs[0].items[0] as any, {
      mime: "text/html",
      text: "<div>html</div>",
    });
    assert.strictEqual((outputs[1].items[0] as any).mime, "stdout");
    assert.strictEqual((outputs[2].items[0] as any).mime, "text/plain");
    assert.strictEqual((outputs[2].items[0] as any).text, "warn");
  });

  it("creates error output with line information", () => {
    const result: ExecutionResult = {
      success: false,
      error: "Boom",
      errorType: "ValueError",
      lineNumber: 12,
    } as any;

    const outputs = handler.convertResult(result);
    assert.strictEqual(outputs.length, 1);
    assert.strictEqual(
      (outputs[0].items[0] as any).text,
      "ValueError: Boom\n    at <cell>:12"
    );
    assert.strictEqual((outputs[0].items[0] as any).mime, "text/plain");
  });

  it("creates json output helper", () => {
    const out = handler.createJsonOutput({ a: 1 });
    assert.strictEqual(out.items[0].mime, "application/json");
    assert.deepStrictEqual(out.items[0].data, { a: 1 });
  });
});
