/**
 * VS Code NotebookSerializer for Databricks notebooks
 *
 * This serializer converts between Databricks .py format and VS Code's
 * NotebookData format, enabling proper notebook visualization.
 */

import * as vscode from 'vscode';
import { parseNotebook, serializeNotebook, isDatabricksNotebook } from './parser';
import { DatabricksCell, CellType } from './types';
import { SQL_KEYWORDS_REGEX } from './constants';

/**
 * Serializer for Databricks notebooks
 * Implements the VS Code NotebookSerializer interface
 */
export class DatabricksNotebookSerializer implements vscode.NotebookSerializer {
  /**
   * Deserialize a Databricks .py file into VS Code NotebookData
   * @param content - Raw file content as bytes
   * @param _token - Cancellation token
   * @returns NotebookData containing all cells
   */
  async deserializeNotebook(
    content: Uint8Array,
    _token: vscode.CancellationToken
  ): Promise<vscode.NotebookData> {
    const text = new TextDecoder().decode(content);

    const parsed = parseNotebook(text);

    if (!parsed) {
      // Not a valid Databricks notebook, return empty notebook
      return new vscode.NotebookData([]);
    }

    const cells = parsed.cells.map((cell) => this.convertToNotebookCell(cell));

    const notebookData = new vscode.NotebookData(cells);
    notebookData.metadata = {
      defaultLanguage: parsed.defaultLanguage,
    };

    return notebookData;
  }

  /**
   * Serialize VS Code NotebookData back to Databricks .py format
   * @param data - The notebook data to serialize
   * @param _token - Cancellation token
   * @returns Raw file content as bytes
   */
  async serializeNotebook(
    data: vscode.NotebookData,
    _token: vscode.CancellationToken
  ): Promise<Uint8Array> {
    const cells: DatabricksCell[] = data.cells.map((cell) =>
      this.convertFromNotebookCell(cell)
    );
    const content = serializeNotebook(cells);
    return new TextEncoder().encode(content);
  }

  /**
   * Convert a DatabricksCell to VS Code NotebookCellData
   * @param cell - The Databricks cell to convert
   * @returns VS Code notebook cell data
   */
  private convertToNotebookCell(cell: DatabricksCell): vscode.NotebookCellData {
    const kind =
      cell.type === 'markdown'
        ? vscode.NotebookCellKind.Markup
        : vscode.NotebookCellKind.Code;

    const cellData = new vscode.NotebookCellData(kind, cell.content, cell.language);

    // Store metadata for round-trip preservation
    // Include originalLines and originalContent so we can detect changes
    cellData.metadata = {
      databricksType: cell.type,
      magicCommand: cell.metadata?.magicCommand,
      title: cell.title,
      originalLines: cell.originalLines,
      originalContent: cell.content,
    };

    return cellData;
  }

  /**
   * Infer cell type from VS Code language ID
   * @param languageId - The VS Code language identifier
   * @param content - The cell content (used for SQL and pip auto-detection)
   * @returns The inferred cell type
   */
  private inferCellTypeFromLanguage(languageId: string, content: string): CellType {
    const trimmedContent = content.trim();

    // Auto-detect %pip from content - pip cells stay as Python cells (like Jupyter)
    // but we identify them as 'pip' type for proper serialization
    if (trimmedContent.startsWith('%pip')) {
      return 'pip';
    }

    // Map VS Code language IDs to Databricks cell types
    const languageToType: Record<string, CellType> = {
      'sql': 'sql',
      'scala': 'scala',
      'r': 'r',
      'shellscript': 'shell',
      'bash': 'shell',
      'sh': 'shell',
    };

    // Check if language matches a known type
    if (languageToType[languageId]) {
      return languageToType[languageId];
    }

    // Auto-detect SQL from content (SELECT, INSERT, UPDATE, DELETE, etc.)
    if (languageId === 'python' && SQL_KEYWORDS_REGEX.test(trimmedContent)) {
      return 'sql';
    }

    // Default to code (Python)
    return 'code';
  }

  /**
   * Convert VS Code NotebookCellData back to DatabricksCell
   * @param cell - The VS Code cell to convert
   * @returns Databricks cell format
   */
  private convertFromNotebookCell(cell: vscode.NotebookCellData): DatabricksCell {
    const metadata = (cell.metadata as Record<string, unknown>) || {};

    // Determine cell type from metadata or infer from kind/language
    let type: CellType;
    if (typeof metadata.databricksType === 'string') {
      type = metadata.databricksType as CellType;
    } else if (cell.kind === vscode.NotebookCellKind.Markup) {
      type = 'markdown';
    } else {
      // Infer type from language ID for newly created cells
      type = this.inferCellTypeFromLanguage(cell.languageId, cell.value);
    }

    // Get original lines and content from metadata
    const originalLines = Array.isArray(metadata.originalLines)
      ? metadata.originalLines as string[]
      : [];
    const originalContent = typeof metadata.originalContent === 'string'
      ? metadata.originalContent
      : null;

    // Check if content has changed (normalize whitespace for comparison)
    // This prevents false positives from whitespace differences
    const normalizeForComparison = (s: string) => {
      return s
        .replace(/\r\n/g, '\n')        // Normalize line endings
        .replace(/[ \t]+$/gm, '')      // Remove trailing spaces from each line
        .replace(/\n+$/, '')           // Remove trailing newlines
        .replace(/^\n+/, '')           // Remove leading newlines
        .trim();
    };
    const contentChanged = originalContent === null ||
      normalizeForComparison(originalContent) !== normalizeForComparison(cell.value);

    // Debug: log if content changed unexpectedly
    if (contentChanged && originalContent !== null) {
      console.log('[Serializer] Content changed for cell type:', type);
      console.log('[Serializer] Original length:', originalContent.length, 'New length:', cell.value.length);
    }

    return {
      type,
      content: cell.value,
      title: typeof metadata.title === 'string' ? metadata.title : undefined,
      language: cell.languageId,
      // Only preserve originalLines if content hasn't changed
      originalLines: contentChanged ? [] : originalLines,
      metadata: {
        magicCommand:
          typeof metadata.magicCommand === 'string'
            ? metadata.magicCommand
            : undefined,
      },
    };
  }
}

/**
 * Check if a file is a Databricks notebook
 * @param uri - The file URI to check
 * @returns true if the file is a Databricks notebook
 */
export async function checkIsDatabricksNotebook(uri: vscode.Uri): Promise<boolean> {
  try {
    const content = await vscode.workspace.fs.readFile(uri);
    const text = new TextDecoder().decode(content);
    return isDatabricksNotebook(text);
  } catch {
    return false;
  }
}

/**
 * Get notebook statistics
 * @param uri - The file URI
 * @returns Object with cell count and types
 */
export async function getNotebookStats(
  uri: vscode.Uri
): Promise<{ cellCount: number; types: Record<string, number> } | null> {
  try {
    const content = await vscode.workspace.fs.readFile(uri);
    const text = new TextDecoder().decode(content);
    const notebook = parseNotebook(text);

    if (!notebook) {
      return null;
    }

    const types: Record<string, number> = {};
    for (const cell of notebook.cells) {
      types[cell.type] = (types[cell.type] || 0) + 1;
    }

    return {
      cellCount: notebook.cells.length,
      types,
    };
  } catch {
    return null;
  }
}
