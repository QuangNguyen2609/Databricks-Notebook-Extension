/**
 * Python Extension API Wrapper
 *
 * Provides a typed interface for interacting with the ms-python.python extension.
 * Discovers available Python environments and provides environment change events.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';

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
   * Trigger a refresh of Python environments
   * This is especially important on Windows where conda/venv may not be discovered immediately
   */
  async refreshEnvironments(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    try {
      // Trigger refresh if available (Python extension API v2)
      if (this.pythonApi?.environments?.refreshEnvironments) {
        console.log('[PythonExtensionApi] Triggering environment refresh...');
        await this.pythonApi.environments.refreshEnvironments();
      }
    } catch (error) {
      console.warn('[PythonExtensionApi] Failed to refresh environments:', error);
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
      const seenPaths = new Set<string>();

      // Try new API first (environments.known)
      if (this.pythonApi?.environments?.known) {
        const known = this.pythonApi.environments.known;

        for (const env of known) {
          const pythonEnv = this.convertToPythonEnvironment(env);
          if (pythonEnv) {
            environments.push(pythonEnv);
            seenPaths.add(this.normalizePath(pythonEnv.path));
          }
        }
      }

      // Discover conda environments via conda command (works on all platforms)
      const condaEnvs = await this.discoverCondaEnvironmentsViaCommand(seenPaths);
      environments.push(...condaEnvs);

      // On Windows, manually discover additional environments that Python extension might miss
      if (process.platform === 'win32') {
        const additionalEnvs = await this.discoverWindowsEnvironments(seenPaths);
        environments.push(...additionalEnvs);
      }

      // Also check for .venv in workspace folders
      const workspaceEnvs = await this.discoverWorkspaceEnvironments(seenPaths);
      environments.push(...workspaceEnvs);

      return environments;
    } catch (error) {
      console.error('Failed to get environments:', error);
      return [];
    }
  }

  /**
   * Normalize a path for comparison (lowercase on Windows)
   */
  private normalizePath(p: string): string {
    const normalized = path.normalize(p);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  }

  /**
   * Discover Python environments in workspace folders (.venv, venv, .env)
   */
  private async discoverWorkspaceEnvironments(seenPaths: Set<string>): Promise<PythonEnvironment[]> {
    const environments: PythonEnvironment[] = [];
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders) {
      return environments;
    }

    const venvNames = ['.venv', 'venv', '.env', 'env'];
    const pythonExe = process.platform === 'win32' ? 'python.exe' : 'python';
    const scriptsDir = process.platform === 'win32' ? 'Scripts' : 'bin';

    for (const folder of workspaceFolders) {
      for (const venvName of venvNames) {
        const venvPath = path.join(folder.uri.fsPath, venvName, scriptsDir, pythonExe);

        if (this.fileExists(venvPath) && !seenPaths.has(this.normalizePath(venvPath))) {
          console.log(`[PythonExtensionApi] Found workspace venv: ${venvPath}`);
          const env = await this.createEnvironmentFromPath(venvPath, 'venv', `${venvName} (${folder.name})`);
          if (env) {
            environments.push(env);
            seenPaths.add(this.normalizePath(venvPath));
          }
        }
      }
    }

    return environments;
  }

  /**
   * Discover additional Python environments on Windows (conda, pyenv, etc.)
   * This is a fallback for filesystem-based discovery when conda command fails
   */
  private async discoverWindowsEnvironments(seenPaths: Set<string>): Promise<PythonEnvironment[]> {
    const environments: PythonEnvironment[] = [];
    const userProfile = process.env.USERPROFILE || process.env.HOME || '';

    if (!userProfile) {
      return environments;
    }

    // Common conda installation locations on Windows (fallback if conda command fails)
    const condaLocations = [
      path.join(userProfile, 'miniconda3'),
      path.join(userProfile, 'anaconda3'),
      path.join(userProfile, 'Miniconda3'),
      path.join(userProfile, 'Anaconda3'),
      path.join(userProfile, 'AppData', 'Local', 'miniconda3'),
      path.join(userProfile, 'AppData', 'Local', 'anaconda3'),
      path.join(userProfile, 'AppData', 'Local', 'Continuum', 'miniconda3'),
      path.join(userProfile, 'AppData', 'Local', 'Continuum', 'anaconda3'),
      'C:\\miniconda3',
      'C:\\anaconda3',
      'C:\\ProgramData\\miniconda3',
      'C:\\ProgramData\\anaconda3',
    ];

    // Check for conda base environments
    for (const condaBase of condaLocations) {
      const pythonPath = path.join(condaBase, 'python.exe');
      if (this.fileExists(pythonPath) && !seenPaths.has(this.normalizePath(pythonPath))) {
        console.log(`[PythonExtensionApi] Found conda base: ${pythonPath}`);
        const env = await this.createEnvironmentFromPath(pythonPath, 'conda', 'conda (base)');
        if (env) {
          environments.push(env);
          seenPaths.add(this.normalizePath(pythonPath));
        }
      }

      // Check for conda environments in envs folder
      const envsPath = path.join(condaBase, 'envs');
      if (this.directoryExists(envsPath)) {
        try {
          const envDirs = fs.readdirSync(envsPath);
          for (const envDir of envDirs) {
            const envPythonPath = path.join(envsPath, envDir, 'python.exe');
            if (this.fileExists(envPythonPath) && !seenPaths.has(this.normalizePath(envPythonPath))) {
              console.log(`[PythonExtensionApi] Found conda env: ${envPythonPath}`);
              const env = await this.createEnvironmentFromPath(envPythonPath, 'conda', `conda (${envDir})`);
              if (env) {
                environments.push(env);
                seenPaths.add(this.normalizePath(envPythonPath));
              }
            }
          }
        } catch (error) {
          console.warn(`[PythonExtensionApi] Failed to read conda envs at ${envsPath}:`, error);
        }
      }
    }

    // Check pyenv-win locations
    const pyenvRoot = process.env.PYENV_ROOT || path.join(userProfile, '.pyenv', 'pyenv-win');
    const pyenvVersionsPath = path.join(pyenvRoot, 'versions');
    if (this.directoryExists(pyenvVersionsPath)) {
      try {
        const versions = fs.readdirSync(pyenvVersionsPath);
        for (const version of versions) {
          const versionPythonPath = path.join(pyenvVersionsPath, version, 'python.exe');
          if (this.fileExists(versionPythonPath) && !seenPaths.has(this.normalizePath(versionPythonPath))) {
            console.log(`[PythonExtensionApi] Found pyenv version: ${versionPythonPath}`);
            const env = await this.createEnvironmentFromPath(versionPythonPath, 'pyenv', `pyenv (${version})`);
            if (env) {
              environments.push(env);
              seenPaths.add(this.normalizePath(versionPythonPath));
            }
          }
        }
      } catch (error) {
        console.warn(`[PythonExtensionApi] Failed to read pyenv versions:`, error);
      }
    }

    return environments;
  }

  /**
   * Discover conda environments using the conda command (more reliable than filesystem search)
   */
  private async discoverCondaEnvironmentsViaCommand(seenPaths: Set<string>): Promise<PythonEnvironment[]> {
    const environments: PythonEnvironment[] = [];

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.log('[PythonExtensionApi] Conda discovery timed out');
        resolve(environments);
      }, 10000);

      try {
        // Use cmd.exe on Windows to properly handle conda command
        const condaCmd = process.platform === 'win32' ? 'conda.bat' : 'conda';
        const proc = cp.spawn(condaCmd, ['info', '--envs', '--json'], {
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });

        let output = '';

        proc.stdout?.on('data', (data) => {
          output += data.toString();
        });

        proc.on('close', async (code) => {
          clearTimeout(timeout);

          if (code !== 0 || !output) {
            console.log('[PythonExtensionApi] Conda command failed or not available');
            resolve(environments);
            return;
          }

          try {
            const condaInfo = JSON.parse(output);
            const envPaths: string[] = condaInfo.envs || [];

            console.log(`[PythonExtensionApi] Conda found ${envPaths.length} environments`);

            for (const envPath of envPaths) {
              const pythonExe = process.platform === 'win32' ? 'python.exe' : 'python';
              const pythonPath = path.join(envPath, pythonExe);

              if (this.fileExists(pythonPath) && !seenPaths.has(this.normalizePath(pythonPath))) {
                // Determine environment name from path
                const envName = path.basename(envPath);
                const isBase =
                  envPath === condaInfo.root_prefix || envPath === condaInfo.conda_prefix;
                const displayName = isBase ? 'base' : envName;

                console.log(`[PythonExtensionApi] Found conda env via command: ${pythonPath} (${displayName})`);
                const env = await this.createEnvironmentFromPath(pythonPath, 'conda', `conda (${displayName})`);
                if (env) {
                  environments.push(env);
                  seenPaths.add(this.normalizePath(pythonPath));
                }
              }
            }
          } catch (parseError) {
            console.warn('[PythonExtensionApi] Failed to parse conda info:', parseError);
          }

          resolve(environments);
        });

        proc.on('error', (error) => {
          clearTimeout(timeout);
          console.log('[PythonExtensionApi] Conda command not found:', error.message);
          resolve(environments);
        });
      } catch (error) {
        clearTimeout(timeout);
        console.warn('[PythonExtensionApi] Failed to run conda command:', error);
        resolve(environments);
      }
    });
  }

  /**
   * Create a PythonEnvironment from a Python executable path
   */
  private async createEnvironmentFromPath(
    pythonPath: string,
    envType: string,
    fallbackName: string
  ): Promise<PythonEnvironment | undefined> {
    try {
      // Try to get version from Python
      const version = await this.getPythonVersion(pythonPath);

      return {
        id: pythonPath,
        path: pythonPath,
        displayName: version ? `Python ${version} (${fallbackName})` : fallbackName,
        version: version,
        envType: envType,
      };
    } catch (error) {
      console.warn(`[PythonExtensionApi] Failed to create environment for ${pythonPath}:`, error);
      return undefined;
    }
  }

  /**
   * Get Python version by running the interpreter
   */
  private async getPythonVersion(pythonPath: string): Promise<string | undefined> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(undefined), 5000);

      try {
        const proc = cp.spawn(pythonPath, ['--version'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });

        let output = '';

        proc.stdout?.on('data', (data) => {
          output += data.toString();
        });

        proc.stderr?.on('data', (data) => {
          output += data.toString();
        });

        proc.on('close', () => {
          clearTimeout(timeout);
          // Parse "Python 3.11.0" format
          const match = output.match(/Python\s+(\d+\.\d+\.\d+)/i);
          resolve(match ? match[1] : undefined);
        });

        proc.on('error', () => {
          clearTimeout(timeout);
          resolve(undefined);
        });
      } catch {
        clearTimeout(timeout);
        resolve(undefined);
      }
    });
  }

  /**
   * Check if a file exists
   */
  private fileExists(filePath: string): boolean {
    try {
      return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    } catch {
      return false;
    }
  }

  /**
   * Check if a directory exists
   */
  private directoryExists(dirPath: string): boolean {
    try {
      return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
    } catch {
      return false;
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
