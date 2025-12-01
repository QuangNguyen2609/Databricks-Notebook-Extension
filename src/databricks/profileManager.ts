import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface DatabricksProfile {
  name: string;
  host: string;
  authType?: string;
  clusterId?: string;
}

export class ProfileManager implements vscode.Disposable {
  private profiles: Map<string, DatabricksProfile> = new Map();
  private selectedProfileName: string | null = null;
  private configPath: string;
  private fileWatcher: vscode.FileSystemWatcher | null = null;
  private context: vscode.ExtensionContext;

  private _onDidChangeProfile = new vscode.EventEmitter<string | null>();
  readonly onDidChangeProfile = this._onDidChangeProfile.event;

  private _onDidChangeProfiles = new vscode.EventEmitter<void>();
  readonly onDidChangeProfiles = this._onDidChangeProfiles.event;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.configPath = path.join(os.homedir(), '.databrickscfg');

    // Set up file watcher for config file changes
    this.setupFileWatcher();
  }

  private setupFileWatcher(): void {
    try {
      const configDir = path.dirname(this.configPath);
      this.fileWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(configDir, '.databrickscfg')
      );

      this.fileWatcher.onDidChange(() => {
        this.loadProfiles();
      });

      this.fileWatcher.onDidCreate(() => {
        this.loadProfiles();
      });

      this.fileWatcher.onDidDelete(() => {
        this.profiles.clear();
        this._onDidChangeProfiles.fire();
      });
    } catch (error) {
      console.error('Failed to set up file watcher:', error);
    }
  }

  async loadProfiles(): Promise<void> {
    this.profiles.clear();

    if (!fs.existsSync(this.configPath)) {
      this._onDidChangeProfiles.fire();
      return;
    }

    try {
      const content = fs.readFileSync(this.configPath, 'utf-8');
      this.parseConfigFile(content);

      // Load persisted profile selection
      const savedProfile = this.context.workspaceState.get<string>('databricks.selectedProfile');
      if (savedProfile && this.profiles.has(savedProfile)) {
        this.selectedProfileName = savedProfile;
      } else {
        // Check for default profile from settings
        const config = vscode.workspace.getConfiguration('databricks-notebook');
        const defaultProfile = config.get<string>('defaultProfile');
        if (defaultProfile && this.profiles.has(defaultProfile)) {
          this.selectedProfileName = defaultProfile;
        } else {
          this.selectedProfileName = null;
        }
      }

      this._onDidChangeProfiles.fire();
    } catch (error) {
      console.error('Failed to load Databricks profiles:', error);
      vscode.window.showErrorMessage(`Failed to load Databricks profiles: ${error}`);
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
          this.profiles.set(currentProfile, {
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
      this.profiles.set(currentProfile, {
        name: currentProfile,
        host: currentProfileData.host,
        authType: currentProfileData.authType,
        clusterId: currentProfileData.clusterId,
      });
    }
  }

  async selectProfile(profileName: string): Promise<void> {
    if (!this.profiles.has(profileName)) {
      vscode.window.showErrorMessage(`Profile "${profileName}" not found`);
      return;
    }

    this.selectedProfileName = profileName;

    // Persist selection in workspace state
    await this.context.workspaceState.update('databricks.selectedProfile', profileName);

    // Emit change event - KernelManager will show notification about kernel restart
    this._onDidChangeProfile.fire(profileName);
  }

  getSelectedProfile(): DatabricksProfile | null {
    if (!this.selectedProfileName) {
      return null;
    }
    return this.profiles.get(this.selectedProfileName) || null;
  }

  getSelectedProfileName(): string | null {
    return this.selectedProfileName;
  }

  getAllProfiles(): DatabricksProfile[] {
    return Array.from(this.profiles.values());
  }

  hasProfiles(): boolean {
    return this.profiles.size > 0;
  }

  dispose(): void {
    this.fileWatcher?.dispose();
    this._onDidChangeProfile.dispose();
    this._onDidChangeProfiles.dispose();
  }
}
