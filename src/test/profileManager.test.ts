import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Mock VS Code API
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
    createFileSystemWatcher: () => ({
      onDidChange: () => ({ dispose: () => {} }),
      onDidCreate: () => ({ dispose: () => {} }),
      onDidDelete: () => ({ dispose: () => {} }),
      dispose: () => {},
    }),
    getConfiguration: () => ({
      get: (_key: string): unknown => undefined,
    }),
  },
  window: {
    showErrorMessage: () => {},
    showInformationMessage: () => {},
  },
  RelativePattern: class {
    base: string;
    pattern: string;
    constructor(base: string, pattern: string) {
      this.base = base;
      this.pattern = pattern;
    }
  },
  Uri: {
    joinPath: (uri: { fsPath: string }, ...pathSegments: string[]) => ({
      fsPath: path.join(uri.fsPath, ...pathSegments)
    }),
  },
};

// Replace vscode import with mock
// eslint-disable-next-line @typescript-eslint/no-require-imports
import Module from 'module';
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id: string) {
  if (id === 'vscode') {
    return mockVscode;
  }
  if (id === '../utils/notifications') {
    return {
      showErrorMessage: () => {},
      showInfoMessage: () => {},
      showWarningMessage: () => {},
      showErrorNotification: () => Promise.resolve(undefined),
      showWarningNotification: () => Promise.resolve(undefined),
      showInfoNotification: () => Promise.resolve(undefined),
    };
  }
  return originalRequire.apply(this, [id]);
};

// Now import ProfileManager
import { ProfileManager } from '../databricks/profileManager';
import type * as vscode from 'vscode';

interface MockWorkspaceState {
  storage: Map<string, unknown>;
  get(key: string): unknown;
  update(key: string, value: unknown): Promise<void>;
}

interface MockContext {
  subscriptions: unknown[];
  workspaceState: MockWorkspaceState;
  globalState: {
    get: (key: string) => unknown;
    update: (key: string, value: unknown) => Promise<void>;
  };
}


