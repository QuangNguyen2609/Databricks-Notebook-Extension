/**
 * Tests for PythonKernelController
 *
 * These tests mock the VS Code notebook API and PersistentExecutor
 * to test the controller's behavior.
 */

import * as assert from 'assert';

// Mock execution tracking
let executionStarted = false;
let executionEnded = false;
let executionSuccess = false;
let executionOutputs: unknown[] = [];

// Mock NotebookCellExecution
class MockNotebookCellExecution {
  executionOrder = 0;

  start(_time: number) {
    executionStarted = true;
  }

  end(success: boolean, _time: number) {
    executionEnded = true;
    executionSuccess = success;
  }

  replaceOutput(outputs: unknown[]) {
    executionOutputs = outputs;
  }

  clearOutput() {
    executionOutputs = [];
  }
}

// Mock NotebookController
class MockNotebookController {
  id: string;
  notebookType: string;
  label: string;
  supportedLanguages: string[] = [];
  supportsExecutionOrder = false;
  description?: string;
  detail?: string;
  executeHandler?: (cells: unknown[], notebook: unknown, controller: unknown) => Promise<void>;

  private selectedListeners: Array<(event: { notebook: unknown; selected: boolean }) => void> = [];

  constructor(id: string, notebookType: string, label: string) {
    this.id = id;
    this.notebookType = notebookType;
    this.label = label;
  }

  createNotebookCellExecution(_cell: unknown): MockNotebookCellExecution {
    return new MockNotebookCellExecution();
  }

  onDidChangeSelectedNotebooks(listener: (event: { notebook: unknown; selected: boolean }) => void) {
    this.selectedListeners.push(listener);
    return { dispose: () => {} };
  }

  fireSelectedNotebook(notebook: unknown) {
    this.selectedListeners.forEach(l => l({ notebook, selected: true }));
  }

  dispose() {}
}

// Track created controllers
let createdController: MockNotebookController | null = null;

// Mock PersistentExecutor
class MockPersistentExecutor {
  private running = false;
  executeResult = { success: true, stdout: 'output', stderr: '', displayData: [] };

  async start(): Promise<boolean> {
    this.running = true;
    return true;
  }

  async execute(_code: string): Promise<{ success: boolean; stdout: string; stderr: string; displayData?: string[] }> {
    return this.executeResult;
  }

  async reset(): Promise<boolean> {
    return true;
  }

  async restart(): Promise<boolean> {
    return true;
  }

  async getVariables(): Promise<Record<string, { type: string; repr: string }>> {
    return {};
  }

  isRunning(): boolean {
    return this.running;
  }

  interrupt() {}

  dispose() {
    this.running = false;
  }
}

let mockExecutor: MockPersistentExecutor | null = null;

// Mock OutputHandler
class MockOutputHandler {
  convertResult(_result: { success: boolean; stdout: string; stderr: string; displayData?: string[] }) {
    return [{ items: [{ data: 'output' }] }];
  }

  createInfoOutput(_message: string) {
    return { items: [{ data: 'info' }] };
  }
}

// Mock vscode
const mockVscode = {
  notebooks: {
    createNotebookController: (id: string, notebookType: string, label: string) => {
      createdController = new MockNotebookController(id, notebookType, label);
      return createdController;
    },
  },
  NotebookCellKind: {
    Markup: 1,
    Code: 2,
  },
  NotebookCellOutput: class {
    constructor(public items: unknown[]) {}
  },
  NotebookCellOutputItem: {
    text: (value: string) => ({ data: Buffer.from(value) }),
    error: (error: Error) => ({ data: Buffer.from(error.message) }),
  },
  Uri: {
    joinPath: (uri: { fsPath: string }, ...segments: string[]) => {
      const path = [uri.fsPath, ...segments].join('/');
      return { fsPath: path };
    },
  },
  workspace: {
    getWorkspaceFolder: () => ({ uri: { fsPath: '/workspace' } }),
  },
  Disposable: class {
    static from(...disposables: { dispose: () => void }[]) {
      return { dispose: () => disposables.forEach(d => d.dispose()) };
    }
  },
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
import Module from 'module';

// Clear module cache to ensure fresh mocking works when running with other tests
// This is necessary because mocha runs all tests in the same process
const modulesToClear = [
  '../kernels/pythonKernelController',
  '../kernels/persistentExecutor',
  '../utils/outputHandler',
  '../utils/codeTransform',
];
modulesToClear.forEach(mod => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const resolved = require.resolve(mod);
    delete require.cache[resolved];
  } catch {
    // Module not in cache yet, ignore
  }
});

const originalRequire = Module.prototype.require;
Module.prototype.require = function(id: string) {
  if (id === 'vscode') {
    return mockVscode;
  }
  if (id === './persistentExecutor') {
    return {
      PersistentExecutor: class {
        constructor() {
          mockExecutor = new MockPersistentExecutor();
          return mockExecutor;
        }
      },
    };
  }
  if (id === '../utils/outputHandler') {
    return {
      OutputHandler: MockOutputHandler,
    };
  }
  if (id === '../utils/codeTransform') {
    return {
      wrapSqlCode: (sql: string) => `spark.sql("""${sql}""")`,
      wrapShellCode: (shell: string) => `subprocess.run("""${shell}""")`,
      stripMagicPrefix: (code: string, _prefix: string) => code.replace(/^%\w+\s*/, ''),
    };
  }
  return originalRequire.apply(this, [id]);
};

