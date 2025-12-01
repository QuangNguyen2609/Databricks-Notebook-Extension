/**
 * Kernel Manager
 *
 * Central manager for all Python kernel controllers.
 * Discovers Python environments and creates controllers for each.
 */

import * as vscode from 'vscode';
import { PythonExtensionApi, PythonEnvironment } from '../utils/pythonExtensionApi';
import { PythonKernelController } from './pythonKernelController';
import { PersistentExecutor } from './persistentExecutor';
import { ProfileManager } from '../databricks/profileManager';

/**
 * Manages all Python kernel controllers for the Databricks notebook type
 */
export class KernelManager implements vscode.Disposable {
  private readonly notebookType = 'databricks-notebook';
  private pythonApi: PythonExtensionApi;
  private controllers: Map<string, PythonKernelController> = new Map();
  private disposables: vscode.Disposable[] = [];
  private extensionPath: string;
  private profileManager: ProfileManager | undefined;
  private initialized = false;

  /** Event emitter for controller changes */
  private _onDidChangeControllers = new vscode.EventEmitter<void>();
  readonly onDidChangeControllers = this._onDidChangeControllers.event;

  /**
   * Create a new KernelManager
   *
   * @param extensionPath - Path to the extension directory
   * @param profileManager - Optional ProfileManager for Databricks profile selection
   */
  constructor(extensionPath: string, profileManager?: ProfileManager) {
    this.extensionPath = extensionPath;
    this.profileManager = profileManager;
    this.pythonApi = new PythonExtensionApi();

    // Subscribe to profile changes to restart kernels
    if (this.profileManager) {
      this.disposables.push(
        this.profileManager.onDidChangeProfile(async (profileName) => {
          console.debug(`[KernelManager] Profile changed to: ${profileName || 'none'}, restarting kernels...`);
          await this.onProfileChanged(profileName);
        })
      );
    }
  }

  /**
   * Initialize the kernel manager
   * Must be called after construction to discover Python environments
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    console.debug('[KernelManager] Initializing...');

    // Initialize Python extension API
    const pythonAvailable = await this.pythonApi.initialize();

    if (!pythonAvailable) {
      console.warn('[KernelManager] Python extension not available');
      vscode.window.showWarningMessage(
        'Python extension is required for kernel execution. Please install the Python extension.'
      );
      return;
    }

    // Create controllers for discovered environments
    await this.refreshControllers();

    // Listen for environment changes
    this.disposables.push(
      this.pythonApi.onDidChangeEnvironments(async () => {
        console.debug('[KernelManager] Python environments changed, refreshing controllers...');
        await this.refreshControllers();
      })
    );

    // Listen for active environment changes
    this.disposables.push(
      this.pythonApi.onDidChangeActiveEnvironment(async () => {
        console.debug('[KernelManager] Active Python environment changed');
        // Could update preferred controller here
      })
    );

    this.initialized = true;
    console.debug(`[KernelManager] Initialized with ${this.controllers.size} controllers`);
  }

  /**
   * Refresh controllers based on current Python environments
   */
  private async refreshControllers(): Promise<void> {
    // Trigger a refresh first (important on Windows for conda/venv discovery)
    await this.pythonApi.refreshEnvironments();

    // Small delay to allow Python extension to update its environment list
    await new Promise((resolve) => setTimeout(resolve, 500));

    const environments = await this.pythonApi.getAllEnvironments();
    // Active environment path could be used for setting preferred controller
    const activeEnvPath = await this.pythonApi.getActiveEnvironmentPath();

    console.debug(`[KernelManager] Found ${environments.length} Python environments`);
    console.debug(`[KernelManager] Active environment: ${activeEnvPath || 'none'}`);

    // Log each discovered environment
    for (const env of environments) {
      console.debug(`[KernelManager]   - ${env.displayName}: ${env.path}`);
    }

    // Track which environments still exist
    const currentEnvIds = new Set(environments.map(e => e.id));

    // Remove controllers for environments that no longer exist
    for (const [id, controller] of this.controllers) {
      if (!currentEnvIds.has(id)) {
        console.debug(`[KernelManager] Removing controller for: ${id}`);
        controller.dispose();
        this.controllers.delete(id);
      }
    }

    // Create controllers for new environments
    for (const env of environments) {
      if (!this.controllers.has(env.id)) {
        console.debug(`[KernelManager] Creating controller for: ${env.displayName} (${env.path})`);

        // Create profile provider function if ProfileManager exists
        const profileProvider = this.profileManager
          ? () => this.profileManager?.getSelectedProfileName() ?? undefined
          : undefined;

        const controller = new PythonKernelController(
          env,
          this.notebookType,
          this.extensionPath,
          profileProvider
        );
        this.controllers.set(env.id, controller);
      }
    }

    // If we have an active environment, you could set it as preferred
    // but VS Code already handles this well with user selection persistence

    this._onDidChangeControllers.fire();
  }

