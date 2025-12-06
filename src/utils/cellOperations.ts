/**
 * Cell Operations Utility
 *
 * High-level cell manipulation functions that build on the cellEditor utility.
 * These functions handle magic command management and cell type conversions.
 */

import * as vscode from 'vscode';
import {
  modifyCell,
  addMagicToContent,
  removeMagicFromContent,
  CellTransformResult,
} from './cellEditor';
import {
  MAGIC_TO_CELL_TYPE,
  LANGUAGE_TO_MAGIC,
  contentStartsWithMagic,
} from '../constants';

/**
 * Ensure a cell has the required magic command in its content.
 * @param notebook - The notebook document
 * @param cell - The cell to update
 * @param magicCommand - The magic command to ensure (e.g., '%sql')
 * @param languageId - The target language ID
 * @param trackingSet - Set to track processed cells (prevents duplicate processing)
 */
export async function ensureMagicCommand(
  notebook: vscode.NotebookDocument,
  cell: vscode.NotebookCell,
  magicCommand: string,
  languageId: string,
  trackingSet: Set<string>
): Promise<void> {
  const cellKey = cell.document.uri.toString();

  await modifyCell(notebook, cell, (c): CellTransformResult => {
    const content = c.document.getText();
    // Clear disableSqlAutoDetect flag if present (user is manually converting back)
    const metadata = { ...(c.metadata || {}) } as Record<string, unknown>;
    delete metadata.disableSqlAutoDetect;

    return {
      content: addMagicToContent(content, magicCommand),
      languageId,
      metadata: {
        ...metadata,
        databricksType: MAGIC_TO_CELL_TYPE[magicCommand] || 'code',
      },
    };
  }, {
    enterEditMode: true,
    moveCursorToEnd: true,
    trackingKey: cellKey,
    trackingSet,
  });
}

/**
 * Handle newly added cells to ensure magic commands are present.
 * @param notebook - The notebook document
 * @param cell - The newly added cell
 * @param trackingSet - Set to track processed cells
 */
export async function handleNewCell(
  notebook: vscode.NotebookDocument,
  cell: vscode.NotebookCell,
  trackingSet: Set<string>
): Promise<void> {
  // Only process code cells
  if (cell.kind !== vscode.NotebookCellKind.Code) {
    return;
  }

  const languageId = cell.document.languageId;
  const content = cell.document.getText().trim();
  const cellKey = cell.document.uri.toString();

  // Skip if already processed
  if (trackingSet.has(cellKey)) {
    return;
  }

  const requiredMagic = LANGUAGE_TO_MAGIC[languageId];

  // If language requires magic command and content doesn't have it
  if (requiredMagic && !contentStartsWithMagic(content, requiredMagic)) {
    await ensureMagicCommand(notebook, cell, requiredMagic, languageId, trackingSet);
  }
}

/**
 * Remove magic command from cell content when language is changed away from magic-command language.
 * @param notebook - The notebook document
 * @param cell - The cell to update
 * @param magicCommand - The magic command to remove (e.g., '%sql')
 * @param languageId - The target language ID
 * @param trackingSet - Set to track processed cells
 */
export async function removeMagicCommand(
  notebook: vscode.NotebookDocument,
  cell: vscode.NotebookCell,
  magicCommand: string,
  languageId: string,
  trackingSet: Set<string>
): Promise<void> {
  const cellKey = cell.document.uri.toString();

  await modifyCell(notebook, cell, (c): CellTransformResult => {
    const content = c.document.getText();

    return {
      content: removeMagicFromContent(content, magicCommand),
      languageId,
      metadata: {
        ...c.metadata,
        databricksType: 'code', // Reset to Python/code type
      },
    };
  }, {
    enterEditMode: true,
    trackingKey: cellKey,
    trackingSet,
  });
}

/**
 * Convert a Python cell to a magic-command language (SQL, Scala, R, Shell).
 * Called when user manually types magic command or changes language via UI.
 * @param notebook - The notebook document
 * @param cell - The cell to convert
 * @param languageId - The target language ID
 * @param magicCommand - The magic command (e.g., '%sql')
 * @param trackingSet - Set to track processed cells
 */
export async function convertCellToLanguage(
  notebook: vscode.NotebookDocument,
  cell: vscode.NotebookCell,
  languageId: string,
  magicCommand: string,
  trackingSet: Set<string>
): Promise<void> {
  const cellKey = cell.document.uri.toString();

  await modifyCell(notebook, cell, (c): CellTransformResult => {
    const content = c.document.getText();
    // Clear disableSqlAutoDetect flag and set appropriate databricksType
    const metadata = { ...(c.metadata || {}) } as Record<string, unknown>;
    delete metadata.disableSqlAutoDetect;

    return {
      content,
      languageId,
      metadata: {
        ...metadata,
        databricksType: MAGIC_TO_CELL_TYPE[magicCommand] || 'code',
      },
    };
  }, {
    enterEditMode: true,
    trackingKey: cellKey,
    trackingSet,
  });
}

/**
 * Convert a magic-command language cell back to Python.
 * Called when user removes the magic command from a cell (e.g., deletes %sql from SQL cell).
 * @param notebook - The notebook document
 * @param cell - The cell to convert
 * @param content - The current cell content (without magic command)
 * @param trackingSet - Set to track processed cells
 */
export async function convertToPythonCell(
  notebook: vscode.NotebookDocument,
  cell: vscode.NotebookCell,
  content: string,
  trackingSet: Set<string>
): Promise<void> {
  const cellKey = cell.document.uri.toString();

  await modifyCell(notebook, cell, (c): CellTransformResult => {
    // Set disableSqlAutoDetect flag to prevent SQL auto-detection from re-adding %sql
    // when user types. This flag persists across cell replacements (unlike autoDetectedCells
    // Set which tracks by URI that changes on replacement). The flag is cleared when content
    // no longer contains SQL keywords, allowing auto-detect to work again for fresh SQL.
    return {
      content,
      languageId: 'python',
      metadata: {
        ...c.metadata,
        databricksType: 'code',
        disableSqlAutoDetect: true,
      },
    };
  }, {
    enterEditMode: true,
    trackingKey: cellKey,
    trackingSet,
  });
}

/**
 * Clear the disableSqlAutoDetect flag from cell metadata.
 * Called when content no longer starts with SQL keywords, allowing future auto-detect.
 * @param notebook - The notebook document
 * @param cell - The cell to update
 */
export async function clearDisableSqlAutoDetectFlag(
  notebook: vscode.NotebookDocument,
  cell: vscode.NotebookCell
): Promise<void> {
  await modifyCell(notebook, cell, (c): CellTransformResult => {
    const content = c.document.getText();
    const languageId = c.document.languageId;

    // Copy metadata but remove the disableSqlAutoDetect flag
    const metadata = { ...(c.metadata || {}) } as Record<string, unknown>;
    delete metadata.disableSqlAutoDetect;

    return {
      content,
      languageId,
      metadata,
    };
  }, {
    enterEditMode: true,
  });
}
