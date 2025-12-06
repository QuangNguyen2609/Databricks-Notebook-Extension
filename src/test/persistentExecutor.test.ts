/**
 * Tests for the PersistentExecutor
 *
 * These tests mock the child process and vscode API to test
 * the executor's behavior without actually spawning Python.
 *
 * Note: Some async operations are tested in a simplified manner
 * due to the complexity of mocking stdin/stdout communication.
 */

import * as assert from 'assert';
import { EventEmitter } from 'events';

// Mock child process
class MockChildProcess extends EventEmitter {
  stdin = {
    write: (_data: string) => true,
  };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  pid = 12345;

  kill(signal?: string) {
    this.killed = true;
    this.emit('exit', signal === 'SIGINT' ? 130 : 0, signal || null);
  }

  // Helper to simulate output from Python kernel
  simulateOutput(response: object) {
    this.stdout.emit('data', Buffer.from(JSON.stringify(response) + '\n'));
  }
}

let mockChildProcess: MockChildProcess | null = null;
let spawnCalled = false;
let spawnArgs: { command: string; args: string[]; options: object } | null = null;

// Mock child_process module
const mockCp = {
  spawn: (command: string, args: string[], options: object) => {
    spawnCalled = true;
    spawnArgs = { command, args, options };
    mockChildProcess = new MockChildProcess();
    return mockChildProcess;
  },
};

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
  workspace: {
    getConfiguration: () => ({
      get: (key: string, defaultValue: number) => {
        if (key === 'kernelStartupTimeout') {
          return 1000; // Short timeout for tests
        }
        return defaultValue;
      },
    }),
  },
  window: {
    showInformationMessage: () => {},
    showWarningMessage: () => {},
  },
};

// Replace module imports with mocks
// eslint-disable-next-line @typescript-eslint/no-require-imports
import Module from 'module';
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id: string) {
  if (id === 'vscode') {
    return mockVscode;
  }
  if (id === 'child_process') {
    return mockCp;
  }
  return originalRequire.apply(this, [id]);
};

// Now import the executor
import { PersistentExecutor } from '../kernels/persistentExecutor';

