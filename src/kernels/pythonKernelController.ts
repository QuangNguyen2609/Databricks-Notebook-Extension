/**
 * Python Kernel Controller
 *
 * VS Code NotebookController implementation for a specific Python interpreter.
 * Handles cell execution using the PersistentExecutor.
 */

import * as vscode from 'vscode';
import { PythonEnvironment } from '../utils/pythonExtensionApi';
import { PersistentExecutor } from './persistentExecutor';
import { OutputHandler } from '../utils/outputHandler';
import {
  wrapSqlCode as wrapSqlCodeUtil,
  wrapShellCode as wrapShellCodeUtil,
  stripMagicPrefix as stripMagicPrefixUtil,
} from '../utils/codeTransform';
import { extractErrorMessage } from '../utils/errorHandler';

/**
 * NotebookController for a specific Python interpreter
 */
export class PythonKernelController implements vscode.Disposable {
  private readonly _controller: vscode.NotebookController;
  private _executor: PersistentExecutor | null = null;
  private _executionOrder = 0;
  private _outputHandler: OutputHandler;
  private _disposables: vscode.Disposable[] = [];
  private _isExecuting = false;
  private _profileProvider: (() => string | undefined) | undefined;

  /**
   * Create a new PythonKernelController
   *
   * @param environment - The Python environment this controller uses
   * @param notebookType - The notebook type this controller handles
   * @param extensionPath - Path to the extension directory
   * @param profileProvider - Optional function to get the current Databricks profile name
   */
  constructor(
    private readonly _environment: PythonEnvironment,
    notebookType: string,
    private readonly _extensionPath: string,
    profileProvider?: () => string | undefined
  ) {
    this._profileProvider = profileProvider;
    const controllerId = `databricks-python-${this.generateControllerId(_environment.id)}`;

    this._controller = vscode.notebooks.createNotebookController(
      controllerId,
      notebookType,
      this.createLabel(_environment)
    );

    this._controller.supportedLanguages = ['python', 'sql', 'scala', 'r', 'shellscript', 'markdown'];
    this._controller.supportsExecutionOrder = true;
    this._controller.description = _environment.version
      ? `Python ${_environment.version}`
      : _environment.envType || 'Python';
    this._controller.detail = _environment.path;
    this._controller.executeHandler = this.executeHandler.bind(this);

    this._outputHandler = new OutputHandler();

    // Track when this controller is selected and initialize executor
    this._disposables.push(
      this._controller.onDidChangeSelectedNotebooks((event) => {
        if (event.selected) {
          console.debug(`[Kernel] Controller selected for: ${event.notebook.uri.toString()}`);
          // Initialize and start executor on kernel selection so intellisense works before first cell execution
          // Fire and forget - don't block kernel selection UI
          this.ensureExecutor(event.notebook).catch((err) => {
            console.error(`[Kernel] Failed to start executor for intellisense:`, err);
          });
        }
      })
    );
  }

