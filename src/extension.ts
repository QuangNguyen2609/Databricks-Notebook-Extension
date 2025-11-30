/**
 * Databricks Notebook Viewer - VS Code Extension
 *
 * This extension provides notebook visualization for Databricks .py files,
 * rendering them with proper cell separation, markdown rendering, and
 * syntax highlighting for various languages (Python, SQL, Scala, R, etc.)
 */

import * as vscode from 'vscode';
import { DatabricksNotebookSerializer, checkIsDatabricksNotebook } from './serializer';
import { KernelManager } from './kernels';
import { CatalogService, SqlCompletionProvider, SqlContextParser } from './intellisense';

// Global kernel manager instance
let kernelManager: KernelManager | undefined;

// Global catalog service for SQL intellisense
let catalogService: CatalogService | undefined;

// Track documents currently being processed to avoid race conditions
const processingDocuments = new Set<string>();

// Track URIs currently being viewed as raw text (session-based)
// This prevents auto-open from re-opening them as notebooks during the same session
const viewingAsRawText = new Set<string>();

// Databricks notebook header constant
const DATABRICKS_HEADER = '# Databricks notebook source';

/**
 * Extension activation
 * Called when VS Code activates the extension
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('Databricks Notebook Viewer is now active');

  // Register the notebook serializer
  context.subscriptions.push(
    vscode.workspace.registerNotebookSerializer(
      'databricks-notebook',
      new DatabricksNotebookSerializer(),
      {
        transientOutputs: true,
      }
    )
  );

  // Initialize kernel manager for Python execution support
  kernelManager = new KernelManager(context.extensionPath);
  context.subscriptions.push(kernelManager);

  // Initialize asynchronously (discovers Python environments)
  kernelManager.initialize().then(() => {
    console.log(`Kernel manager initialized with ${kernelManager?.getControllerCount()} controllers`);
  }).catch((error) => {
    console.error('Failed to initialize kernel manager:', error);
  });

  // Initialize SQL intellisense for catalog/schema/table completion
  catalogService = new CatalogService(() => kernelManager?.getActiveExecutor() ?? null);

  // Register kernel-related commands (with callback to clear catalog cache on restart)
  kernelManager.registerCommands(context, () => {
    catalogService?.clearCache();
  });
  const sqlParser = new SqlContextParser();
  const sqlCompletionProvider = new SqlCompletionProvider(catalogService, sqlParser);

  // Register completion provider for SQL in notebook cells
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'sql', scheme: 'vscode-notebook-cell' },
      sqlCompletionProvider,
      '.' // Trigger on dot for schema.table completion
    )
  );

  // Command to refresh catalog cache manually
  context.subscriptions.push(
    vscode.commands.registerCommand('databricks-notebook.refreshCatalogCache', () => {
      catalogService?.clearCache();
      vscode.window.showInformationMessage('Catalog cache cleared. Will refresh on next completion.');
    })
  );

  // Register command to open .py file as Databricks notebook
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'databricks-notebook.openAsNotebook',
      async (uri?: vscode.Uri) => {
        await openAsNotebook(uri);
      }
    )
  );

  // Register command to view notebook as raw text (View Source)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'databricks-notebook.openAsText',
      async (uri?: vscode.Uri) => {
        await openAsRawText(uri);
      }
    )
  );

  // Clear viewingAsRawText flag when text editor tab is closed
  // This allows the file to be auto-opened as notebook when reopened
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs((event) => {
      for (const closedTab of event.closed) {
        if (closedTab.input instanceof vscode.TabInputText) {
          viewingAsRawText.delete(closedTab.input.uri.toString());
        }
      }
    })
  );

  // Auto-detect Databricks notebooks when opening .py files
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (document) => {
      await handleDocumentOpen(document);
    })
  );

  // Auto-detect SQL cells based on content (SELECT, INSERT, etc.)
  context.subscriptions.push(
    vscode.workspace.onDidChangeNotebookDocument((event) => {
      handleNotebookCellChanges(event);
    })
  );

  // Clean up autoDetectedCells when notebook is closed to prevent memory leaks
  context.subscriptions.push(
    vscode.workspace.onDidCloseNotebookDocument((notebook) => {
      if (notebook.notebookType !== 'databricks-notebook') {
        return;
      }
      // Clean up entries for this notebook by matching the notebook path in cell URIs
      const notebookPath = notebook.uri.fsPath;
      for (const key of autoDetectedCells) {
        if (key.includes(notebookPath)) {
          autoDetectedCells.delete(key);
        }
      }
    })
  );
}

/**
 * Handle the "Open as Databricks Notebook" command
 * @param uri - The file URI to open (optional, uses active editor if not provided)
 */
