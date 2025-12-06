import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { showErrorMessage } from '../utils/notifications';

export interface DatabricksProfile {
  name: string;
  host: string;
  authType?: string;
  clusterId?: string;
}

export class ProfileManager implements vscode.Disposable {
  private _profiles: Map<string, DatabricksProfile> = new Map();
  private _selectedProfileName: string | null = null;
  private _configPath: string;
  private _fileWatcher: vscode.FileSystemWatcher | null = null;
  private _context: vscode.ExtensionContext;

  private _onDidChangeProfile = new vscode.EventEmitter<string | null>();
  readonly onDidChangeProfile = this._onDidChangeProfile.event;

  private _onDidChangeProfiles = new vscode.EventEmitter<void>();
  readonly onDidChangeProfiles = this._onDidChangeProfiles.event;

  constructor(context: vscode.ExtensionContext) {
    this._context = context;
    this._configPath = path.join(os.homedir(), '.databrickscfg');

    // Set up file watcher for config file changes
    this.setupFileWatcher();
  }

  private setupFileWatcher(): void {
    try {
      const configDir = path.dirname(this._configPath);
      this._fileWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(configDir, '.databrickscfg')
      );

      this._fileWatcher.onDidChange(async () => {
        try {
          await this.loadProfiles();
        } catch (error) {
          console.error('Failed to reload profiles on file change:', error);
        }
      });

      this._fileWatcher.onDidCreate(async () => {
        try {
          await this.loadProfiles();
        } catch (error) {
          console.error('Failed to load profiles on file creation:', error);
        }
      });

      this._fileWatcher.onDidDelete(() => {
        this._profiles.clear();
        this._onDidChangeProfiles.fire();
      });
    } catch (error) {
      console.error('Failed to set up file watcher:', error);
    }
  }

  async loadProfiles(): Promise<void> {
    this._profiles.clear();

    try {
      const content = await fs.promises.readFile(this._configPath, 'utf-8');
      this.parseConfigFile(content);

      // Load persisted profile selection
      const savedProfile = this._context.workspaceState.get<string>('databricks.selectedProfile');
      if (savedProfile && this._profiles.has(savedProfile)) {
        this._selectedProfileName = savedProfile;
      } else {
        // Check for default profile from settings
        const config = vscode.workspace.getConfiguration('databricks-notebook');
        const defaultProfile = config.get<string>('defaultProfile');
        if (defaultProfile && this._profiles.has(defaultProfile)) {
          this._selectedProfileName = defaultProfile;
        } else {
          this._selectedProfileName = null;
        }
      }

      this._onDidChangeProfiles.fire();
    } catch (error) {
      // Handle ENOENT (file doesn't exist) gracefully
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this._onDidChangeProfiles.fire();
        return;
      }
      console.error('Failed to load Databricks profiles:', error);
      showErrorMessage(`Failed to load Databricks profiles: ${error}`);
    }
  }

  private parseConfigFile(content: string): void {
    const lines = content.split('\n');
    let currentProfile: string | null = null;
    let currentProfileData: Partial<DatabricksProfile> = {};

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
        continue;
      }

      // Check for profile section header [PROFILE_NAME]
      const profileMatch = trimmed.match(/^\[(.+)\]$/);
      if (profileMatch) {
        // Save previous profile if exists
        if (currentProfile && currentProfileData.host) {
          this._profiles.set(currentProfile, {
            name: currentProfile,
            host: currentProfileData.host,
            authType: currentProfileData.authType,
            clusterId: currentProfileData.clusterId,
          });
        }

        // Start new profile
        currentProfile = profileMatch[1];
        currentProfileData = {};
        continue;
      }

      // Parse key-value pairs
      const keyValueMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
      if (keyValueMatch && currentProfile) {
        const [, key, value] = keyValueMatch;
        const cleanValue = value.trim();

        switch (key.toLowerCase()) {
          case 'host':
            currentProfileData.host = cleanValue;
            break;
          case 'auth_type':
            currentProfileData.authType = cleanValue;
            break;
          case 'cluster_id':
            currentProfileData.clusterId = cleanValue;
            break;
        }
      }
    }

    // Save last profile
    if (currentProfile && currentProfileData.host) {
      this._profiles.set(currentProfile, {
        name: currentProfile,
        host: currentProfileData.host,
        authType: currentProfileData.authType,
        clusterId: currentProfileData.clusterId,
      });
    }
  }

  async selectProfile(profileName: string): Promise<void> {
    if (!this._profiles.has(profileName)) {
      showErrorMessage(`Profile "${profileName}" not found`);
      return;
    }

    this._selectedProfileName = profileName;

    // Persist selection in workspace state
    await this._context.workspaceState.update('databricks.selectedProfile', profileName);

    // Emit change event - KernelManager will show notification about kernel restart
    this._onDidChangeProfile.fire(profileName);
  }

  getSelectedProfile(): DatabricksProfile | null {
    if (!this._selectedProfileName) {
      return null;
    }
    return this._profiles.get(this._selectedProfileName) || null;
  }

  getSelectedProfileName(): string | null {
    return this._selectedProfileName;
  }

  getAllProfiles(): DatabricksProfile[] {
    return Array.from(this._profiles.values());
  }

  hasProfiles(): boolean {
    return this._profiles.size > 0;
  }

  dispose(): void {
    this._fileWatcher?.dispose();
    this._onDidChangeProfile.dispose();
    this._onDidChangeProfiles.dispose();
  }
}