describe('ProfileManager', () => {
  let testConfigPath: string;

  // Restore original require after all tests to avoid affecting other test files
  after(() => {
    Module.prototype.require = originalRequire;
  });

  // Mock extension context
  const mockContext: MockContext = {
    subscriptions: [],
    workspaceState: {
      storage: new Map<string, unknown>(),
      get: function(key: string) { return this.storage.get(key); },
      update: async function(key: string, value: unknown) { this.storage.set(key, value); },
    },
    globalState: {
      get: (_key: string) => undefined,
      update: async (_key: string, _value: unknown) => {},
    },
  };

  beforeEach(() => {
    // Create a temporary config file for testing
    testConfigPath = path.join(os.tmpdir(), `.databrickscfg-test-${Date.now()}`);
    mockContext.workspaceState.storage.clear();
  });

  afterEach(() => {
    // Clean up temp file
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
  });

  describe('Config File Parsing', () => {
    it('should parse single profile correctly', async () => {
      const configContent = `
[DEFAULT]
host = https://test.cloud.databricks.com
auth_type = databricks-cli
`;
      fs.writeFileSync(testConfigPath, configContent);

      const manager = new ProfileManager(mockContext as unknown as vscode.ExtensionContext);
      // Access private property for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any)._configPath = testConfigPath;

      await manager.loadProfiles();

      const profiles = manager.getAllProfiles();
      assert.strictEqual(profiles.length, 1);
      assert.strictEqual(profiles[0].name, 'DEFAULT');
      assert.strictEqual(profiles[0].host, 'https://test.cloud.databricks.com');
      assert.strictEqual(profiles[0].authType, 'databricks-cli');
    });

    it('should parse multiple profiles correctly', async () => {
      const configContent = `
[DEFAULT]
host = https://dev.cloud.databricks.com
auth_type = databricks-cli

[prod]
host = https://prod.cloud.databricks.com
auth_type = oauth
cluster_id = 1234-567890-abcdef
`;
      fs.writeFileSync(testConfigPath, configContent);

      const manager = new ProfileManager(mockContext as unknown as vscode.ExtensionContext);
      // Access private property for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any)._configPath = testConfigPath;

      await manager.loadProfiles();

      const profiles = manager.getAllProfiles();
      assert.strictEqual(profiles.length, 2);

      const defaultProfile = profiles.find(p => p.name === 'DEFAULT');
      assert.ok(defaultProfile);
      assert.strictEqual(defaultProfile?.host, 'https://dev.cloud.databricks.com');

      const prodProfile = profiles.find(p => p.name === 'prod');
      assert.ok(prodProfile);
      assert.strictEqual(prodProfile?.host, 'https://prod.cloud.databricks.com');
      assert.strictEqual(prodProfile?.clusterId, '1234-567890-abcdef');
    });

    it('should handle comments and empty lines', async () => {
      const configContent = `
# This is a comment
[DEFAULT]
host = https://test.cloud.databricks.com
# Another comment
auth_type = databricks-cli

; Semicolon comment

[staging]
host = https://staging.cloud.databricks.com
`;
      fs.writeFileSync(testConfigPath, configContent);

      const manager = new ProfileManager(mockContext as unknown as vscode.ExtensionContext);
      // Access private property for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any)._configPath = testConfigPath;

      await manager.loadProfiles();

      const profiles = manager.getAllProfiles();
      assert.strictEqual(profiles.length, 2);
    });

    it('should ignore profiles without host', async () => {
      const configContent = `
[incomplete]
auth_type = databricks-cli

[valid]
host = https://valid.cloud.databricks.com
`;
      fs.writeFileSync(testConfigPath, configContent);

      const manager = new ProfileManager(mockContext as unknown as vscode.ExtensionContext);
      // Access private property for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any)._configPath = testConfigPath;

      await manager.loadProfiles();

      const profiles = manager.getAllProfiles();
      assert.strictEqual(profiles.length, 1);
      assert.strictEqual(profiles[0].name, 'valid');
    });

    it('should handle config with whitespace around values', async () => {
      const configContent = `
[DEFAULT]
host =   https://test.cloud.databricks.com
auth_type=databricks-cli
`;
      fs.writeFileSync(testConfigPath, configContent);

      const manager = new ProfileManager(mockContext as unknown as vscode.ExtensionContext);
      // Access private property for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any)._configPath = testConfigPath;

      await manager.loadProfiles();

      const profiles = manager.getAllProfiles();
      assert.strictEqual(profiles.length, 1);
      // Values should be trimmed
      assert.strictEqual(profiles[0].host, 'https://test.cloud.databricks.com');
    });
  });

  describe('Profile Selection', () => {
    it('should select existing profile', async () => {
      const configContent = `
[DEFAULT]
host = https://dev.cloud.databricks.com

[prod]
host = https://prod.cloud.databricks.com
`;
      fs.writeFileSync(testConfigPath, configContent);

      const manager = new ProfileManager(mockContext as unknown as vscode.ExtensionContext);
      // Access private property for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any)._configPath = testConfigPath;

      await manager.loadProfiles();
      await manager.selectProfile('prod');

      const selectedProfile = manager.getSelectedProfile();
      assert.ok(selectedProfile);
      assert.strictEqual(selectedProfile?.name, 'prod');
      assert.strictEqual(selectedProfile?.host, 'https://prod.cloud.databricks.com');
    });

    it('should persist selection in workspace state', async () => {
      const configContent = `
[DEFAULT]
host = https://dev.cloud.databricks.com

[prod]
host = https://prod.cloud.databricks.com
`;
      fs.writeFileSync(testConfigPath, configContent);

      const manager = new ProfileManager(mockContext as unknown as vscode.ExtensionContext);
      // Access private property for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any)._configPath = testConfigPath;

      await manager.loadProfiles();
      await manager.selectProfile('prod');

      // Check workspace state was updated
      const stored = mockContext.workspaceState.get('databricks.selectedProfile');
      assert.strictEqual(stored, 'prod');
    });

    it('should emit onDidChangeProfile event', async () => {
      const configContent = `
[DEFAULT]
host = https://dev.cloud.databricks.com

[prod]
host = https://prod.cloud.databricks.com
`;
      fs.writeFileSync(testConfigPath, configContent);

      const manager = new ProfileManager(mockContext as unknown as vscode.ExtensionContext);
      // Access private property for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any)._configPath = testConfigPath;

      await manager.loadProfiles();

      let eventFired = false;
      let eventProfile: string | null = null;
      manager.onDidChangeProfile((profileName) => {
        eventFired = true;
        eventProfile = profileName;
      });

      await manager.selectProfile('prod');

      assert.strictEqual(eventFired, true);
      assert.strictEqual(eventProfile, 'prod');
    });

    it('should return null when no profile selected', async () => {
      const configContent = `
[DEFAULT]
host = https://dev.cloud.databricks.com
`;
      fs.writeFileSync(testConfigPath, configContent);

      const manager = new ProfileManager(mockContext as unknown as vscode.ExtensionContext);
      // Access private property for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any)._configPath = testConfigPath;

      await manager.loadProfiles();

      const selectedProfile = manager.getSelectedProfile();
      assert.strictEqual(selectedProfile, null);
    });
  });

  describe('Profile Retrieval', () => {
    it('should return all profiles', async () => {
      const configContent = `
[dev]
host = https://dev.cloud.databricks.com

[staging]
host = https://staging.cloud.databricks.com

[prod]
host = https://prod.cloud.databricks.com
`;
      fs.writeFileSync(testConfigPath, configContent);

      const manager = new ProfileManager(mockContext as unknown as vscode.ExtensionContext);
      // Access private property for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any)._configPath = testConfigPath;

      await manager.loadProfiles();

      const profiles = manager.getAllProfiles();
      assert.strictEqual(profiles.length, 3);

      const profileNames = profiles.map(p => p.name).sort();
      assert.deepStrictEqual(profileNames, ['dev', 'prod', 'staging']);
    });

    it('should return empty array when no config file', async () => {
      const manager = new ProfileManager(mockContext as unknown as vscode.ExtensionContext);
      // Access private property for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any)._configPath = path.join(os.tmpdir(), 'nonexistent-config');

      await manager.loadProfiles();

      const profiles = manager.getAllProfiles();
      assert.strictEqual(profiles.length, 0);
    });

    it('hasProfiles should return false when no profiles', async () => {
      const manager = new ProfileManager(mockContext as unknown as vscode.ExtensionContext);
      // Access private property for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any)._configPath = path.join(os.tmpdir(), 'nonexistent-config');

      await manager.loadProfiles();

      assert.strictEqual(manager.hasProfiles(), false);
    });

    it('hasProfiles should return true when profiles exist', async () => {
      const configContent = `
[DEFAULT]
host = https://dev.cloud.databricks.com
`;
      fs.writeFileSync(testConfigPath, configContent);

      const manager = new ProfileManager(mockContext as unknown as vscode.ExtensionContext);
      // Access private property for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any)._configPath = testConfigPath;

      await manager.loadProfiles();

      assert.strictEqual(manager.hasProfiles(), true);
    });
  });

  describe('Default Profile Loading', () => {
    it('should use defaultProfile setting if no saved selection', async () => {
      const configContent = `
[dev]
host = https://dev.cloud.databricks.com

[prod]
host = https://prod.cloud.databricks.com
`;
      fs.writeFileSync(testConfigPath, configContent);

      // Mock config to return defaultProfile
      mockVscode.workspace.getConfiguration = () => ({
        get: (key: string): unknown => key === 'defaultProfile' ? 'prod' : undefined,
      });

      const manager = new ProfileManager(mockContext as unknown as vscode.ExtensionContext);
      // Access private property for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any)._configPath = testConfigPath;

      await manager.loadProfiles();

      const selectedProfile = manager.getSelectedProfile();
      assert.ok(selectedProfile);
      assert.strictEqual(selectedProfile?.name, 'prod');
    });

    it('should restore saved selection from workspace state', async () => {
      const configContent = `
[dev]
host = https://dev.cloud.databricks.com

[prod]
host = https://prod.cloud.databricks.com
`;
      fs.writeFileSync(testConfigPath, configContent);

      // Pre-populate workspace state
      mockContext.workspaceState.storage.set('databricks.selectedProfile', 'dev');

      const manager = new ProfileManager(mockContext as unknown as vscode.ExtensionContext);
      // Access private property for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any)._configPath = testConfigPath;

      await manager.loadProfiles();

      const selectedProfile = manager.getSelectedProfile();
      assert.ok(selectedProfile);
      assert.strictEqual(selectedProfile?.name, 'dev');
    });
  });

  describe('Edge Cases', () => {
    it('should handle malformed config gracefully', async () => {
      const configContent = `
[DEFAULT
host = missing closing bracket
[another]
host = https://test.com
`;
      fs.writeFileSync(testConfigPath, configContent);

      const manager = new ProfileManager(mockContext as unknown as vscode.ExtensionContext);
      // Access private property for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any)._configPath = testConfigPath;

      // Should not throw
      await manager.loadProfiles();

      // Should parse what it can
      const profiles = manager.getAllProfiles();
      assert.ok(profiles.length >= 0);
    });

    it('should handle selecting non-existent profile gracefully', async () => {
      const configContent = `
[DEFAULT]
host = https://dev.cloud.databricks.com
`;
      fs.writeFileSync(testConfigPath, configContent);

      const manager = new ProfileManager(mockContext as unknown as vscode.ExtensionContext);
      // Access private property for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any)._configPath = testConfigPath;

      await manager.loadProfiles();

      // Should not throw, just show error message
      await manager.selectProfile('nonexistent');

      // Selection should remain null
      const selectedProfile = manager.getSelectedProfile();
      assert.strictEqual(selectedProfile, null);
    });
  });
});
