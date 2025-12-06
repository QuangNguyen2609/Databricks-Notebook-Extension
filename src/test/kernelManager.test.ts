/**
 * Tests for the KernelManager
 *
 * These tests mock the Python extension API and VS Code API
 * to test kernel management behavior.
 */

import * as assert from 'assert';

// Mock Python environments
const mockEnvironments = [
  {
    id: '/usr/bin/python3',
    path: '/usr/bin/python3',
    displayName: 'Python 3.11.0',
    version: '3.11.0',
    envType: 'system',
  },
  {
    id: '/home/user/.venv/bin/python',
    path: '/home/user/.venv/bin/python',
    displayName: '.venv',
    version: '3.10.0',
    envType: 'venv',
  },
];

// Mock ProfileManager
class MockProfileManager {
  private listeners: Array<(profile: string | null) => void> = [];
  private selectedProfile: string | null = null;

  onDidChangeProfile(listener: (profile: string | null) => void) {
    this.listeners.push(listener);
    return { dispose: () => {} };
  }

  fireProfileChange(profile: string | null) {
    this.selectedProfile = profile;
    this.listeners.forEach(l => l(profile));
  }

  getSelectedProfileName() {
    return this.selectedProfile;
  }

  getSelectedProfile() {
    return this.selectedProfile ? { name: this.selectedProfile } : null;
  }
}

// Mock PythonExtensionApi
class MockPythonExtensionApi {
  private listeners: Array<() => void> = [];
  private activeListeners: Array<() => void> = [];
  private initialized = false;
  environments = mockEnvironments;

  async initialize(): Promise<boolean> {
    this.initialized = true;
    return true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async getAllEnvironments() {
    return this.environments;
  }

  async getActiveEnvironmentPath() {
    return this.environments[0]?.path;
  }

  async refreshEnvironments() {
    // Simulate refresh
  }

  onDidChangeEnvironments(callback: () => void) {
    this.listeners.push(callback);
    return { dispose: () => {} };
  }

  onDidChangeActiveEnvironment(callback: () => void) {
    this.activeListeners.push(callback);
    return { dispose: () => {} };
  }

  fireEnvironmentChange() {
    this.listeners.forEach(l => l());
  }

  dispose() {
    this.listeners = [];
    this.activeListeners = [];
  }
}

// Mock PythonKernelController
class MockPythonKernelController {
  private env: typeof mockEnvironments[0];
  private _executor: { isRunning: () => boolean; setProfile: (p?: string) => Promise<void>; dispose: () => void } | null = null;
  private running = false;

  constructor(env: typeof mockEnvironments[0]) {
    this.env = env;
  }

  getEnvironment() {
    return this.env;
  }

  isRunning() {
    return this.running;
  }

  setRunning(running: boolean) {
    this.running = running;
  }

  getExecutor() {
    return this._executor;
  }