async function openAsNotebook(uri?: vscode.Uri): Promise<void> {
  // Get URI from context or active editor
  const fileUri = uri || vscode.window.activeTextEditor?.document.uri;

  if (!fileUri) {
    vscode.window.showErrorMessage('No file selected');
    return;
  }

  // Check if it's actually a Databricks notebook
  const isDatabricks = await checkIsDatabricksNotebook(fileUri);

  if (!isDatabricks) {
    const result = await vscode.window.showWarningMessage(
      'This file does not appear to be a Databricks notebook. Open anyway?',
      'Yes',
      'No'
    );
    if (result !== 'Yes') {
      return;
    }
  }

  const uriString = fileUri.toString();

  // Open as notebook - close existing text editor first for unified tab experience
  try {
    // Find the current text editor tab to get view column and close it
    const tabInfo = findTextEditorTab(uriString);
    const viewColumn = tabInfo?.viewColumn || vscode.ViewColumn.Active;

    // Close the text editor tab first to avoid two tabs
    if (tabInfo) {
      await vscode.window.tabGroups.close(tabInfo.tab);
    }

    // Open notebook in the same view column
    await vscode.commands.executeCommand(
      'vscode.openWith',
      fileUri,
      'databricks-notebook',
      viewColumn
    );
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to open notebook: ${error}`);
  }
}

/**
 * Handle the "View Source" command - open notebook as raw text
 * @param uri - The file URI to open (optional, uses active notebook if not provided)
 */
async function openAsRawText(uri?: vscode.Uri): Promise<void> {
  // Get URI from parameter or active notebook editor
  const fileUri = uri || vscode.window.activeNotebookEditor?.notebook.uri;

  if (!fileUri) {
    vscode.window.showErrorMessage('No notebook selected');
    return;
  }

  const uriString = fileUri.toString();

  // Mark this URI as being viewed as raw text (session-based)
  // This is cleared when the text editor tab is closed
  viewingAsRawText.add(uriString);

  // Find the current notebook tab to get view column
  const tabInfo = findNotebookTab(uriString);
  const viewColumn = tabInfo?.viewColumn || vscode.ViewColumn.Active;

  try {
    // Close the notebook tab first (same pattern as openAsNotebook)
    if (tabInfo) {
      await vscode.window.tabGroups.close(tabInfo.tab);
    }

    // Open as default text editor
    // Using 'default' as the editor ID opens with the standard text editor
    await vscode.commands.executeCommand(
      'vscode.openWith',
      fileUri,
      'default',
      viewColumn
    );
  } catch (error) {
    // Clean up on error
    viewingAsRawText.delete(uriString);
    vscode.window.showErrorMessage(`Failed to open as text: ${error}`);
  }
}

/**
 * Quick synchronous check if document is a Databricks notebook
 * Uses document content already in memory - much faster than file I/O
 * @param document - The text document to check
 * @returns true if it's a Databricks notebook
 */
function isDatabricksNotebookSync(document: vscode.TextDocument): boolean {
  if (document.lineCount === 0) {
    return false;
  }
  const firstLine = document.lineAt(0).text.trim();
  return firstLine === DATABRICKS_HEADER;
}

/**
 * Find the tab and view column for a text document
 * @param uriString - The URI string of the document
 * @returns Object with tab and viewColumn, or null if not found
 */
function findTextEditorTab(uriString: string): { tab: vscode.Tab; viewColumn: vscode.ViewColumn } | null {
  for (const tabGroup of vscode.window.tabGroups.all) {
    for (const tab of tabGroup.tabs) {
      if (
        tab.input instanceof vscode.TabInputText &&
        tab.input.uri.toString() === uriString
      ) {
        return { tab, viewColumn: tabGroup.viewColumn };
      }
    }
  }
  return null;
}

/**
 * Find the tab and view column for a notebook document
 * @param uriString - The URI string of the document
 * @returns Object with tab and viewColumn, or null if not found
 */
function findNotebookTab(uriString: string): { tab: vscode.Tab; viewColumn: vscode.ViewColumn } | null {
  for (const tabGroup of vscode.window.tabGroups.all) {
    for (const tab of tabGroup.tabs) {
      if (
        tab.input instanceof vscode.TabInputNotebook &&
        tab.input.uri.toString() === uriString
      ) {
        return { tab, viewColumn: tabGroup.viewColumn };
      }
    }
  }
  return null;
}

/**
 * Handle document open event to detect Databricks notebooks
 * Seamlessly replaces text editor with notebook view
 * @param document - The opened document
 */
async function handleDocumentOpen(document: vscode.TextDocument): Promise<void> {
  // Only check Python files
  if (document.languageId !== 'python' || !document.fileName.endsWith('.py')) {
    return;
  }

  // Skip non-file URIs (git diffs, etc.) - only auto-open actual file:// URIs
  if (document.uri.scheme !== 'file') {
    return;
  }

  // Skip if opened in a diff editor tab
  const isDiffTab = vscode.window.tabGroups.all.some(group =>
    group.tabs.some(tab =>
      (tab.input instanceof vscode.TabInputTextDiff || tab.input instanceof vscode.TabInputNotebookDiff) &&
      (tab.input.original.toString() === document.uri.toString() ||
       tab.input.modified.toString() === document.uri.toString())
    )
  );
  if (isDiffTab) {
    return;
  }

  const uriString = document.uri.toString();

  // Skip if already processing this document (avoid race conditions)
  if (processingDocuments.has(uriString)) {
    return;
  }

  // Skip if user explicitly chose to view as raw text
  if (viewingAsRawText.has(uriString)) {
    return;
  }

  // Quick synchronous check - uses document content already in memory
  if (!isDatabricksNotebookSync(document)) {
    return;
  }

  // Get configuration
  const config = vscode.workspace.getConfiguration('databricks-notebook');
  const autoOpen = config.get<boolean>('autoOpenNotebooks', false);
  const showNotification = config.get<boolean>('showNotification', true);

  if (autoOpen) {
    // Mark as processing to prevent duplicate handling
    processingDocuments.add(uriString);

    try {
      // Find the current tab info before closing
      const tabInfo = findTextEditorTab(uriString);
      const viewColumn = tabInfo?.viewColumn || vscode.ViewColumn.Active;

      // IMPORTANT: Close text editor FIRST to avoid two tabs being visible
      if (tabInfo) {
        await vscode.window.tabGroups.close(tabInfo.tab);
      }

      // Open notebook in the same view column
      await vscode.commands.executeCommand(
        'vscode.openWith',
        document.uri,
        'databricks-notebook',
        viewColumn
      );
    } finally {
      // Clear processing flag after a delay to handle any remaining events
      setTimeout(() => {
        processingDocuments.delete(uriString);
      }, 500);
    }
  } else if (showNotification) {
    // Mark as processing
    processingDocuments.add(uriString);

    try {
      // Show notification
      const action = await vscode.window.showInformationMessage(
        'This appears to be a Databricks notebook. Would you like to open it as a notebook?',
        'Open as Notebook',
        'Keep as Python',
        "Don't ask again"
      );

      if (action === 'Open as Notebook') {
        // Find the current tab info
        const tabInfo = findTextEditorTab(uriString);
        const viewColumn = tabInfo?.viewColumn || vscode.ViewColumn.Active;

        // Close text editor first
        if (tabInfo) {
          await vscode.window.tabGroups.close(tabInfo.tab);
        }

        // Open notebook
        await vscode.commands.executeCommand(
          'vscode.openWith',
          document.uri,
          'databricks-notebook',
          viewColumn
        );
      } else if (action === "Don't ask again") {
        await config.update('showNotification', false, vscode.ConfigurationTarget.Global);
      }
    } finally {
      // Clear processing flag after a delay
      setTimeout(() => {
        processingDocuments.delete(uriString);
      }, 500);
    }
  }
}

// SQL keywords that trigger auto-detection
const SQL_KEYWORDS_REGEX = /^(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|WITH|MERGE|TRUNCATE|EXPLAIN|DESCRIBE|SHOW|USE)\b/i;

// Track cells that have been auto-detected to avoid repeated changes
// Uses cell document URI which is stable across index changes
const autoDetectedCells = new Set<string>();

// Map language IDs to their required magic commands
const LANGUAGE_TO_MAGIC: Record<string, string> = {
  'sql': '%sql',
  'scala': '%scala',
  'r': '%r',
  'shellscript': '%sh',
};

// Map magic commands to Databricks cell types
const MAGIC_TO_TYPE: Record<string, string> = {
  '%sql': 'sql',
  '%scala': 'scala',
  '%r': 'r',
  '%sh': 'shell',
};

/**
 * Ensure a cell has the required magic command in its content
 * @param notebook - The notebook document
 * @param cell - The cell to update
 * @param magicCommand - The magic command to ensure (e.g., '%sql')
 * @param languageId - The target language ID
 */
async function ensureMagicCommand(
  notebook: vscode.NotebookDocument,
  cell: vscode.NotebookCell,
  magicCommand: string,
  languageId: string
): Promise<void> {
  const content = cell.document.getText();
  const cellKey = cell.document.uri.toString();
  const cellIndex = cell.index;

  // Mark as processed to prevent infinite loops
  autoDetectedCells.add(cellKey);

  // Build new content with magic command
  const newContent = content.trim()
    ? `${magicCommand}\n${content}`
    : magicCommand;

  const edit = new vscode.WorkspaceEdit();

  const cellData = new vscode.NotebookCellData(
    vscode.NotebookCellKind.Code,
    newContent,
    languageId
  );

  cellData.metadata = {
    ...cell.metadata,
    databricksType: MAGIC_TO_TYPE[magicCommand] || 'code',
  };

  edit.set(notebook.uri, [
    vscode.NotebookEdit.replaceCells(
      new vscode.NotebookRange(cellIndex, cellIndex + 1),
      [cellData]
    )
  ]);

  const success = await vscode.workspace.applyEdit(edit);

  if (success) {
    // Restore cursor to the cell and enter edit mode
    const notebookEditor = vscode.window.activeNotebookEditor;
    if (notebookEditor && notebookEditor.notebook.uri.toString() === notebook.uri.toString()) {
      notebookEditor.selections = [new vscode.NotebookRange(cellIndex, cellIndex + 1)];
      vscode.commands.executeCommand('notebook.cell.edit');
    }
  }
}

/**
 * Handle newly added cells to ensure magic commands are present
 * @param notebook - The notebook document
 * @param cell - The newly added cell
 */
function handleNewCell(notebook: vscode.NotebookDocument, cell: vscode.NotebookCell): void {
  // Only process code cells
  if (cell.kind !== vscode.NotebookCellKind.Code) {
    return;
  }

  const languageId = cell.document.languageId;
  const content = cell.document.getText().trim();
  const cellKey = cell.document.uri.toString();

  // Skip if already processed
  if (autoDetectedCells.has(cellKey)) {
    return;
  }

  const requiredMagic = LANGUAGE_TO_MAGIC[languageId];

  // If language requires magic command and content doesn't have it
  if (requiredMagic && !content.startsWith(requiredMagic)) {
    ensureMagicCommand(notebook, cell, requiredMagic, languageId);
  }
}

/**
 * Remove magic command from cell content when language is changed away from magic-command language
 * @param notebook - The notebook document
 * @param cell - The cell to update
 * @param magicCommand - The magic command to remove (e.g., '%sql')
 * @param languageId - The target language ID
 */
async function removeMagicCommand(
  notebook: vscode.NotebookDocument,
  cell: vscode.NotebookCell,
  magicCommand: string,
  languageId: string
): Promise<void> {
  const content = cell.document.getText();
  const cellKey = cell.document.uri.toString();
  const cellIndex = cell.index;

  // Mark as processed to prevent infinite loops
  autoDetectedCells.add(cellKey);

  // Remove the magic command from content
  // Handle both "%sql\n..." and "%sql" (just the command)
  let newContent = content;
  if (content.trim() === magicCommand) {
    newContent = '';
  } else if (content.startsWith(magicCommand + '\n')) {
    newContent = content.substring(magicCommand.length + 1);
  } else if (content.startsWith(magicCommand)) {
    // Handle case where there's content directly after magic (e.g., "%sqlSELECT")
    newContent = content.substring(magicCommand.length).trimStart();
  }

  const edit = new vscode.WorkspaceEdit();

  const cellData = new vscode.NotebookCellData(
    vscode.NotebookCellKind.Code,
    newContent,
    languageId
  );

  cellData.metadata = {
    ...cell.metadata,
    databricksType: 'code', // Reset to Python/code type
  };

  edit.set(notebook.uri, [
    vscode.NotebookEdit.replaceCells(
      new vscode.NotebookRange(cellIndex, cellIndex + 1),
      [cellData]
    )
  ]);

  const success = await vscode.workspace.applyEdit(edit);

  if (success) {
    // Restore cursor to the cell and enter edit mode
    const notebookEditor = vscode.window.activeNotebookEditor;
    if (notebookEditor && notebookEditor.notebook.uri.toString() === notebook.uri.toString()) {
      notebookEditor.selections = [new vscode.NotebookRange(cellIndex, cellIndex + 1)];
      vscode.commands.executeCommand('notebook.cell.edit');
    }
  }
}

/**
 * Handle cell content or language changes
 * @param notebook - The notebook document
 * @param change - The cell change event
 */
function handleCellContentChange(
  notebook: vscode.NotebookDocument,
  change: { cell: vscode.NotebookCell; document?: vscode.TextDocument; metadata?: unknown; outputs?: unknown }
): void {
  const cell = change.cell;

  // Only process code cells
  if (cell.kind !== vscode.NotebookCellKind.Code) {
    return;
  }

  const cellKey = cell.document.uri.toString();
  const languageId = cell.document.languageId;
  const content = cell.document.getText().trim();

  const requiredMagic = LANGUAGE_TO_MAGIC[languageId];

  // Handle language change TO magic-command language (e.g., user changed language picker to SQL)
  if (requiredMagic && !content.startsWith(requiredMagic) && !autoDetectedCells.has(cellKey)) {
    ensureMagicCommand(notebook, cell, requiredMagic, languageId);
    return;
  }

  // Handle language change FROM magic-command language to Python
  // If language is now Python but content still has a magic command, remove it
  if (languageId === 'python' && !autoDetectedCells.has(cellKey)) {
    // Check if content starts with any magic command that should be removed
    for (const [, magic] of Object.entries(LANGUAGE_TO_MAGIC)) {
      if (content.startsWith(magic)) {
        removeMagicCommand(notebook, cell, magic, languageId);
        return;
      }
    }

    // Auto-detect SQL in Python cells (existing functionality)
    if (SQL_KEYWORDS_REGEX.test(content)) {
      ensureMagicCommand(notebook, cell, '%sql', 'sql');
    }
  }
}

/**
 * Handle notebook cell content changes for auto-detection
 * @param event - The notebook document change event
 */
function handleNotebookCellChanges(event: vscode.NotebookDocumentChangeEvent): void {
  // Only process our notebook type
  if (event.notebook.notebookType !== 'databricks-notebook') {
    return;
  }

  // 1. Handle removed cells - cleanup tracking state
  for (const contentChange of event.contentChanges) {
    for (const removedCell of contentChange.removedCells) {
      autoDetectedCells.delete(removedCell.document.uri.toString());
    }
  }

  // 2. Handle newly added cells (for magic command injection)
  for (const contentChange of event.contentChanges) {
    for (const addedCell of contentChange.addedCells) {
      handleNewCell(event.notebook, addedCell);
    }
  }

  // 3. Process cell content/language changes
  for (const change of event.cellChanges) {
    handleCellContentChange(event.notebook, change);
  }
}

/**
 * Extension deactivation
 * Called when VS Code deactivates the extension
 */
export function deactivate(): void {
  console.log('Databricks Notebook Viewer is now deactivated');
  processingDocuments.clear();
  viewingAsRawText.clear();
  autoDetectedCells.clear();

  // Clear catalog cache
  catalogService?.clearCache();
  catalogService = undefined;

  // Kernel manager is disposed via context.subscriptions, but clear reference
  kernelManager = undefined;
}
