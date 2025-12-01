/**
 * Output Handler
 *
 * Converts execution results to VS Code notebook outputs.
 */

import * as vscode from 'vscode';
import { ExecutionResult } from '../kernels/persistentExecutor';

/**
 * Converts execution results to VS Code notebook cell outputs
 */
export class OutputHandler {
  /**
   * Convert an execution result to notebook cell outputs
   *
   * @param result - The execution result from the Python executor
   * @returns Array of NotebookCellOutput objects
   */
  convertResult(result: ExecutionResult): vscode.NotebookCellOutput[] {
    const outputs: vscode.NotebookCellOutput[] = [];

    // Handle display() outputs first (they should appear before stdout)
    if (result.displayData && result.displayData.length > 0) {
      for (const htmlData of result.displayData) {
        outputs.push(this.createHtmlOutput(htmlData));
      }
    }

    // Handle stdout
    if (result.stdout && result.stdout.trim()) {
      outputs.push(new vscode.NotebookCellOutput([
        vscode.NotebookCellOutputItem.stdout(result.stdout)
      ]));
    }

    // Handle stderr (but not if it's part of an error - avoid duplication)
    // Use text/plain for better scrollability support in VS Code
    if (result.stderr && result.stderr.trim() && result.success) {
      outputs.push(new vscode.NotebookCellOutput([
        vscode.NotebookCellOutputItem.text(result.stderr, 'text/plain')
      ]));
    }

    // Handle errors
    if (!result.success && result.error) {
      const errorOutput = this.createErrorOutput(result);
      outputs.push(errorOutput);
    }

    return outputs;
  }

  /**
   * Create an error output from an execution result
   * Uses text/plain for better scrollability support in VS Code's "View as scrollable element"
   */
  private createErrorOutput(result: ExecutionResult): vscode.NotebookCellOutput {
    const errorName = result.errorType || 'Error';
    const errorMessage = result.error || 'Unknown error';

    // Format error as text for better scrollability
    let errorText = errorMessage;
    if (result.lineNumber) {
      errorText = `${errorName}: ${errorMessage}\n    at <cell>:${result.lineNumber}`;
    }

    // Use text/plain for errors - this enables VS Code's scrollable element feature
    return new vscode.NotebookCellOutput([
      vscode.NotebookCellOutputItem.text(errorText, 'text/plain')
    ]);
  }

  /**
   * Create an informational output (for non-executable cells like SQL, Scala, etc.)
   *
   * @param message - The information message to display
   * @returns NotebookCellOutput with the message
   */
  createInfoOutput(message: string): vscode.NotebookCellOutput {
    return new vscode.NotebookCellOutput([
      vscode.NotebookCellOutputItem.text(message, 'text/plain')
    ]);
  }

  /**
   * Create a text output
   *
   * @param text - The text to display
   * @param mimeType - Optional MIME type (defaults to 'text/plain')
   * @returns NotebookCellOutput with the text
   */
  createTextOutput(text: string, mimeType: string = 'text/plain'): vscode.NotebookCellOutput {
    return new vscode.NotebookCellOutput([
      vscode.NotebookCellOutputItem.text(text, mimeType)
    ]);
  }

  /**
   * Create an HTML output
   *
   * @param html - The HTML content to display
   * @returns NotebookCellOutput with the HTML
   */
  createHtmlOutput(html: string): vscode.NotebookCellOutput {
    return new vscode.NotebookCellOutput([
      vscode.NotebookCellOutputItem.text(html, 'text/html')
    ]);
  }

  /**
   * Create a JSON output
   *
   * @param data - The JSON data to display
   * @returns NotebookCellOutput with the JSON
   */
  createJsonOutput(data: unknown): vscode.NotebookCellOutput {
    return new vscode.NotebookCellOutput([
      vscode.NotebookCellOutputItem.json(data)
    ]);
  }
}