  /**
   * Get the number of registered controllers
   */
  getControllerCount(): number {
    return this.controllers.size;
  }

  /**
   * Get all controller environments
   */
  getEnvironments(): PythonEnvironment[] {
    return Array.from(this.controllers.values()).map(c => c.getEnvironment());
  }

  /**
   * Get a specific controller by environment ID
   */
  getController(envId: string): PythonKernelController | undefined {
    return this.controllers.get(envId);
  }

  /**
   * Find controller by Python path
   */
  getControllerByPath(pythonPath: string): PythonKernelController | undefined {
    for (const controller of this.controllers.values()) {
      if (controller.getEnvironment().path === pythonPath) {
        return controller;
      }
    }
    return undefined;
  }

  /**
   * Handle profile change by updating all executors
   */
  private async onProfileChanged(profileName: string | null): Promise<void> {
    // Notify user
    if (profileName) {
      vscode.window.showInformationMessage(
        `Switching to Databricks profile "${profileName}". Restarting active kernels...`
      );
    }

    // Restart all active executors with new profile
    const restartPromises: Promise<void>[] = [];
    for (const controller of this.controllers.values()) {
      if (controller.executor?.isRunning()) {
        restartPromises.push(controller.executor.setProfile(profileName ?? undefined));
      }
    }
    await Promise.all(restartPromises);
  }

  /**
   * Restart all running kernels
   */
  async restartAll(): Promise<void> {
    const restartPromises: Promise<boolean>[] = [];
    for (const controller of this.controllers.values()) {
      if (controller.isRunning()) {
        restartPromises.push(controller.restart());
      }
    }
    await Promise.all(restartPromises);
  }

  /**
   * Check if any kernel is running
   */
  hasRunningKernels(): boolean {
    for (const controller of this.controllers.values()) {
      if (controller.isRunning()) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get the executor from the first running kernel.
   * Used for intellisense providers that need to query Databricks.
   */
  getActiveExecutor(): PersistentExecutor | null {
    for (const controller of this.controllers.values()) {
      if (controller.isRunning()) {
        return controller.getExecutor();
      }
    }
    return null;
  }

  /**
   * Register kernel-related commands
   * @param context - Extension context
   * @param onKernelRestart - Optional callback called when kernel is restarted (e.g., to clear caches)
   */
  registerCommands(context: vscode.ExtensionContext, onKernelRestart?: () => void): void {
    // Command to restart kernel
    context.subscriptions.push(
      vscode.commands.registerCommand('databricks-notebook.restartKernel', async () => {
        const notebook = vscode.window.activeNotebookEditor?.notebook;
        if (!notebook) {
          vscode.window.showWarningMessage('No notebook is currently active');
          return;
        }

        // Find the controller for this notebook
        // VS Code doesn't expose which controller is selected, so we restart all running ones
        // that match this notebook type
        for (const controller of this.controllers.values()) {
          if (controller.isRunning()) {
            const restarted = await controller.restart();
            if (restarted) {
              // Call the restart callback (e.g., to clear catalog cache)
              onKernelRestart?.();
              vscode.window.showInformationMessage('Kernel restarted successfully');
            }
            return;
          }
        }

        vscode.window.showInformationMessage('No running kernel to restart');
      })
    );

    // Command to interrupt kernel
    context.subscriptions.push(
      vscode.commands.registerCommand('databricks-notebook.interruptKernel', () => {
        for (const controller of this.controllers.values()) {
          controller.interrupt();
        }
      })
    );
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    // Dispose all controllers
    for (const controller of this.controllers.values()) {
      controller.dispose();
    }
    this.controllers.clear();

    // Dispose Python API
    this.pythonApi.dispose();

    // Dispose other resources
    this.disposables.forEach(d => d.dispose());
    this._onDidChangeControllers.dispose();
  }
}
