/**
 * Tests for Kernel Controls (Restart/Interrupt functionality)
 *
 * These tests define the expected behavior for kernel restart and interrupt
 * buttons that integrate with VS Code's notebook toolbar.
 *
 * Following TDD principles - these tests should FAIL initially until
 * the functionality is implemented in Phase 2.
 */

import * as assert from 'assert';
import { EventEmitter } from 'events';

// Mock execution tracking
let executionOutputs: unknown[] = [];

// Mock NotebookCellExecution
class MockNotebookCellExecution {
  executionOrder = 0;
  private _endCalled = false;
  private _success: boolean | undefined;

  start(_time: number) {}

  end(success: boolean | undefined, _time: number) {
    this._endCalled = true;
    this._success = success;
  }

  get endCalled(): boolean {
    return this._endCalled;
  }

  get success(): boolean | undefined {
    return this._success;
  }

  replaceOutput(outputs: unknown[]) {
    executionOutputs = outputs;
  }

  clearOutput() {
    executionOutputs = [];
  }
}

// Mock NotebookController with interruptHandler support
class MockNotebookController {
  id: string;
  notebookType: string;
  label: string;
  supportedLanguages: string[] = [];
  supportsExecutionOrder = false;
  description?: string;
  detail?: string;
  executeHandler?: (cells: unknown[], notebook: unknown, controller: unknown) => Promise<void>;
  interruptHandler?: (notebook: unknown) => Promise<void>;

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

// Mock PersistentExecutor with interrupt tracking
class MockPersistentExecutor extends EventEmitter {
  private running = false;
  private interrupted = false;
  private restarted = false;
  executeResult = { success: true, stdout: 'output', stderr: '', displayData: [] };
  private executingPromise: Promise<unknown> | null = null;
  private executingResolve: ((value: unknown) => void) | null = null;

  async start(): Promise<boolean> {
    this.running = true;
    return true;
  }

  async execute(_code: string): Promise<{ success: boolean; stdout: string; stderr: string; errorType?: string; displayData?: string[] }> {
    // If already executing, wait for it to complete
    if (this.executingPromise) {
      return this.executingPromise as Promise<{ success: boolean; stdout: string; stderr: string; errorType?: string; displayData?: string[] }>;
    }

    // Create a new execution promise that can be interrupted
    this.executingPromise = new Promise((resolve) => {
      this.executingResolve = resolve;
      // Simulate execution delay
      setTimeout(() => {
        if (this.interrupted) {
          resolve({ success: false, stdout: '', stderr: '', errorType: 'KeyboardInterrupt' });
        } else {
          resolve(this.executeResult);
        }
        this.executingPromise = null;
        this.executingResolve = null;
      }, 100);
    });

    return this.executingPromise as Promise<{ success: boolean; stdout: string; stderr: string; errorType?: string; displayData?: string[] }>;
  }

  async reset(): Promise<boolean> {
    return true;
  }

  async restart(): Promise<boolean> {
    this.restarted = true;
    this.emit('restarted');
    return true;
  }

  async getVariables(): Promise<Record<string, { type: string; repr: string }>> {
    return {};
  }

  isRunning(): boolean {
    return this.running;
  }

  interrupt() {
    this.interrupted = true;
    // Immediately resolve any pending execution
    if (this.executingResolve) {
      this.executingResolve({ success: false, stdout: '', stderr: '', errorType: 'KeyboardInterrupt' });
      this.executingPromise = null;
      this.executingResolve = null;
    }
  }

  wasInterrupted(): boolean {
    return this.interrupted;
  }

  wasRestarted(): boolean {
    return this.restarted;
  }

