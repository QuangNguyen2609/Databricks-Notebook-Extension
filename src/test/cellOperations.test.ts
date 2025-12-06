import * as assert from "assert";
import Module from "module";

// Track modifyCell invocations
const modifyCalls: any[] = [];

const mockVscode = (() => {
  enum NotebookCellKind {
    Code = 1,
    Markup = 2,
  }
  return {
    NotebookCellKind,
  } as unknown as typeof import("vscode");
})();

// Mock helpers for cellEditor/constants
const mockCellEditor = {
  modifyCell: async (_nb: any, cell: any, transform: any, options: any) => {
    const updated = transform(cell);
    if (options?.trackingSet && options.trackingKey) {
      options.trackingSet.add(options.trackingKey);
    }
    modifyCalls.push({ updated, options });
    // Simulate returning updated cell
    cell.document.text = updated.content;
    cell.metadata = updated.metadata;
    return updated;
  },
  addMagicToContent: (content: string, magic: string) =>
    `${magic} ${content}`.trim(),
  removeMagicFromContent: (content: string, magic: string) =>
    content.replace(magic, "").trim(),
};

const constants = {
  MAGIC_TO_CELL_TYPE: {
    "%sql": "sql",
  },
  LANGUAGE_TO_MAGIC: {
    sql: "%sql",
  },
  contentStartsWithMagic: (content: string, magic: string) =>
    content.trim().startsWith(magic),
};

// Store original require for restoration
const originalRequire = Module.prototype.require;

// Module path for cache clearing
const cellOperationsPath = require.resolve("../utils/cellOperations");

// Cell operations module - loaded dynamically in before() hook
let ensureMagicCommand: any;
let handleNewCell: any;
let removeMagicCommand: any;
let convertToPythonCell: any;
let clearDisableSqlAutoDetectFlag: any;

describe("cellOperations", () => {
  before(() => {
    // Set up mocks BEFORE loading the module
    Module.prototype.require = function (id: string) {
      if (id === "vscode") {
        return mockVscode;
      }
      if (id.endsWith("./cellEditor")) {
        return mockCellEditor;
      }
      if (id.endsWith("../constants")) {
        return constants;
      }
      return originalRequire.apply(this, [id]);
    };

    // Clear cache and load module with mocks
    delete require.cache[cellOperationsPath];
    Object.keys(require.cache).forEach(key => {
      if (key.includes('/cellOperations') || key.includes('/cellEditor')) {
        delete require.cache[key];
      }
    });

    // Load the module with mocks active - use require() to load at runtime
    const cellOps = require("../utils/cellOperations");
    ensureMagicCommand = cellOps.ensureMagicCommand;
    handleNewCell = cellOps.handleNewCell;
    removeMagicCommand = cellOps.removeMagicCommand;
    convertToPythonCell = cellOps.convertToPythonCell;
    clearDisableSqlAutoDetectFlag = cellOps.clearDisableSqlAutoDetectFlag;
  });

  beforeEach(() => {
    modifyCalls.length = 0;
  });

  after(() => {
    // Restore original require
    Module.prototype.require = originalRequire;
    // Clear all cached modules that this test may have affected
    delete require.cache[cellOperationsPath];
    Object.keys(require.cache).forEach(key => {
      if (key.includes('/cellOperations') || key.includes('/cellEditor')) {
        delete require.cache[key];
      }
    });
  });

  const makeCell = (text: string, languageId = "sql") => {
    const document = {
      text,
      languageId,
      uri: { toString: () => "cell://1" },
      getText: () => document.text,
    };
    return {
      document,
      kind: mockVscode.NotebookCellKind.Code,
      metadata: {},
    } as any;
  };

  it("ensures magic command and sets databricksType", async () => {
    const cell = makeCell("select 1");
    const tracking = new Set<string>();
    await ensureMagicCommand({} as any, cell as any, "%sql", "sql", tracking);
    const call = modifyCalls[0];
    assert.ok(call.updated.content.startsWith("%sql"));
    assert.strictEqual(call.updated.metadata.databricksType, "sql");
    assert.ok(tracking.has("cell://1"));
  });

  it("handles new cell by adding magic when missing", async () => {
    const cell = makeCell("select * from t");
    const tracking = new Set<string>();
    await handleNewCell({} as any, cell as any, tracking);
    assert.ok(modifyCalls.length > 0);
  });

  it("removes magic and resets metadata", async () => {
    const cell = makeCell("%sql select 1");
    await removeMagicCommand(
      {} as any,
      cell as any,
      "%sql",
      "python",
      new Set()
    );
    const call = modifyCalls[0];
    assert.strictEqual(call.updated.content.includes("%sql"), false);
    assert.strictEqual(call.updated.metadata.databricksType, "code");
  });

  it("converts to python cell with disableSqlAutoDetect flag", async () => {
    const cell = makeCell("%sql select 1");
    await convertToPythonCell({} as any, cell as any, "print('x')", new Set());
    const call = modifyCalls[0];
    assert.strictEqual(call.updated.languageId, "python");
    assert.strictEqual(call.updated.metadata.disableSqlAutoDetect, true);
  });

  it("clears disableSqlAutoDetect flag", async () => {
    const cell = makeCell("print('x')", "python");
    cell.metadata = { disableSqlAutoDetect: true };
    await clearDisableSqlAutoDetectFlag({} as any, cell as any);
    const call = modifyCalls[0];
    assert.strictEqual(call.updated.metadata.disableSqlAutoDetect, undefined);
  });
});
