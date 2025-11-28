/**
 * Python Extension API Wrapper
 *
 * Provides a typed interface for interacting with the ms-python.python extension.
 * Discovers available Python environments and provides environment change events.
 */

import * as vscode from 'vscode';

/**
 * Represents a Python environment discovered by the Python extension
 */
export interface PythonEnvironment {
  /** Unique identifier for this environment */
  id: string;
  /** Path to the Python executable */
  path: string;
  /** Display name for the environment */
  displayName: string;
  /** Python version (e.g., "3.11.0") */
  version?: string;
  /** Environment type (e.g., "venv", "conda", "system") */
  envType?: string;
}

/**
 * Wrapper class for the Python extension API
 */
export class PythonExtensionApi {
  private pythonApi: any;
  private initialized = false;
  private _onDidChangeEnvironments = new vscode.EventEmitter<void>();

  /** Event that fires when available environments change */
  readonly onDidChangeEnvironments = this._onDidChangeEnvironments.event;

  /**
   * Initialize the Python extension API.
   * Must be called before using other methods.
   *
   * @returns true if initialization was successful, false if Python extension is not available
   */
  async initialize(): Promise<boolean> {
    const pythonExtension = vscode.extensions.getExtension('ms-python.python');
    if (!pythonExtension) {
      console.warn('Python extension not installed');
      return false;
    }

    try {
      if (!pythonExtension.isActive) {
        await pythonExtension.activate();
      }

      this.pythonApi = pythonExtension.exports;
      this.initialized = true;

      // Subscribe to environment changes if available
      if (this.pythonApi?.environments?.onDidChangeEnvironments) {
        this.pythonApi.environments.onDidChangeEnvironments(() => {
          this._onDidChangeEnvironments.fire();
        });
      }

      return true;
    } catch (error) {
      console.error('Failed to initialize Python extension:', error);
      return false;
    }
  }

  /**
   * Check if the API has been initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the active Python environment path for a resource
   *
   * @param resource - Optional URI to get environment for (uses workspace root if not provided)
   * @returns The path to the active Python interpreter, or undefined if not available
   */
  async getActiveEnvironmentPath(resource?: vscode.Uri): Promise<string | undefined> {
    if (!this.initialized) {
      return undefined;
    }

    try {
      // Try new API first (environments.getActiveEnvironmentPath)
      if (this.pythonApi?.environments?.getActiveEnvironmentPath) {
        const envPath = this.pythonApi.environments.getActiveEnvironmentPath(resource);
        return envPath?.path;
      }

      // Fall back to older API (settings.getExecutionDetails)
      if (this.pythonApi?.settings?.getExecutionDetails) {
        const details = this.pythonApi.settings.getExecutionDetails(resource);
        return details?.execCommand?.[0];
      }

      return undefined;
    } catch (error) {
      console.error('Failed to get active environment path:', error);
      return undefined;
    }
  }

  /**
   * Get all known Python environments
   *
   * @returns Array of PythonEnvironment objects
   */
  async getAllEnvironments(): Promise<PythonEnvironment[]> {
    if (!this.initialized) {
      return [];
    }

    try {
      const environments: PythonEnvironment[] = [];

      // Try new API first (environments.known)
      if (this.pythonApi?.environments?.known) {
        const known = this.pythonApi.environments.known;

        for (const env of known) {
          const pythonEnv = this.convertToPythonEnvironment(env);
          if (pythonEnv) {
            environments.push(pythonEnv);
          }
        }
      }

      return environments;
    } catch (error) {
      console.error('Failed to get environments:', error);
      return [];
    }
  }

  /**
   * Resolve a Python environment from a path
   *
   * @param path - Path to the Python executable
   * @returns Resolved PythonEnvironment or undefined
   */
  async resolveEnvironment(path: string): Promise<PythonEnvironment | undefined> {
    if (!this.initialized) {
      return undefined;
    }

    try {
      if (this.pythonApi?.environments?.resolveEnvironment) {
        const resolved = await this.pythonApi.environments.resolveEnvironment(path);
        if (resolved) {
          return this.convertToPythonEnvironment(resolved);
        }
      }

      // Fall back to basic info if can't resolve
      return {
        id: path,
        path: path,
        displayName: path,
      };
    } catch (error) {
      console.error('Failed to resolve environment:', error);
      return undefined;
    }
  }

  /**
   * Listen for active environment changes
   *
   * @param callback - Function to call when active environment changes
   * @returns Disposable to stop listening
   */
  onDidChangeActiveEnvironment(callback: () => void): vscode.Disposable {
    if (!this.initialized) {
      return { dispose: () => {} };
    }

    if (this.pythonApi?.environments?.onDidChangeActiveEnvironmentPath) {
      return this.pythonApi.environments.onDidChangeActiveEnvironmentPath(callback);
    }

    return { dispose: () => {} };
  }

  /**
   * Convert Python extension environment object to our PythonEnvironment interface
   */
  private convertToPythonEnvironment(env: any): PythonEnvironment | undefined {
    if (!env) {
      return undefined;
    }

    // Get the executable path
    let path: string | undefined;
    if (env.executable?.uri?.fsPath) {
      path = env.executable.uri.fsPath;
    } else if (env.path) {
      path = env.path;
    } else if (typeof env === 'string') {
      path = env;
    }

    if (!path) {
      return undefined;
    }

    // Build display name
    let displayName = env.displayName;
    if (!displayName) {
      if (env.version?.sysVersion) {
        displayName = `Python ${env.version.sysVersion.split(' ')[0]}`;
      } else {
        displayName = path;
      }
    }

    // Get version string
    let version: string | undefined;
    if (env.version?.sysVersion) {
      version = env.version.sysVersion.split(' ')[0];
    } else if (env.version?.major !== undefined) {
      version = `${env.version.major}.${env.version.minor}.${env.version.micro}`;
    }

    // Get environment type
    let envType: string | undefined;
    if (env.environment?.type) {
      envType = env.environment.type;
    } else if (env.envType) {
      envType = env.envType;
    }

    return {
      id: env.id || path,
      path,
      displayName,
      version,
      envType,
    };
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this._onDidChangeEnvironments.dispose();
  }
}