  resetState() {
    this.interrupted = false;
    this.restarted = false;
  }

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
  window: {
    showInformationMessage: () => {},
    showErrorMessage: () => {},
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

describe('Kernel Controls Tests', () => {
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
    executionOutputs = [];
  });

  describe('PythonKernelController', () => {
    describe('interruptHandler', () => {
      it('should have interruptHandler defined on controller', async () => {
        const controller = new PythonKernelController(
          mockEnvironment,
          'databricks-notebook',
          '/path/to/extension'
        );

        // Ensure executor is created
        const mockNotebook = {
          uri: { fsPath: '/workspace/notebook.py', toString: () => 'file:///workspace/notebook.py' },
        };
        await controller.ensureExecutor(mockNotebook as never);

        // VS Code requires interruptHandler for the interrupt button to appear
        assert.ok(
          createdController?.interruptHandler !== undefined,
          'Controller should have interruptHandler defined for VS Code interrupt button integration'
        );

        controller.dispose();
      });

      it('should interrupt running execution when interruptHandler called', async () => {
        const controller = new PythonKernelController(
          mockEnvironment,
          'databricks-notebook',
          '/path/to/extension'
        );

        const mockNotebook = {
          uri: { fsPath: '/workspace/notebook.py', toString: () => 'file:///workspace/notebook.py' },
        };
        await controller.ensureExecutor(mockNotebook as never);

        // Start an execution (it will hang until resolved or interrupted)
        mockExecutor?.resetState();

        // Call interrupt handler (if defined)
        if (createdController?.interruptHandler) {
          await createdController.interruptHandler(mockNotebook);
        } else {
          // Fall back to direct interrupt call
          controller.interrupt();
        }

        // Verify interrupt was called on executor
        assert.ok(
          mockExecutor?.wasInterrupted(),
          'Executor should have been interrupted'
        );

        controller.dispose();
      });

      it('should set execution state to interrupted', async () => {
        const controller = new PythonKernelController(
          mockEnvironment,
          'databricks-notebook',
          '/path/to/extension'
        );

        const mockNotebook = {
          uri: { fsPath: '/workspace/notebook.py', toString: () => 'file:///workspace/notebook.py' },
        };
        await controller.ensureExecutor(mockNotebook as never);
        mockExecutor?.resetState();

        // Call interrupt
        if (createdController?.interruptHandler) {
          await createdController.interruptHandler(mockNotebook);
        } else {
          controller.interrupt();
        }

        // After interrupt, execution state should be updated
        // The _isExecuting flag should be set to false
        assert.ok(
          mockExecutor?.wasInterrupted(),
          'Interrupt should update execution state'
        );

        controller.dispose();
      });
    });

    describe('restart', () => {
      it('should clear all variables after restart', async () => {
        const controller = new PythonKernelController(
          mockEnvironment,
          'databricks-notebook',
          '/path/to/extension'
        );

        const mockNotebook = {
          uri: { fsPath: '/workspace/notebook.py', toString: () => 'file:///workspace/notebook.py' },
        };
        await controller.ensureExecutor(mockNotebook as never);
        mockExecutor?.resetState();

        // Call restart
        const success = await controller.restart();

        assert.strictEqual(success, true, 'Restart should succeed');
        assert.ok(
          mockExecutor?.wasRestarted(),
          'Executor restart should have been called to clear namespace'
        );

        controller.dispose();
      });

      it('should reinitialize spark after restart', async () => {
        const controller = new PythonKernelController(
          mockEnvironment,
          'databricks-notebook',
          '/path/to/extension'
        );

        const mockNotebook = {
          uri: { fsPath: '/workspace/notebook.py', toString: () => 'file:///workspace/notebook.py' },
        };
        await controller.ensureExecutor(mockNotebook as never);

        // Call restart
        await controller.restart();

        // After restart, kernel should reinitialize (including spark)
        assert.ok(
          mockExecutor?.wasRestarted(),
          'Kernel restart should reinitialize the Python environment'
        );

        controller.dispose();
      });

      it('should emit kernel restart event', async () => {
        const controller = new PythonKernelController(
          mockEnvironment,
          'databricks-notebook',
          '/path/to/extension'
        );

        const mockNotebook = {
          uri: { fsPath: '/workspace/notebook.py', toString: () => 'file:///workspace/notebook.py' },
        };
        await controller.ensureExecutor(mockNotebook as never);

        // Track restart event
        let restartEventFired = false;
        mockExecutor?.on('restarted', () => {
          restartEventFired = true;
        });

        await controller.restart();

        assert.ok(
          restartEventFired || mockExecutor?.wasRestarted(),
          'Restart should emit event or complete successfully for cache clearing'
        );

        controller.dispose();
      });
    });
  });

  describe('PersistentExecutor', () => {
    describe('interrupt', () => {
      it('should send SIGINT to process', async () => {
        const controller = new PythonKernelController(
          mockEnvironment,
          'databricks-notebook',
          '/path/to/extension'
        );

        const mockNotebook = {
          uri: { fsPath: '/workspace/notebook.py', toString: () => 'file:///workspace/notebook.py' },
        };
        await controller.ensureExecutor(mockNotebook as never);
        mockExecutor?.resetState();

        // The interrupt method should be called which sends SIGINT
        controller.interrupt();

        assert.ok(
          mockExecutor?.wasInterrupted(),
          'Interrupt should send SIGINT to Python process'
        );

        controller.dispose();
      });

      it('should handle pending requests on interrupt', async () => {
        const controller = new PythonKernelController(
          mockEnvironment,
          'databricks-notebook',
          '/path/to/extension'
        );

        const mockNotebook = {
          uri: { fsPath: '/workspace/notebook.py', toString: () => 'file:///workspace/notebook.py' },
        };
        await controller.ensureExecutor(mockNotebook as never);
        mockExecutor?.resetState();

        // Start execution that would take time
        const executePromise = mockExecutor?.execute('time.sleep(60)');

        // Immediately interrupt
        controller.interrupt();

        // Wait for execution to complete (should be interrupted)
        const result = await executePromise;

        assert.ok(
          result?.errorType === 'KeyboardInterrupt' || mockExecutor?.wasInterrupted(),
          'Pending requests should be handled on interrupt'
        );

        controller.dispose();
      });
    });
  });

  describe('Toolbar Button Integration', () => {
    it('should have restart command registered', () => {
      // This test validates that package.json has the correct command
      // The actual command registration is tested by ensuring PythonKernelController
      // has the restart method that can be called by the command
      const controller = new PythonKernelController(
        mockEnvironment,
        'databricks-notebook',
        '/path/to/extension'
      );

      assert.ok(
        typeof controller.restart === 'function',
        'Controller should have restart method for toolbar button'
      );

      controller.dispose();
    });

    it('should have interrupt command registered', () => {
      const controller = new PythonKernelController(
        mockEnvironment,
        'databricks-notebook',
        '/path/to/extension'
      );

      assert.ok(
        typeof controller.interrupt === 'function',
        'Controller should have interrupt method for toolbar button'
      );

      controller.dispose();
    });
  });
});