// Import controller after mocks are set up
import { PythonKernelController } from '../kernels/pythonKernelController';

describe('PythonKernelController Tests', () => {
  const mockEnvironment = {
    id: '/usr/bin/python3',
    path: '/usr/bin/python3',
    displayName: 'Python 3.11.0',
    version: '3.11.0',
    envType: 'system',
  };

  // Restore original require after all tests to avoid affecting other test files
  after(() => {
    Module.prototype.require = originalRequire;
  });

  beforeEach(() => {
    createdController = null;
    mockExecutor = null;
    executionStarted = false;
    executionEnded = false;
    executionSuccess = false;
    executionOutputs = [];
  });

  describe('Constructor', () => {
    it('should create controller with correct ID', () => {
      const controller = new PythonKernelController(
        mockEnvironment,
        'databricks-notebook',
        '/path/to/extension'
      );

      assert.ok(createdController);
      assert.ok(createdController?.id.startsWith('databricks-python-'));
      controller.dispose();
    });

    it('should set supported languages', () => {
      const controller = new PythonKernelController(
        mockEnvironment,
        'databricks-notebook',
        '/path/to/extension'
      );

      assert.ok(createdController?.supportedLanguages.includes('python'));
      assert.ok(createdController?.supportedLanguages.includes('sql'));
      assert.ok(createdController?.supportedLanguages.includes('scala'));
      assert.ok(createdController?.supportedLanguages.includes('r'));
      assert.ok(createdController?.supportedLanguages.includes('shellscript'));
      controller.dispose();
    });

    it('should enable execution order support', () => {
      const controller = new PythonKernelController(
        mockEnvironment,
        'databricks-notebook',
        '/path/to/extension'
      );

      assert.strictEqual(createdController?.supportsExecutionOrder, true);
      controller.dispose();
    });

    it('should set description from version', () => {
      const controller = new PythonKernelController(
        mockEnvironment,
        'databricks-notebook',
        '/path/to/extension'
      );

      assert.ok(createdController?.description?.includes('Python'));
      controller.dispose();
    });

    it('should set detail to Python path', () => {
      const controller = new PythonKernelController(
        mockEnvironment,
        'databricks-notebook',
        '/path/to/extension'
      );

      assert.strictEqual(createdController?.detail, mockEnvironment.path);
      controller.dispose();
    });
  });

  describe('getEnvironment', () => {
    it('should return the environment', () => {
      const controller = new PythonKernelController(
        mockEnvironment,
        'databricks-notebook',
        '/path/to/extension'
      );

      const env = controller.getEnvironment();
      assert.strictEqual(env.id, mockEnvironment.id);
      assert.strictEqual(env.path, mockEnvironment.path);
      controller.dispose();
    });
  });

  describe('getController', () => {
    it('should return the underlying VS Code controller', () => {
      const controller = new PythonKernelController(
        mockEnvironment,
        'databricks-notebook',
        '/path/to/extension'
      );

      const vscodeController = controller.getController();
      assert.ok(vscodeController);
      controller.dispose();
    });
  });

  describe('isRunning', () => {
    it('should return false when executor not created', () => {
      const controller = new PythonKernelController(
        mockEnvironment,
        'databricks-notebook',
        '/path/to/extension'
      );

      assert.strictEqual(controller.isRunning(), false);
      controller.dispose();
    });
  });

  describe('restart', () => {
    it('should return true when no executor', async () => {
      const controller = new PythonKernelController(
        mockEnvironment,
        'databricks-notebook',
        '/path/to/extension'
      );

      const result = await controller.restart();
      assert.strictEqual(result, true);
      controller.dispose();
    });
  });

  describe('resetNamespace', () => {
    it('should return true when no executor', async () => {
      const controller = new PythonKernelController(
        mockEnvironment,
        'databricks-notebook',
        '/path/to/extension'
      );

      const result = await controller.resetNamespace();
      assert.strictEqual(result, true);
      controller.dispose();
    });
  });

  describe('getVariables', () => {
    it('should return empty object when no executor', async () => {
      const controller = new PythonKernelController(
        mockEnvironment,
        'databricks-notebook',
        '/path/to/extension'
      );

      const vars = await controller.getVariables();
      assert.deepStrictEqual(vars, {});
      controller.dispose();
    });
  });

  describe('getExecutor', () => {
    it('should return null when no executor', () => {
      const controller = new PythonKernelController(
        mockEnvironment,
        'databricks-notebook',
        '/path/to/extension'
      );

      assert.strictEqual(controller.getExecutor(), null);
      controller.dispose();
    });
  });

  describe('interrupt', () => {
    it('should not throw when no executor', () => {
      const controller = new PythonKernelController(
        mockEnvironment,
        'databricks-notebook',
        '/path/to/extension'
      );

      // Should not throw
      controller.interrupt();
      controller.dispose();
    });
  });

  describe('ensureExecutor', () => {
    it('should create and start executor', async () => {
      const controller = new PythonKernelController(
        mockEnvironment,
        'databricks-notebook',
        '/path/to/extension'
      );

      const mockNotebook = {
        uri: { fsPath: '/workspace/notebook.py' },
      };

      await controller.ensureExecutor(mockNotebook as never);

      assert.ok(mockExecutor);
      assert.strictEqual(mockExecutor?.isRunning(), true);
      controller.dispose();
    });
  });

  describe('Profile Provider', () => {
    it('should use profile provider when creating executor', async () => {
      let profileRequested = false;
      const profileProvider = () => {
        profileRequested = true;
        return 'test-profile';
      };

      const controller = new PythonKernelController(
        mockEnvironment,
        'databricks-notebook',
        '/path/to/extension',
        profileProvider
      );

      const mockNotebook = {
        uri: { fsPath: '/workspace/notebook.py' },
      };

      await controller.ensureExecutor(mockNotebook as never);

      assert.strictEqual(profileRequested, true);
      controller.dispose();
    });
  });

  describe('Label Generation', () => {
    it('should use displayName when available', () => {
      const controller = new PythonKernelController(
        mockEnvironment,
        'databricks-notebook',
        '/path/to/extension'
      );

      assert.strictEqual(createdController?.label, mockEnvironment.displayName);
      controller.dispose();
    });

    it('should use Python version when no displayName', () => {
      const envWithoutName = {
        ...mockEnvironment,
        displayName: mockEnvironment.path, // displayName equals path
      };

      const controller = new PythonKernelController(
        envWithoutName,
        'databricks-notebook',
        '/path/to/extension'
      );

      assert.ok(createdController?.label.includes('Python'));
      controller.dispose();
    });

    it('should fallback to Python when no version or displayName', () => {
      const minimalEnv = {
        id: '/usr/bin/python3',
        path: '/usr/bin/python3',
        displayName: '/usr/bin/python3',
      };

      const controller = new PythonKernelController(
        minimalEnv,
        'databricks-notebook',
        '/path/to/extension'
      );

      assert.strictEqual(createdController?.label, 'Python');
      controller.dispose();
    });
  });

  describe('Controller ID Sanitization', () => {
    it('should create unique IDs for different paths', () => {
      const env1 = { ...mockEnvironment, id: '/path/one/python' };
      const env2 = { ...mockEnvironment, id: '/path/two/python' };

      const controller1 = new PythonKernelController(
        env1,
        'databricks-notebook',
        '/path/to/extension'
      );
      const id1 = createdController?.id;

      const controller2 = new PythonKernelController(
        env2,
        'databricks-notebook',
        '/path/to/extension'
      );
      const id2 = createdController?.id;

      assert.notStrictEqual(id1, id2);

      controller1.dispose();
      controller2.dispose();
    });

    it('should handle special characters in path', () => {
      const envWithSpecialChars = {
        ...mockEnvironment,
        id: '/path/with spaces/and-dashes/python.exe',
      };

      const controller = new PythonKernelController(
        envWithSpecialChars,
        'databricks-notebook',
        '/path/to/extension'
      );

      // ID should not contain invalid characters
      assert.ok(createdController?.id);
      assert.ok(!createdController?.id.includes(' '));
      controller.dispose();
    });
  });

  describe('dispose', () => {
    it('should dispose executor', async () => {
      const controller = new PythonKernelController(
        mockEnvironment,
        'databricks-notebook',
        '/path/to/extension'
      );

      const mockNotebook = {
        uri: { fsPath: '/workspace/notebook.py' },
      };

      await controller.ensureExecutor(mockNotebook as never);
      assert.ok(mockExecutor?.isRunning());

      controller.dispose();
      // After dispose, executor should be cleaned up
    });

    it('should be safe to call multiple times', () => {
      const controller = new PythonKernelController(
        mockEnvironment,
        'databricks-notebook',
        '/path/to/extension'
      );

      // Should not throw
      controller.dispose();
      controller.dispose();
    });
  });

  describe('onDidChangeSelectedNotebooks', () => {
    it('should start executor when controller is selected', async () => {
      const controller = new PythonKernelController(
        mockEnvironment,
        'databricks-notebook',
        '/path/to/extension'
      );

      const mockNotebook = {
        uri: { fsPath: '/workspace/notebook.py', toString: () => 'file:///workspace/notebook.py' },
      };

      // Fire selection event
      createdController?.fireSelectedNotebook(mockNotebook);

      // Wait for async executor creation
      await new Promise(resolve => setTimeout(resolve, 50));

      // Executor should be created and started
      assert.ok(mockExecutor);
      assert.strictEqual(mockExecutor?.isRunning(), true);

      controller.dispose();
    });
  });
});
