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

// Global kernel manager instance
let kernelManager: KernelManager | undefined;

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

  // Register kernel-related commands
  kernelManager.registerCommands(context);

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

  // Open as notebook
  try {
    await vscode.commands.executeCommand('vscode.openWith', fileUri, 'databricks-notebook');
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
const autoDetectedCells = new Set<string>();

/**
 * Handle notebook cell content changes for auto-detection
 * @param event - The notebook document change event
 */
function handleNotebookCellChanges(event: vscode.NotebookDocumentChangeEvent): void {
  // Only process our notebook type
  if (event.notebook.notebookType !== 'databricks-notebook') {
    return;
  }

  // Process cell content changes
  for (const change of event.cellChanges) {
    const cell = change.cell;

    // Only auto-detect for code cells that are currently Python
    if (cell.kind !== vscode.NotebookCellKind.Code) {
      continue;
    }

    // Skip if already auto-detected
    const cellKey = `${event.notebook.uri.toString()}:${cell.index}`;
    if (autoDetectedCells.has(cellKey)) {
      continue;
    }

    // Check if cell language is Python (or hasn't been explicitly set)
    const languageId = cell.document.languageId;
    if (languageId !== 'python') {
      continue;
    }

    // Get the cell content
    const content = cell.document.getText().trim();

    // Check if content starts with SQL keywords
    if (SQL_KEYWORDS_REGEX.test(content)) {
      // Mark as auto-detected to avoid repeated changes
      autoDetectedCells.add(cellKey);

      const cellIndex = cell.index;

      // Create a workspace edit to update both content and metadata
      const edit = new vscode.WorkspaceEdit();

      // Update cell metadata
      const metadataEdit = vscode.NotebookEdit.updateCellMetadata(
        cellIndex,
        {
          ...cell.metadata,
          databricksType: 'sql',
        }
      );

      // Prepend %sql to the content
      const newContent = `%sql\n${content}`;
      const contentEdit = vscode.NotebookEdit.replaceCells(
        new vscode.NotebookRange(cellIndex, cellIndex + 1),
        [new vscode.NotebookCellData(
          vscode.NotebookCellKind.Code,
          newContent,
          'sql'
        )]
      );
      edit.set(event.notebook.uri, [metadataEdit, contentEdit]);

      // Apply all edits and restore focus
      vscode.workspace.applyEdit(edit).then((success) => {
        if (success) {
          // Restore focus to the cell and enter edit mode
          const notebookEditor = vscode.window.activeNotebookEditor;
          if (notebookEditor && notebookEditor.notebook.uri.toString() === event.notebook.uri.toString()) {
            // Select the cell and enter edit mode
            notebookEditor.selections = [new vscode.NotebookRange(cellIndex, cellIndex + 1)];
            vscode.commands.executeCommand('notebook.cell.edit');
          }
        }
      });
    }
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

  // Kernel manager is disposed via context.subscriptions, but clear reference
  kernelManager = undefined;
}
