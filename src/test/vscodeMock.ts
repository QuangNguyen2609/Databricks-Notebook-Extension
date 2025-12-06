import Module from "module";

// Simple vscode runtime mock for unit tests (Mocha).
const originalRequire = Module.prototype.require;

class Uri {
  constructor(public fsPath: string) {}
  static file(fsPath: string) {
    return new Uri(fsPath);
  }
  toString() {
    return `file://${this.fsPath}`;
  }
}

class Position {
  constructor(public line: number, public character: number) {}
}

class Range {
  public start: Position;
  public end: Position;
  constructor(
    start: any,
    startCharacter?: any,
    endLine?: any,
    endCharacter?: any
  ) {
    if (typeof start === "number") {
      this.start = new Position(start, startCharacter ?? 0);
      this.end = new Position(endLine ?? start, endCharacter ?? 0);
    } else {
      this.start = start;
      this.end = startCharacter ?? start;
    }
  }
}

enum NotebookCellKind {
  Code = 1,
  Markup = 2,
}

enum CompletionItemKind {
  Folder = 17,
  Class = 7,
  Field = 5,
}

class CompletionItem {
  public detail?: string;
  public insertText?: any;
  public command?: any;
  constructor(public label: string, public kind: CompletionItemKind) {}
}

enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

class Diagnostic {
  constructor(
    public range: Range,
    public message: string,
    public severity: DiagnosticSeverity = DiagnosticSeverity.Error
  ) {}
  source?: string;
  code?: string | number;
}

class NotebookCellOutputItem {
  constructor(public data: unknown, public mime: string) {}
  static stdout(text: string) {
    return new NotebookCellOutputItem(text, "stdout");
  }
  static text(text: string, mime = "text/plain") {
    return new NotebookCellOutputItem(text, mime);
  }
  static json(data: unknown) {
    return new NotebookCellOutputItem(data, "application/json");
  }
}

class NotebookCellOutput {
  constructor(public items: NotebookCellOutputItem[]) {}
}

class ThemeColor {
  constructor(public id: string) {}
}

class MarkdownString {
  constructor(public value: string) {}
}

const statusBarItems: any[] = [];

const workspaceFolders = [
  { uri: { fsPath: "/workspace", toString: () => "file:///workspace" } },
];

const extensionsStore = new Map<string, any>();

const vscodeMock = {
  Uri,
  Position,
  Range,
  Diagnostic,
  DiagnosticSeverity,
  NotebookCellKind,
  CompletionItemKind,
  CompletionItem,
  NotebookCellOutput,
  NotebookCellOutputItem,
  ThemeColor,
  MarkdownString,
  window: {
    tabGroups: {
      all: [] as any[],
      async close(tab: any) {
        tab.closed = true;
      },
    },
    createStatusBarItem: () => {
      const item: any = {
        text: "",
        tooltip: "",
        backgroundColor: undefined,
        command: undefined,
        showCalled: false,
        show() {
          this.showCalled = true;
        },
        dispose() {
          this.disposed = true;
        },
      };
      statusBarItems.push(item);
      return item;
    },
    showErrorMessage: () => {},
  },
  StatusBarAlignment: { Right: 1 },
  ViewColumn: { Active: 9 },
  commands: {
    async executeCommand() {},
  },
  languages: {
    createDiagnosticCollection: () => {
      const data = new Map<string, any[]>();
      return {
        data,
        set: (uri: any, diags: any[]) =>
          data.set(uri.toString?.() ?? String(uri), diags),
        delete: (uri: any) => data.delete(uri.toString?.() ?? String(uri)),
        clear: () => data.clear(),
      };
    },
    onDidChangeDiagnostics: (_cb: any) => ({ dispose() {} }),
    getDiagnostics: (_uri?: any) => [],
  },
  workspace: {
    workspaceFolders,
    notebookDocuments: [] as any[],
    getConfiguration: (_section?: string) => ({
      get: (_key: string, def: any) => def,
    }),
    onDidChangeConfiguration: (_cb: any) => ({ dispose() {} }),
    onDidOpenNotebookDocument: (_cb: any) => ({ dispose() {} }),
    onDidChangeNotebookDocument: (_cb: any) => ({ dispose() {} }),
    onDidCloseNotebookDocument: (_cb: any) => ({ dispose() {} }),
  },
  extensions: {
    getExtension: (id: string) => extensionsStore.get(id),
  },
};

// Helpers for tests that need to manipulate extensions store
(vscodeMock.extensions as any)._setExtension = (id: string, ext: any) =>
  extensionsStore.set(id, ext);
(vscodeMock.extensions as any)._clear = () => extensionsStore.clear();

Module.prototype.require = function (id: string) {
  if (id === "vscode") {
    return vscodeMock;
  }
  return originalRequire.apply(this, [id]);
};

// Also seed Node's require cache so later overrides still get the mock
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const resolved = (Module as any)._resolveFilename
    ? (Module as any)._resolveFilename("vscode", module)
    : "vscode";
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: vscodeMock,
    children: [],
    paths: [],
  } as any;
} catch {
  // Ignore resolve errors; Module.prototype.require hook above will still work
}

// Exporting for tests that want direct access (optional)
export default vscodeMock;
