import * as assert from "assert";
import Module from "module";

// Minimal vscode mocks
class MockUri {
  constructor(public value: string) {}
  toString() {
    return this.value;
  }
  static parse(v: string) {
    return new MockUri(v);
  }
}

const mockVscode = (() => {
  class TabInputText {
    constructor(public uri: MockUri) {}
  }
  class TabInputNotebook {
    // notebookType argument to satisfy VS Code typings
    constructor(public uri: MockUri, public notebookType: string) {}
  }
  class TabInputTextDiff {
    constructor(public original: MockUri, public modified: MockUri) {}
  }
  class TabInputNotebookDiff {
    constructor(public original: MockUri, public modified: MockUri) {}
  }

  const tabGroups: any = {
    all: [] as any[],
    close: async (tab: any) => {
      (tab as any).closed = true;
    },
  };

  const commands = {
    executed: [] as any[],
    async executeCommand(command: string, ...args: any[]) {
      commands.executed.push({ command, args });
    },
  };

  return {
    TabInputText,
    TabInputNotebook,
    TabInputTextDiff,
    TabInputNotebookDiff,
    window: {
      tabGroups,
    },
    commands,
    ViewColumn: {
      Active: 9,
    },
    Uri: MockUri,
  } as unknown as typeof import("vscode");
})();

const originalRequire = Module.prototype.require;
Module.prototype.require = function (id: string) {
  if (id === "vscode") {
    return mockVscode;
  }
  return originalRequire.apply(this, [id]);
};

import {
  findTextEditorTab,
  findNotebookTab,
  isInDiffTab,
  replaceTabWithView,
  openAsNotebook,
  openAsText,
} from "../utils/tabManager";

describe("tabManager", () => {
  beforeEach(() => {
    (mockVscode.window.tabGroups.all as any[]).length = 0;
    (mockVscode.commands as any).executed.length = 0;
  });

  after(() => {
    Module.prototype.require = originalRequire;
  });

  it("finds text and notebook tabs", () => {
    const textTab = {
      input: new (mockVscode.TabInputText as any)(
        new MockUri("file://a") as any,
        "default"
      ),
    };
    const nbTab = {
      input: new (mockVscode.TabInputNotebook as any)(
        new MockUri("file://b") as any,
        "databricks-notebook"
      ),
    };
    (mockVscode.window.tabGroups.all as any[]).push({
      tabs: [textTab],
      viewColumn: 1,
    });
    (mockVscode.window.tabGroups.all as any[]).push({
      tabs: [nbTab],
      viewColumn: 2,
    });

    const t = findTextEditorTab("file://a");
    const n = findNotebookTab("file://b");

    assert.strictEqual(t?.tab, textTab);
    assert.strictEqual(t?.viewColumn, 1);
    assert.strictEqual(n?.tab, nbTab);
    assert.strictEqual(n?.viewColumn, 2);
  });

  it("detects diff tabs", () => {
    const diffTab = {
      input: new (mockVscode.TabInputTextDiff as any)(
        new MockUri("file://orig") as any,
        new MockUri("file://mod") as any
      ),
    };
    (mockVscode.window.tabGroups.all as any[]).push({
      tabs: [diffTab],
      viewColumn: 1,
    });
    assert.strictEqual(isInDiffTab("file://orig"), true);
    assert.strictEqual(isInDiffTab("file://mod"), true);
    assert.strictEqual(isInDiffTab("file://other"), false);
  });

  it("replaces tab and opens new view", async () => {
    const tab = {
      input: new (mockVscode.TabInputText as any)(
        new MockUri("file://c") as any,
        "default"
      ),
    };
    (mockVscode.window.tabGroups.all as any[]).push({
      tabs: [tab],
      viewColumn: 3,
    });

    const column = await replaceTabWithView(
      new MockUri("file://c") as any,
      { tab, viewColumn: 3 } as any,
      "custom-view"
    );

    assert.strictEqual((tab as any).closed, true);
    assert.strictEqual(column, 3);
    assert.deepStrictEqual((mockVscode.commands as any).executed[0], {
      command: "vscode.openWith",
      args: [new MockUri("file://c") as any, "custom-view", 3],
    });
  });

  it("openAsNotebook closes text tab", async () => {
    const tab = {
      input: new (mockVscode.TabInputText as any)(
        new MockUri("file://n") as any,
        "default"
      ),
    };
    (mockVscode.window.tabGroups.all as any[]).push({
      tabs: [tab],
      viewColumn: 1,
    });

    await openAsNotebook(new MockUri("file://n") as any);
    assert.strictEqual((tab as any).closed, true);
    assert.strictEqual(
      (mockVscode.commands as any).executed[0].args[1],
      "databricks-notebook"
    );
  });

  it("openAsText closes notebook tab", async () => {
    const tab = {
      input: new (mockVscode.TabInputNotebook as any)(
        new MockUri("file://n") as any,
        "databricks-notebook"
      ),
    };
    (mockVscode.window.tabGroups.all as any[]).push({
      tabs: [tab],
      viewColumn: 2,
    });

    await openAsText(new MockUri("file://n") as any);
    assert.strictEqual((tab as any).closed, true);
    assert.strictEqual(
      (mockVscode.commands as any).executed[0].args[1],
      "default"
    );
  });
});