  /**
   * Generate a unique controller ID from an environment path.
   * Uses a hash of the full path to ensure uniqueness while keeping
   * readable prefix for debugging.
   *
   * @param id - The environment ID (typically a file path)
   * @returns A sanitized, unique controller ID string
   */
  private generateControllerId(id: string): string {
    // Create a simple hash of the full path to ensure uniqueness
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      const char = id.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    const hashStr = Math.abs(hash).toString(36);

    // Extract meaningful parts from the path for readability
    const parts = id.split(/[/\\]/);
    const filename = parts[parts.length - 1] || 'python';
    const parentDir = parts[parts.length - 3] || ''; // e.g., ".venv" or "WindowsApps"

    // Combine readable prefix with hash for uniqueness
    const prefix = `${parentDir}-${filename}`.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 30);
    return `${prefix}-${hashStr}`;
  }

  /**
   * Create display label for the controller
   */
  private createLabel(env: PythonEnvironment): string {
    if (env.displayName && env.displayName !== env.path) {
      return env.displayName;
    }
    if (env.version) {
      return `Python ${env.version}`;
    }
    return 'Python';
  }

  /**
   * Get the underlying VS Code controller
   */
  getController(): vscode.NotebookController {
    return this._controller;
  }

  /**
   * Get the Python environment for this controller
   */
  getEnvironment(): PythonEnvironment {
    return this._environment;
  }

  /**
   * Execute handler for notebook cells
   */
  private async executeHandler(
    cells: vscode.NotebookCell[],
    notebook: vscode.NotebookDocument,
    _controller: vscode.NotebookController
  ): Promise<void> {
    // Execute cells sequentially
    for (const cell of cells) {
      await this.executeCell(cell, notebook);
    }
  }

  /**
   * Execute a single cell
   */
  private async executeCell(
    cell: vscode.NotebookCell,
    notebook: vscode.NotebookDocument
  ): Promise<void> {
    const execution = this._controller.createNotebookCellExecution(cell);
    execution.executionOrder = ++this._executionOrder;
    execution.start(Date.now());

    try {
      const code = cell.document.getText();
      const languageId = cell.document.languageId;

      // Get Databricks cell type from metadata
      const databricksType = cell.metadata?.databricksType as string | undefined;

      console.debug(`[Kernel] Executing cell: languageId=${languageId}, databricksType=${databricksType}`);

      // Check if this is a SQL cell that should be auto-wrapped with spark.sql()
      const isSqlCell = databricksType === 'sql' || languageId === 'sql';

      // Check if this is a shell cell that should be auto-wrapped with subprocess
      const isShellCell = databricksType === 'shell' || languageId === 'shellscript';

      // Cells that cannot be executed locally (need Databricks runtime)
      const nonExecutableCells = ['scala', 'r', 'fs', 'run'];
      const isNonExecutable = nonExecutableCells.includes(databricksType || '') ||
                               nonExecutableCells.includes(languageId);

      // Handle truly non-executable cells with informational messages
      if (isNonExecutable) {
        await this.handleNonPythonCell(execution, languageId, code, cell);
        return;
      }

      // Get or create executor
      if (!this._executor) {
        const profileName = this._profileProvider?.();
        console.debug(`[Kernel] Creating executor with Python: ${this._environment.path}, profile: ${profileName || 'none'}`);
        this._executor = new PersistentExecutor(
          this._environment.path,
          this._extensionPath,
          this.getWorkingDirectory(notebook),
          profileName
        );
      }

      // Transform the code based on cell type
      let executableCode = code;

      if (isSqlCell) {
        // Wrap SQL in spark.sql() - execute and display results
        executableCode = this.wrapSqlCode(code);
        console.debug(`[Kernel] Wrapped SQL code for execution`);
      } else if (isShellCell) {
        // Wrap shell commands in subprocess
        executableCode = this.wrapShellCode(code);
        console.debug(`[Kernel] Wrapped shell code for execution`);
      } else {
        // For Python cells, strip %python prefix if present
        executableCode = this.stripMagicPrefix(code, '%python');
      }

      // Execute the code
      this._isExecuting = true;
      const result = await this._executor.execute(executableCode);
      this._isExecuting = false;

      // Convert result to notebook outputs
      const outputs = this._outputHandler.convertResult(result);
      execution.replaceOutput(outputs);

      execution.end(result.success, Date.now());
    } catch (error) {
      execution.replaceOutput([
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.error(new Error(extractErrorMessage(error)))
        ])
      ]);
      execution.end(false, Date.now());
    }
  }

  /**
   * Wrap SQL code in spark.sql() for execution
   */
  private wrapSqlCode(sql: string): string {
    return wrapSqlCodeUtil(sql);
  }

  /**
   * Wrap shell code in subprocess for execution
   */
  private wrapShellCode(shellCode: string): string {
    return wrapShellCodeUtil(shellCode);
  }

  /**
   * Strip magic command prefix from code
   */
  private stripMagicPrefix(code: string, prefix: string): string {
    return stripMagicPrefixUtil(code, prefix);
  }

  /**
   * Get working directory for notebook execution
   */
  private getWorkingDirectory(notebook: vscode.NotebookDocument): string {
    // Use notebook's directory as working directory
    const notebookDir = vscode.Uri.joinPath(notebook.uri, '..').fsPath;

    // Fall back to workspace folder
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(notebook.uri);
    if (workspaceFolder) {
      return workspaceFolder.uri.fsPath;
    }

    return notebookDir;
  }

  /**
   * Handle non-executable cells (Scala, R, %fs, %run)
   * Note: SQL and shell cells are now auto-executed via wrapping
   */
  private async handleNonPythonCell(
    execution: vscode.NotebookCellExecution,
    languageId: string,
    _code: string,
    cell: vscode.NotebookCell
  ): Promise<void> {
    // Check for Databricks cell type from metadata
    const databricksType = cell.metadata?.databricksType as string | undefined;

    console.debug(`[Kernel] Non-executable cell: languageId=${languageId}, databricksType=${databricksType}`);

    // Messages for different cell types that cannot be executed locally
    const messages: Record<string, string> = {
      scala: 'Scala cells require Databricks runtime. Execute this notebook in a Databricks workspace.',

      r: 'R cells require Databricks runtime. Execute this notebook in a Databricks workspace.',

      markdown: 'Markdown cells are rendered automatically in the notebook view.',

      fs: 'Filesystem commands (%fs) require Databricks runtime.',

      run: 'Run commands (%run) require Databricks runtime to execute other notebooks.',
    };

    // Determine message based on language or Databricks type
    const key = databricksType || languageId;
    const message = messages[key] || `${languageId} cells are not supported for local execution.`;

    const output = this._outputHandler.createInfoOutput(message);
    execution.replaceOutput([output]);
    execution.end(true, Date.now());
  }

  /**
   * Interrupt current execution
   */
  interrupt(): void {
    if (this._executor && this._isExecuting) {
      this._executor.interrupt();
    }
  }

  /**
   * Restart the kernel (reset namespace)
   */
  async restart(): Promise<boolean> {
    if (this._executor) {
      return this._executor.restart();
    }
    return true;
  }

  /**
   * Reset the kernel namespace without restarting
   */
  async resetNamespace(): Promise<boolean> {
    if (this._executor) {
      return this._executor.reset();
    }
    return true;
  }

  /**
   * Get variables in the namespace
   */
  async getVariables(): Promise<Record<string, { type: string; repr: string }>> {
    if (this._executor) {
      return this._executor.getVariables();
    }
    return {};
  }

  /**
   * Check if kernel is running
   */
  isRunning(): boolean {
    return this._executor?.isRunning() ?? false;
  }

  /**
   * Ensure executor is initialized and started (used for intellisense before first cell execution)
   * This method creates the executor if needed and starts the Python process so that
   * IntelliSense queries can be executed immediately after kernel selection.
   */
  async ensureExecutor(notebook: vscode.NotebookDocument): Promise<void> {
    if (!this._executor) {
      const profileName = this._profileProvider?.();
      console.debug(`[Kernel] Creating executor for intellisense: ${this._environment.path}, profile: ${profileName || 'none'}`);
      this._executor = new PersistentExecutor(
        this._environment.path,
        this._extensionPath,
        this.getWorkingDirectory(notebook),
        profileName
      );
    }

    // Actually start the executor so IntelliSense works before first cell execution
    if (!this._executor.isRunning()) {
      console.debug(`[Kernel] Starting executor for intellisense...`);
      const started = await this._executor.start();
      if (started) {
        console.debug(`[Kernel] Executor started successfully for intellisense`);
      } else {
        console.warn(`[Kernel] Failed to start executor for intellisense`);
      }
    }
  }

  /**
   * Get the executor instance (for intellisense providers)
   */
  getExecutor(): PersistentExecutor | null {
    return this._executor;
  }

  /**
   * Clear and dispose the executor.
   * Used when profile changes to force recreation with new settings.
   */
  clearExecutor(): void {
    if (this._executor) {
      this._executor.dispose();
      this._executor = null;
    }
  }

  /**
   * Update the executor's profile and restart if running.
   * @param profileName - The new Databricks profile name
   */
  async setExecutorProfile(profileName: string | undefined): Promise<void> {
    if (this._executor) {
      await this._executor.setProfile(profileName);
    }
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this._executor?.dispose();
    this._controller.dispose();
    this._disposables.forEach(d => d.dispose());
  }
}