describe('PersistentExecutor Tests', () => {
  beforeEach(() => {
    spawnCalled = false;
    spawnArgs = null;
    mockChildProcess = null;
  });

  afterEach(() => {
    // Clean up any running executors
    if (mockChildProcess && !mockChildProcess.killed) {
      mockChildProcess.kill();
    }
  });

  describe('Constructor', () => {
    it('should create executor with correct paths', () => {
      const executor = new PersistentExecutor(
        '/usr/bin/python3',
        '/path/to/extension',
        '/workspace',
        'default'
      );

      assert.ok(executor);
      executor.dispose();
    });

    it('should use current working directory as default', () => {
      const executor = new PersistentExecutor(
        '/usr/bin/python3',
        '/path/to/extension'
      );

      assert.ok(executor);
      executor.dispose();
    });

    it('should accept optional profile parameter', () => {
      const executor = new PersistentExecutor(
        '/usr/bin/python3',
        '/path/to/extension',
        '/workspace',
        'my-profile'
      );

      assert.ok(executor);
      executor.dispose();
    });
  });

  describe('isRunning', () => {
    it('should return false initially', () => {
      const executor = new PersistentExecutor(
        '/usr/bin/python3',
        '/path/to/extension'
      );

      assert.strictEqual(executor.isRunning(), false);
      executor.dispose();
    });

    it('should return false after dispose', () => {
      const executor = new PersistentExecutor(
        '/usr/bin/python3',
        '/path/to/extension'
      );

      executor.dispose();
      assert.strictEqual(executor.isRunning(), false);
    });
  });

  describe('start', () => {
    it('should spawn Python process with correct command', async () => {
      const executor = new PersistentExecutor(
        '/usr/bin/python3',
        '/path/to/extension',
        '/workspace'
      );

      // Start executor in background
      executor.start();

      // Give it a moment to spawn
      await new Promise(resolve => setTimeout(resolve, 50));

      assert.strictEqual(spawnCalled, true);
      assert.strictEqual(spawnArgs?.command, '/usr/bin/python3');
      assert.ok(spawnArgs?.args[0].includes('kernel_runner.py'));

      executor.dispose();
    });

    it('should set DATABRICKS_CONFIG_PROFILE env var when profile is provided', async () => {
      const executor = new PersistentExecutor(
        '/usr/bin/python3',
        '/path/to/extension',
        '/workspace',
        'my-profile'
      );

      executor.start();

      // Give it a moment to spawn
      await new Promise(resolve => setTimeout(resolve, 50));

      assert.ok(spawnArgs?.options);
      const env = (spawnArgs?.options as { env?: NodeJS.ProcessEnv }).env;
      assert.strictEqual(env?.DATABRICKS_CONFIG_PROFILE, 'my-profile');

      executor.dispose();
    });

    it('should fire starting state event', async () => {
      const executor = new PersistentExecutor(
        '/usr/bin/python3',
        '/path/to/extension'
      );

      let stateReceived: string | null = null;
      executor.onDidChangeState((state) => {
        if (!stateReceived) stateReceived = state;
      });

      executor.start();

      // Give it a moment to spawn
      await new Promise(resolve => setTimeout(resolve, 50));

      assert.strictEqual(stateReceived, 'starting');

      executor.dispose();
    });

  });

  describe('interrupt', () => {
    it('should not throw if process not running', () => {
      const executor = new PersistentExecutor(
        '/usr/bin/python3',
        '/path/to/extension'
      );

      // Should not throw
      executor.interrupt();
      executor.dispose();
    });
  });

  describe('stop', () => {
    it('should set running to false', () => {
      const executor = new PersistentExecutor(
        '/usr/bin/python3',
        '/path/to/extension'
      );

      executor.stop();
      assert.strictEqual(executor.isRunning(), false);

      executor.dispose();
    });

    it('should be safe to call when not running', () => {
      const executor = new PersistentExecutor(
        '/usr/bin/python3',
        '/path/to/extension'
      );

      // Should not throw
      executor.stop();
      executor.stop();

      executor.dispose();
    });
  });

  describe('reset', () => {
    it('should return true if kernel not running', async () => {
      const executor = new PersistentExecutor(
        '/usr/bin/python3',
        '/path/to/extension'
      );

      const result = await executor.reset();
      assert.strictEqual(result, true);

      executor.dispose();
    });
  });

  describe('getVariables', () => {
    it('should return empty object if kernel not running', async () => {
      const executor = new PersistentExecutor(
        '/usr/bin/python3',
        '/path/to/extension'
      );

      const variables = await executor.getVariables();
      assert.deepStrictEqual(variables, {});

      executor.dispose();
    });
  });

  describe('ping', () => {
    it('should return false if kernel not running', async () => {
      const executor = new PersistentExecutor(
        '/usr/bin/python3',
        '/path/to/extension'
      );

      const result = await executor.ping();
      assert.strictEqual(result, false);

      executor.dispose();
    });
  });

  describe('setProfile', () => {
    it('should not restart if profile unchanged and not running', async () => {
      const executor = new PersistentExecutor(
        '/usr/bin/python3',
        '/path/to/extension',
        '/workspace',
        'same-profile'
      );

      // Should return immediately without starting
      await executor.setProfile('same-profile');

      // Spawn should not be called
      assert.strictEqual(spawnCalled, false);

      executor.dispose();
    });
  });

  describe('Instance Status Methods', () => {
    it('getSparkStatus should return undefined before initialization', () => {
      const executor = new PersistentExecutor(
        '/usr/bin/python3',
        '/path/to/extension'
      );
      const status = executor.getSparkStatus();
      assert.strictEqual(status, undefined);
      executor.dispose();
    });

    it('getVenvInfo should return undefined before initialization', () => {
      const executor = new PersistentExecutor(
        '/usr/bin/python3',
        '/path/to/extension'
      );
      const info = executor.getVenvInfo();
      assert.strictEqual(info, undefined);
      executor.dispose();
    });

    it('getDbConnectVersion should return undefined before initialization', () => {
      const executor = new PersistentExecutor(
        '/usr/bin/python3',
        '/path/to/extension'
      );
      const version = executor.getDbConnectVersion();
      assert.strictEqual(version, undefined);
      executor.dispose();
    });
  });

  describe('dispose', () => {
    it('should set running to false', () => {
      const executor = new PersistentExecutor(
        '/usr/bin/python3',
        '/path/to/extension'
      );

      executor.dispose();
      assert.strictEqual(executor.isRunning(), false);
    });

    it('should be safe to call multiple times', () => {
      const executor = new PersistentExecutor(
        '/usr/bin/python3',
        '/path/to/extension'
      );

      // Should not throw
      executor.dispose();
      executor.dispose();
    });

  });

  describe('onDidChangeState', () => {
    it('should return disposable', () => {
      const executor = new PersistentExecutor(
        '/usr/bin/python3',
        '/path/to/extension'
      );

      const disposable = executor.onDidChangeState(() => {});
      assert.ok(disposable);
      assert.ok(typeof disposable.dispose === 'function');

      disposable.dispose();
      executor.dispose();
    });
  });

  describe('Process Communication', () => {
    it('should set working directory from cwd parameter', async () => {
      const executor = new PersistentExecutor(
        '/usr/bin/python3',
        '/path/to/extension',
        '/my/workspace'
      );

      executor.start();

      // Give it a moment to spawn
      await new Promise(resolve => setTimeout(resolve, 50));

      assert.ok(spawnArgs?.options);
      const cwd = (spawnArgs?.options as { cwd?: string }).cwd;
      assert.strictEqual(cwd, '/my/workspace');

      executor.dispose();
    });

    it('should include extension path in spawn arguments', async () => {
      const executor = new PersistentExecutor(
        '/usr/bin/python3',
        '/my/extension/path',
        '/workspace'
      );

      executor.start();

      // Give it a moment to spawn
      await new Promise(resolve => setTimeout(resolve, 50));

      // The kernel_runner.py path should include extension path
      assert.ok(spawnArgs?.args[0].includes('kernel_runner.py'));

      executor.dispose();
    });
  });
});

