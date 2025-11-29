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

/**
 * NotebookController for a specific Python interpreter
 */
export class PythonKernelController implements vscode.Disposable {
  private readonly controller: vscode.NotebookController;
  private executor: PersistentExecutor | null = null;
  private executionOrder = 0;
  private outputHandler: OutputHandler;
  private disposables: vscode.Disposable[] = [];
  private isExecuting = false;

  /**
   * Create a new PythonKernelController
   *
   * @param environment - The Python environment this controller uses
   * @param notebookType - The notebook type this controller handles
   * @param extensionPath - Path to the extension directory
   */
  constructor(
    private readonly environment: PythonEnvironment,
    notebookType: string,
    private readonly extensionPath: string
  ) {
    const controllerId = `databricks-python-${this.sanitizeId(environment.id)}`;

    this.controller = vscode.notebooks.createNotebookController(
      controllerId,
      notebookType,
      this.createLabel(environment)
    );

    this.controller.supportedLanguages = ['python', 'sql', 'scala', 'r', 'shellscript', 'markdown'];
    this.controller.supportsExecutionOrder = true;
    this.controller.description = environment.version
      ? `Python ${environment.version}`
      : environment.envType || 'Python';
    this.controller.detail = environment.path;
    this.controller.executeHandler = this.executeHandler.bind(this);

    this.outputHandler = new OutputHandler();

    // Track when this controller is selected
    this.disposables.push(
      this.controller.onDidChangeSelectedNotebooks((event) => {
        if (event.selected) {
          console.log(`[Kernel] Controller selected for: ${event.notebook.uri.toString()}`);
        }
      })
    );
  }

  /**
   * Sanitize ID for use in controller ID
   */
  private sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 50);
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
    return this.controller;
  }

  /**
   * Get the Python environment for this controller
   */
  getEnvironment(): PythonEnvironment {
    return this.environment;
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
    const execution = this.controller.createNotebookCellExecution(cell);
    execution.executionOrder = ++this.executionOrder;
    execution.start(Date.now());

    try {
      const code = cell.document.getText();
      const languageId = cell.document.languageId;

      // Get Databricks cell type from metadata
      const databricksType = cell.metadata?.databricksType as string | undefined;

      console.log(`[Kernel] Executing cell: languageId=${languageId}, databricksType=${databricksType}`);

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
      if (!this.executor) {
        console.log(`[Kernel] Creating executor with Python: ${this.environment.path}`);
        this.executor = new PersistentExecutor(
          this.environment.path,
          this.extensionPath,
          this.getWorkingDirectory(notebook)
        );
      }

      // Transform the code based on cell type
      let executableCode = code;

      if (isSqlCell) {
        // Wrap SQL in spark.sql() - execute and display results
        executableCode = this.wrapSqlCode(code);
        console.log(`[Kernel] Wrapped SQL code for execution`);
      } else if (isShellCell) {
        // Wrap shell commands in subprocess
        executableCode = this.wrapShellCode(code);
        console.log(`[Kernel] Wrapped shell code for execution`);
      } else {
        // For Python cells, strip %python prefix if present
        executableCode = this.stripMagicPrefix(code, '%python');
      }

      // Execute the code
      this.isExecuting = true;
      const result = await this.executor.execute(executableCode);
      this.isExecuting = false;

      // Convert result to notebook outputs
      const outputs = this.outputHandler.convertResult(result);
      execution.replaceOutput(outputs);

      execution.end(result.success, Date.now());
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      execution.replaceOutput([
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.error(new Error(errorMessage))
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
    code: string,
    cell: vscode.NotebookCell
  ): Promise<void> {
    // Check for Databricks cell type from metadata
    const databricksType = cell.metadata?.databricksType as string | undefined;

    console.log(`[Kernel] Non-executable cell: languageId=${languageId}, databricksType=${databricksType}`);

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

    const output = this.outputHandler.createInfoOutput(message);
    execution.replaceOutput([output]);
    execution.end(true, Date.now());
  }

  /**
   * Interrupt current execution
   */
  interrupt(): void {
    if (this.executor && this.isExecuting) {
      this.executor.interrupt();
    }
  }

  /**
   * Restart the kernel (reset namespace)
   */
  async restart(): Promise<boolean> {
    if (this.executor) {
      return this.executor.restart();
    }
    return true;
  }

  /**
   * Reset the kernel namespace without restarting
   */
  async resetNamespace(): Promise<boolean> {
    if (this.executor) {
      return this.executor.reset();
    }
    return true;
  }

  /**
   * Get variables in the namespace
   */
  async getVariables(): Promise<Record<string, { type: string; repr: string }>> {
    if (this.executor) {
      return this.executor.getVariables();
    }
    return {};
  }

  /**
   * Check if kernel is running
   */
  isRunning(): boolean {
    return this.executor?.isRunning() ?? false;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.executor?.dispose();
    this.controller.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
