/**
 * NotebookController for Databricks notebooks
 *
 * This controller provides optional execution support for Databricks notebooks.
 * Currently, it shows a placeholder message, but can be extended to integrate with:
 * - Databricks Connect (for local execution against remote clusters)
 * - Databricks REST API (for submitting jobs)
 * - Local Python execution (for simple code)
 */

import * as vscode from 'vscode';

/**
 * Controller for executing Databricks notebook cells
 */
export class DatabricksNotebookController implements vscode.Disposable {
  readonly controllerId = 'databricks-notebook-controller';
  readonly notebookType = 'databricks-notebook';
  readonly label = 'Databricks Kernel';
  readonly supportedLanguages = ['python', 'sql', 'scala', 'r', 'shellscript', 'markdown'];

  private readonly _controller: vscode.NotebookController;
  private _executionOrder = 0;

  constructor() {
    this._controller = vscode.notebooks.createNotebookController(
      this.controllerId,
      this.notebookType,
      this.label
    );

    this._controller.supportedLanguages = this.supportedLanguages;
    this._controller.supportsExecutionOrder = true;
    this._controller.description = 'Execute cells (requires Databricks Connect)';
    this._controller.executeHandler = this._execute.bind(this);
  }

  /**
   * Dispose the controller
   */
  dispose(): void {
    this._controller.dispose();
  }

  /**
   * Execute the given cells
   * @param cells - Cells to execute
   * @param _notebook - The notebook document
   * @param _controller - The controller
   */
  private async _execute(
    cells: vscode.NotebookCell[],
    _notebook: vscode.NotebookDocument,
    _controller: vscode.NotebookController
  ): Promise<void> {
    for (const cell of cells) {
      await this._doExecution(cell);
    }
  }

  /**
   * Execute a single cell
   * @param cell - The cell to execute
   */
  private async _doExecution(cell: vscode.NotebookCell): Promise<void> {
    const execution = this._controller.createNotebookCellExecution(cell);
    execution.executionOrder = ++this._executionOrder;
    execution.start(Date.now());

    try {
      const languageId = cell.document.languageId;
      const cellContent = cell.document.getText();

      // Get cell metadata
      const metadata = cell.metadata as Record<string, unknown> | undefined;
      const cellType = metadata?.databricksType as string | undefined;

      let outputMessage: string;
      let outputMimeType = 'text/plain';

      // Handle different cell types
      if (languageId === 'markdown' || cellType === 'markdown') {
        // Markdown cells don't need execution
        outputMessage = 'Markdown cells are rendered automatically.';
      } else if (cellType === 'run') {
        outputMessage = `%run command detected: ${cellContent}\n\nTo execute, run this notebook in Databricks.`;
      } else if (cellType === 'pip' || cellType === 'fs' || cellType === 'shell') {
        outputMessage = `Magic command detected: ${cellType}\n\nThis command requires Databricks runtime to execute.`;
      } else {
        // Code cells (Python, SQL, Scala, R)
        outputMessage = this._getExecutionMessage(languageId);
      }

      const output = new vscode.NotebookCellOutput([
        vscode.NotebookCellOutputItem.text(outputMessage, outputMimeType),
      ]);

      execution.replaceOutput([output]);
      execution.end(true, Date.now());
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      execution.replaceOutput([
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.error(
            new Error(`Execution failed: ${errorMessage}`)
          ),
        ]),
      ]);
      execution.end(false, Date.now());
    }
  }

  /**
   * Get execution message based on language
   * @param languageId - The language ID
   * @returns Message to display
   */
  private _getExecutionMessage(languageId: string): string {
    const messages: Record<string, string> = {
      python: '⚠️ Python Execution\n\nTo execute Python cells locally, configure Databricks Connect:\n\n1. Install: pip install databricks-connect\n2. Configure: databricks-connect configure\n3. Restart VS Code\n\nAlternatively, run this notebook in your Databricks workspace.',
      sql: '⚠️ SQL Execution\n\nSQL cells require a Databricks connection.\n\nTo execute:\n1. Configure Databricks Connect with your workspace\n2. Or run this notebook in your Databricks workspace',
      scala: '⚠️ Scala Execution\n\nScala cells require Databricks runtime.\n\nPlease run this notebook in your Databricks workspace.',
      r: '⚠️ R Execution\n\nR cells require Databricks runtime.\n\nPlease run this notebook in your Databricks workspace.',
    };

    return messages[languageId] || '⚠️ Execution not available for this cell type.';
  }
}
