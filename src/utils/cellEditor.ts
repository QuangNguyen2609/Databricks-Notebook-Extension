/**
 * Cell Editor Utility
 *
 * Provides a generic interface for modifying notebook cells
 * with consistent WorkspaceEdit handling and cursor restoration.
 */

import * as vscode from 'vscode';

/**
 * Result of a cell transformation
 */
export interface CellTransformResult {
  /** New cell content */
  content: string;
  /** Language ID for the cell */
  languageId: string;
  /** Updated metadata */
  metadata: Record<string, unknown>;
}

/**
 * Function type for transforming cell content
 */
export type CellTransformer = (cell: vscode.NotebookCell) => CellTransformResult;

/**
 * Options for cell modification
 */
export interface ModifyCellOptions {
  /** Whether to enter edit mode after modification (default: true) */
  enterEditMode?: boolean;
  /** Whether to move cursor to end of cell (default: false) */
  moveCursorToEnd?: boolean;
  /** Key to track in auto-detected cells set */
  trackingKey?: string;
  /** Set to add tracking key to */
  trackingSet?: Set<string>;
}

/**
 * Modify a notebook cell with consistent edit handling.
 *
 * This function encapsulates the common pattern of:
 * 1. Creating a WorkspaceEdit
 * 2. Replacing the cell with new NotebookCellData
 * 3. Applying the edit
 * 4. Restoring selection and edit mode
 *
 * @param notebook - The notebook document containing the cell
 * @param cell - The cell to modify
 * @param transformer - Function that returns the new cell data
 * @param options - Additional options for the modification
 * @returns true if the edit was successful
 */
export async function modifyCell(
  notebook: vscode.NotebookDocument,
  cell: vscode.NotebookCell,
  transformer: CellTransformer,
  options: ModifyCellOptions = {}
): Promise<boolean> {
  const {
    enterEditMode = true,
    moveCursorToEnd = false,
    trackingKey,
    trackingSet,
  } = options;

  const cellIndex = cell.index;

  // Track if requested
  if (trackingKey && trackingSet) {
    trackingSet.add(trackingKey);
  }

  // Transform cell content
  const result = transformer(cell);

  // Create workspace edit
  const edit = new vscode.WorkspaceEdit();
  const cellData = new vscode.NotebookCellData(
    vscode.NotebookCellKind.Code,
    result.content,
    result.languageId
  );
  cellData.metadata = result.metadata;

  edit.set(notebook.uri, [
    vscode.NotebookEdit.replaceCells(
      new vscode.NotebookRange(cellIndex, cellIndex + 1),
      [cellData]
    )
  ]);

  // Apply edit
  const success = await vscode.workspace.applyEdit(edit);

  // Restore selection and edit mode if successful
  if (success && enterEditMode) {
    const notebookEditor = vscode.window.activeNotebookEditor;
    if (notebookEditor && notebookEditor.notebook.uri.toString() === notebook.uri.toString()) {
      notebookEditor.selections = [new vscode.NotebookRange(cellIndex, cellIndex + 1)];
      await vscode.commands.executeCommand('notebook.cell.edit');

      if (moveCursorToEnd) {
        await vscode.commands.executeCommand('cursorBottom');
      }
    }
  }

  return success;
}

/**
 * Add a magic command to cell content.
 *
 * @param content - Current cell content
 * @param magicCommand - Magic command to add (e.g., '%sql')
 * @returns New content with magic command prepended
 */
export function addMagicToContent(content: string, magicCommand: string): string {
  const trimmed = content.trim();
  return trimmed ? `${magicCommand}\n${trimmed}` : `${magicCommand}\n`;
}

/**
 * Remove a magic command from cell content.
 *
 * @param content - Current cell content
 * @param magicCommand - Magic command to remove
 * @returns Content without the magic command
 */
export function removeMagicFromContent(content: string, magicCommand: string): string {
  const trimmed = content.trim();

  if (trimmed === magicCommand) {
    return '';
  }

  if (content.startsWith(magicCommand + '\n')) {
    return content.substring(magicCommand.length + 1);
  }

  if (content.startsWith(magicCommand)) {
    return content.substring(magicCommand.length).trimStart();
  }

  return content;
}