  clearExecutor() {
    if (this._executor) {
      this._executor.dispose();
      this._executor = null;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async setExecutorProfile(_profileName?: string) {
    // Default implementation - can be overridden in tests
    if (this._executor) {
      await this._executor.setProfile(_profileName);
    }
  }

  async restart() {
    return true;
  }

  interrupt() {}

  dispose() {}
}

let mockPythonApi: MockPythonExtensionApi;
let mockControllers: Map<string, MockPythonKernelController>;

// Mock vscode module
const mockVscode = {
  EventEmitter: class<T> {
    private listeners: Array<(e: T) => void> = [];
    public event = (listener: (e: T) => void) => {
      this.listeners.push(listener);
      return { dispose: () => {} };
    };
    public fire(data: T) {
      this.listeners.forEach(listener => listener(data));
    }
    public dispose() {
      this.listeners = [];
    }
  },
  window: {
    showWarningMessage: () => Promise.resolve(undefined),
    showInformationMessage: () => Promise.resolve(undefined),
    activeNotebookEditor: null as { notebook: { uri: { toString: () => string } } } | null,
  },
  commands: {
    registerCommand: (_id: string, _handler: () => void) => ({ dispose: () => {} }),
  },
  Disposable: class {
    static from(...disposables: { dispose: () => void }[]) {
      return {
        dispose: () => disposables.forEach(d => d.dispose()),
      };
    }
  },
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
import Module from 'module';
const originalRequire = Module.prototype.require;

// Track created controllers
const createdControllers: MockPythonKernelController[] = [];

Module.prototype.require = function(id: string) {
  if (id === 'vscode') {
    return mockVscode;
  }
  if (id === '../utils/pythonExtensionApi') {
    return {
      PythonExtensionApi: class {
        constructor() {
          return mockPythonApi;
        }
      },
    };
  }
  if (id === './pythonKernelController') {
    return {
      PythonKernelController: class {
        constructor(env: typeof mockEnvironments[0]) {
          const controller = new MockPythonKernelController(env);
          createdControllers.push(controller);
          mockControllers.set(env.id, controller);
          return controller;
        }
      },
    };
  }
  return originalRequire.apply(this, [id]);
};

// Import KernelManager after setting up mocks
import { KernelManager } from '../kernels/kernelManager';

describe('KernelManager Tests', () => {
  let mockProfileManager: MockProfileManager;

  beforeEach(() => {
    mockPythonApi = new MockPythonExtensionApi();
    mockProfileManager = new MockProfileManager();
    mockControllers = new Map();
    createdControllers.length = 0;
  });

  afterEach(() => {
    // Clean up
    mockControllers.clear();
  });

  describe('Constructor', () => {
    it('should create KernelManager with extension path', () => {
      const manager = new KernelManager('/path/to/extension');
      assert.ok(manager);
      manager.dispose();
    });

    it('should create KernelManager with profile manager', () => {
      const manager = new KernelManager('/path/to/extension', mockProfileManager as never);
      assert.ok(manager);
      manager.dispose();
    });
  });

  describe('initialize', () => {
    it('should initialize Python API', async () => {
      const manager = new KernelManager('/path/to/extension');

      await manager.initialize();

      assert.strictEqual(mockPythonApi.isInitialized(), true);
      manager.dispose();
    });

    it('should create controllers for discovered environments', async () => {
      const manager = new KernelManager('/path/to/extension');

      await manager.initialize();

      // Should have created controllers for each mock environment
      assert.strictEqual(manager.getControllerCount(), mockEnvironments.length);
      manager.dispose();
    });

    it('should only initialize once', async () => {
      const manager = new KernelManager('/path/to/extension');

      await manager.initialize();
      const count1 = manager.getControllerCount();

      await manager.initialize();
      const count2 = manager.getControllerCount();

      assert.strictEqual(count1, count2);
      manager.dispose();
    });

    it('should handle Python extension not available', async () => {
      // Override initialize to return false
      mockPythonApi.initialize = async () => false;

      const manager = new KernelManager('/path/to/extension');
      await manager.initialize();

      // Should not throw, just warn
      assert.strictEqual(manager.getControllerCount(), 0);
      manager.dispose();
    });
  });

  describe('getControllerCount', () => {
    it('should return 0 before initialization', () => {
      const manager = new KernelManager('/path/to/extension');
      assert.strictEqual(manager.getControllerCount(), 0);
      manager.dispose();
    });

    it('should return correct count after initialization', async () => {
      const manager = new KernelManager('/path/to/extension');
      await manager.initialize();

      assert.strictEqual(manager.getControllerCount(), mockEnvironments.length);
      manager.dispose();
    });
  });

  describe('getEnvironments', () => {
    it('should return empty array before initialization', () => {
      const manager = new KernelManager('/path/to/extension');
      assert.deepStrictEqual(manager.getEnvironments(), []);
      manager.dispose();
    });

    it('should return environments after initialization', async () => {
      const manager = new KernelManager('/path/to/extension');
      await manager.initialize();

      const environments = manager.getEnvironments();
      assert.strictEqual(environments.length, mockEnvironments.length);
      manager.dispose();
    });
  });

  describe('getController', () => {
    it('should return undefined for unknown ID', async () => {
      const manager = new KernelManager('/path/to/extension');
      await manager.initialize();

      const controller = manager.getController('unknown-id');
      assert.strictEqual(controller, undefined);
      manager.dispose();
    });

    it('should return controller by environment ID', async () => {
      const manager = new KernelManager('/path/to/extension');
      await manager.initialize();

      const controller = manager.getController(mockEnvironments[0].id);
      assert.ok(controller);
      manager.dispose();
    });
  });

  describe('getControllerByPath', () => {
    it('should return undefined for unknown path', async () => {
      const manager = new KernelManager('/path/to/extension');
      await manager.initialize();

      const controller = manager.getControllerByPath('/unknown/path');
      assert.strictEqual(controller, undefined);
      manager.dispose();
    });

    it('should return controller by Python path', async () => {
      const manager = new KernelManager('/path/to/extension');
      await manager.initialize();

      const controller = manager.getControllerByPath(mockEnvironments[0].path);
      assert.ok(controller);
      manager.dispose();
    });
  });

  describe('hasRunningKernels', () => {
    it('should return false when no kernels running', async () => {
      const manager = new KernelManager('/path/to/extension');
      await manager.initialize();

      assert.strictEqual(manager.hasRunningKernels(), false);
      manager.dispose();
    });

    it('should return true when a kernel is running', async () => {
      const manager = new KernelManager('/path/to/extension');
      await manager.initialize();

      // Simulate a running kernel
      const controller = mockControllers.get(mockEnvironments[0].id);
      if (controller) {
        controller.setRunning(true);
      }

      assert.strictEqual(manager.hasRunningKernels(), true);
      manager.dispose();
    });
  });

  describe('getActiveExecutor', () => {
    it('should return null when no kernels running', async () => {
      const manager = new KernelManager('/path/to/extension');
      await manager.initialize();

      assert.strictEqual(manager.getActiveExecutor(), null);
      manager.dispose();
    });
  });

  describe('restartAll', () => {
    it('should not throw when no kernels running', async () => {
      const manager = new KernelManager('/path/to/extension');
      await manager.initialize();

      // Should not throw
      await manager.restartAll();
      manager.dispose();
    });

    it('should restart running kernels', async () => {
      const manager = new KernelManager('/path/to/extension');
      await manager.initialize();

      // Simulate a running kernel
      const controller = mockControllers.get(mockEnvironments[0].id);
      if (controller) {
        controller.setRunning(true);
      }

      let restartCalled = false;
      if (controller) {
        controller.restart = async () => {
          restartCalled = true;
          return true;
        };
      }

      await manager.restartAll();

      assert.strictEqual(restartCalled, true);
      manager.dispose();
    });
  });

  describe('Profile Changes', () => {
    it('should handle profile change events', async () => {
      const manager = new KernelManager('/path/to/extension', mockProfileManager as never);
      await manager.initialize();

      // Simulate a running kernel
      const controller = mockControllers.get(mockEnvironments[0].id);
      if (controller) {
        controller.setRunning(true);
      }

      // Track if setExecutorProfile was called via the controller's method
      let setExecutorProfileCalled = false;
      if (controller) {
        controller.setExecutorProfile = async () => {
          setExecutorProfileCalled = true;
        };
      }

      // Fire profile change
      mockProfileManager.fireProfileChange('new-profile');

      // Give time for async handlers
      await new Promise(resolve => setTimeout(resolve, 10));

      assert.strictEqual(setExecutorProfileCalled, true);
      manager.dispose();
    });
  });

  describe('registerCommands', () => {
    it('should register kernel commands', async () => {
      const manager = new KernelManager('/path/to/extension');
      await manager.initialize();

      const registeredCommands: string[] = [];
      mockVscode.commands.registerCommand = (id: string) => {
        registeredCommands.push(id);
        return { dispose: () => {} };
      };

      const mockContext = {
        subscriptions: [] as { dispose: () => void }[],
      };

      manager.registerCommands(mockContext as never);

      assert.ok(registeredCommands.includes('databricks-notebook.restartKernel'));
      assert.ok(registeredCommands.includes('databricks-notebook.interruptKernel'));
      manager.dispose();
    });
  });

  describe('onDidChangeControllers', () => {
    it('should fire when controllers change', async () => {
      const manager = new KernelManager('/path/to/extension');

      let eventFired = false;
      manager.onDidChangeControllers(() => {
        eventFired = true;
      });

      await manager.initialize();

      assert.strictEqual(eventFired, true);
      manager.dispose();
    });
  });

  describe('dispose', () => {
    it('should dispose all controllers', async () => {
      const manager = new KernelManager('/path/to/extension');
      await manager.initialize();

      let disposeCount = 0;
      for (const controller of mockControllers.values()) {
        controller.dispose = () => {
          disposeCount++;
        };
      }

      manager.dispose();

      assert.strictEqual(disposeCount, mockEnvironments.length);
    });

    it('should clear controllers map', async () => {
      const manager = new KernelManager('/path/to/extension');
      await manager.initialize();

      assert.ok(manager.getControllerCount() > 0);

      manager.dispose();

      assert.strictEqual(manager.getControllerCount(), 0);
    });
  });
});
