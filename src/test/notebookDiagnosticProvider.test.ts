import * as assert from "assert";
import Module from "module";

// Module path for cache clearing
const providerModulePath = require.resolve("../linting/notebookDiagnosticProvider");

// ---- vscode mock ----
function createVscodeMock(withWorkspace = true) {
  const listeners: any = {
    onDidChangeConfiguration: [] as any[],
    onDidOpenNotebookDocument: [] as any[],
    onDidChangeNotebookDocument: [] as any[],
    onDidCloseNotebookDocument: [] as any[],
    onDidChangeDiagnostics: [] as any[],
  };

  const diagnosticCollection = {
    data: new Map<string, any[]>(),
    set(uri: any, diags: any[]) {
      this.data.set(uri.toString(), diags);
    },
    delete(uri: any) {
      this.data.delete(uri.toString());
    },
    clear() {
      this.data.clear();
    },
  };

  const workspaceFolders = withWorkspace
    ? [{ uri: { fsPath: "/workspace", toString: () => "file:///workspace" } }]
    : undefined;

  const vscodeMock = {
    workspace: {
      workspaceFolders,
      notebookDocuments: [] as any[],
      getConfiguration: () => ({
        get: (key: string, def: any) => {
          const defaults: any = {
            enabled: true,
            debounceMs: 0,
            includeDatabricksTypes: true,
          };
          return defaults[key.split(".").pop()!] ?? def;
        },
      }),
      onDidChangeConfiguration: (cb: any) => {
        listeners.onDidChangeConfiguration.push(cb);
        return { dispose() {} };
      },
      onDidOpenNotebookDocument: (cb: any) => {
        listeners.onDidOpenNotebookDocument.push(cb);
        return { dispose() {} };
      },
      onDidChangeNotebookDocument: (cb: any) => {
        listeners.onDidChangeNotebookDocument.push(cb);
        return { dispose() {} };
      },
      onDidCloseNotebookDocument: (cb: any) => {
        listeners.onDidCloseNotebookDocument.push(cb);
        return { dispose() {} };
      },
    },
    languages: {
      createDiagnosticCollection: () => diagnosticCollection,
      onDidChangeDiagnostics: (cb: any) => {
        listeners.onDidChangeDiagnostics.push(cb);
        return { dispose() {} };
      },
      getDiagnostics: () => [
        {
          message: "err",
          range: {},
          severity: 0,
        },
      ],
    },
    window: {
      showErrorMessage: () => {},
    },
    Uri: {
      parse: (v: string) => ({
        fsPath: v.replace("file://", ""),
        toString: () => v,
      }),
    },
  } as unknown as typeof import("vscode");

  return { vscodeMock, listeners, diagnosticCollection };
}

// Module patch helper
const originalRequire = Module.prototype.require;

// Helper to clear cache for fresh module load
function clearModuleCache() {
  delete require.cache[providerModulePath];
  // Also clear dependent modules if cached
  Object.keys(require.cache).forEach(key => {
    if (key.includes('linting/')) {
      delete require.cache[key];
    }
  });
}

describe("NotebookDiagnosticProvider", () => {
  afterEach(() => {
    Module.prototype.require = originalRequire;
    clearModuleCache();
  });

  it("throws when no workspace folder is open", () => {
    // Set up mock BEFORE loading the module
    Module.prototype.require = function (id: string) {
      if (id === "vscode") {
        return createVscodeMock(false).vscodeMock;
      }
      if (id.endsWith("./virtualDocumentGenerator")) {
        return { VirtualDocumentGenerator: class {} };
      }
      if (id.endsWith("./diagnosticMapper")) {
        return { DiagnosticMapper: class {} };
      }
      return originalRequire.apply(this, [id]);
    };

    // Clear cache and require fresh
    clearModuleCache();
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const { NotebookDiagnosticProvider } = require("../linting/notebookDiagnosticProvider");

    assert.throws(
      () => new NotebookDiagnosticProvider({ subscriptions: [] } as any)
    );
  });

  it("writes virtual documents during analysis and clears on disposal", async () => {
    const { vscodeMock, diagnosticCollection } = createVscodeMock(true);
    const generator = {
      generateDocument: (_nb: any) => ({
        filePath: "/workspace/.databricks-cache/doc.virtual.py",
        uri: {
          fsPath: "/workspace/.databricks-cache/doc.virtual.py",
          toString: () => "file:///workspace/.databricks-cache/doc.virtual.py",
        },
      }),
      writeVirtualDocument: async () => {
        generator.written = true;
      },
      deleteVirtualDocument: async () => {
        generator.deleted = true;
      },
      written: false,
      deleted: false,
    };
    const mapper = {
      mapDiagnostics: () => new Map([[0, [{ message: "err" }]]]),
      getCellUri: (_nb: any, _idx: number) => ({ toString: () => "cell://0" }),
    };

    // Set up mock BEFORE loading the module
    Module.prototype.require = function (id: string) {
      if (id === "vscode") {
        return vscodeMock;
      }
      if (id.endsWith("./virtualDocumentGenerator")) {
        return {
          VirtualDocumentGenerator: class {
            constructor() {
              return generator as any;
            }
          },
        };
      }
      if (id.endsWith("./diagnosticMapper")) {
        return {
          DiagnosticMapper: class {
            constructor() {
              return mapper as any;
            }
          },
        };
      }
      return originalRequire.apply(this, [id]);
    };

    // Clear cache and require fresh
    clearModuleCache();
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const { NotebookDiagnosticProvider } = require("../linting/notebookDiagnosticProvider");

    const provider = new NotebookDiagnosticProvider({
      subscriptions: [],
    } as any);

    const notebook = {
      notebookType: "databricks-notebook",
      uri: {
        fsPath: "/workspace/nb.dbnb",
        toString: () => "file:///workspace/nb.dbnb",
      },
      cellCount: 0,
      cellAt: () => ({}),
    };

    await provider.analyzeNotebook(notebook as any);
    assert.strictEqual(generator.written, true);
    assert.ok(
      (provider as any).virtualDocuments.has("file:///workspace/nb.dbnb")
    );

    provider.clearDiagnostics(notebook.uri as any);
    assert.strictEqual(generator.deleted, true);

    provider.dispose();
    assert.strictEqual(diagnosticCollection.data.size, 0);
  });
});
