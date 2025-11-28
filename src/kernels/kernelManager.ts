/**
 * Kernel Manager
 *
 * Central manager for all Python kernel controllers.
 * Discovers Python environments and creates controllers for each.
 */

import * as vscode from 'vscode';
import { PythonExtensionApi, PythonEnvironment } from '../utils/pythonExtensionApi';
import { PythonKernelController } from './pythonKernelController';

/**
 * Manages all Python kernel controllers for the Databricks notebook type
 */
export class KernelManager implements vscode.Disposable {
  private readonly notebookType = 'databricks-notebook';
  private pythonApi: PythonExtensionApi;
  private controllers: Map<string, PythonKernelController> = new Map();
  private disposables: vscode.Disposable[] = [];
  private extensionPath: string;
  private initialized = false;

  /** Event emitter for controller changes */
  private _onDidChangeControllers = new vscode.EventEmitter<void>();
  readonly onDidChangeControllers = this._onDidChangeControllers.event;

  /**
   * Create a new KernelManager
   *
   * @param extensionPath - Path to the extension directory
   */
  constructor(extensionPath: string) {
    this.extensionPath = extensionPath;
    this.pythonApi = new PythonExtensionApi();
  }

  /**
   * Initialize the kernel manager
   * Must be called after construction to discover Python environments
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    console.log('[KernelManager] Initializing...');

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
        console.log('[KernelManager] Python environments changed, refreshing controllers...');
        await this.refreshControllers();
      })
    );

    // Listen for active environment changes
    this.disposables.push(
      this.pythonApi.onDidChangeActiveEnvironment(async () => {
        console.log('[KernelManager] Active Python environment changed');
        // Could update preferred controller here
      })
    );

    this.initialized = true;
    console.log(`[KernelManager] Initialized with ${this.controllers.size} controllers`);
  }

  /**
   * Refresh controllers based on current Python environments
   */
  private async refreshControllers(): Promise<void> {
    const environments = await this.pythonApi.getAllEnvironments();
    // Active environment path could be used for setting preferred controller
    const activeEnvPath = await this.pythonApi.getActiveEnvironmentPath();

    console.log(`[KernelManager] Found ${environments.length} Python environments`);
    console.log(`[KernelManager] Active environment: ${activeEnvPath || 'none'}`);

    // Log each discovered environment
    for (const env of environments) {
      console.log(`[KernelManager]   - ${env.displayName}: ${env.path}`);
    }

    // Track which environments still exist
    const currentEnvIds = new Set(environments.map(e => e.id));

    // Remove controllers for environments that no longer exist
    for (const [id, controller] of this.controllers) {
      if (!currentEnvIds.has(id)) {
        console.log(`[KernelManager] Removing controller for: ${id}`);
        controller.dispose();
        this.controllers.delete(id);
      }
    }

    // Create controllers for new environments
    for (const env of environments) {
      if (!this.controllers.has(env.id)) {
        console.log(`[KernelManager] Creating controller for: ${env.displayName} (${env.path})`);
        const controller = new PythonKernelController(
          env,
          this.notebookType,
          this.extensionPath
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
   * Register kernel-related commands
   */
  registerCommands(context: vscode.ExtensionContext): void {
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
