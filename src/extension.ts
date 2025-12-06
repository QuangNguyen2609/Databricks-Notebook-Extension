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
import { ProfileManager } from './databricks/profileManager';
import { DatabricksStatusBar } from './databricks/statusBar';
import { NotebookDiagnosticProvider } from './linting';
import {
  DATABRICKS_NOTEBOOK_HEADER,
  LANGUAGE_TO_MAGIC,
  SORTED_MAGIC_COMMANDS,
  MAGIC_TO_CELL_TYPE,
  SQL_KEYWORDS_REGEX,
  contentStartsWithMagic,
} from './constants';
import {
  modifyCell,
  addMagicToContent,
  removeMagicFromContent,
  CellTransformResult,
} from './utils/cellEditor';
import {
  findTextEditorTab,
  findNotebookTab,
  isInDiffTab,
  replaceTabWithView,
} from './utils/tabManager';

// Global kernel manager instance
let kernelManager: KernelManager | undefined;

// Global catalog service for SQL intellisense
let catalogService: CatalogService | undefined;

// Global profile manager for Databricks authentication
let profileManager: ProfileManager | undefined;

// Track documents currently being processed to avoid race conditions
const processingDocuments = new Set<string>();

// Track URIs currently being viewed as raw text (session-based)
// This prevents auto-open from re-opening them as notebooks during the same session
const viewingAsRawText = new Set<string>();

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

  // Initialize ProfileManager and KernelManager in parallel for faster startup
  profileManager = new ProfileManager(context);
  context.subscriptions.push(profileManager);

  kernelManager = new KernelManager(context.extensionPath, profileManager);
  context.subscriptions.push(kernelManager);

  // Run profile loading and kernel initialization concurrently
  const [profileLoadResult, kernelInitResult] = await Promise.allSettled([
    profileManager.loadProfiles(),
    kernelManager.initialize()
  ]);

  // Handle profile loading result
  if (profileLoadResult.status === 'rejected') {
    console.error('Failed to load profiles:', profileLoadResult.reason);
  }

  // Handle kernel initialization result
  if (kernelInitResult.status === 'fulfilled') {
    console.log(`Kernel manager initialized with ${kernelManager?.getControllerCount()} controllers`);
  } else {
    console.error('Failed to initialize kernel manager:', kernelInitResult.reason);
    // Non-fatal error - continue without kernel support
  }

  // Initialize Status Bar (if enabled in settings)
  const config = vscode.workspace.getConfiguration('databricks-notebook');
  if (config.get<boolean>('showProfileInStatusBar', true)) {
    const statusBar = new DatabricksStatusBar(profileManager);
    context.subscriptions.push(statusBar);
  }

  // Register profile selection commands
  context.subscriptions.push(
    vscode.commands.registerCommand('databricks-notebook.selectProfile', async () => {
      if (profileManager) {
        await showProfileQuickPick(profileManager);
      }
    }),
    vscode.commands.registerCommand('databricks-notebook.refreshProfiles', async () => {
      if (profileManager) {
        await profileManager.loadProfiles();
        vscode.window.showInformationMessage('Databricks profiles refreshed');
      }
    })
  );

  // Initialize cross-cell linting provider
  try {
    const lintingProvider = new NotebookDiagnosticProvider(context);
    context.subscriptions.push(lintingProvider);
    console.log('Cross-cell linting provider initialized');
  } catch (error) {
    console.error('Failed to initialize linting provider:', error);
    // Non-fatal error - continue without linting
  }

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
    vscode.workspace.onDidChangeNotebookDocument(async (event) => {
      try {
        await handleNotebookCellChanges(event);
      } catch (err) {
        console.error('[Notebook Change] Failed to handle notebook change event:', err);
      }
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

  // Open as notebook - close existing text editor first for unified tab experience
  try {
    const tabInfo = findTextEditorTab(fileUri.toString());
    await replaceTabWithView(fileUri, tabInfo, 'databricks-notebook');
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

  try {
    const tabInfo = findNotebookTab(uriString);
    await replaceTabWithView(fileUri, tabInfo, 'default');
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
  return firstLine === DATABRICKS_NOTEBOOK_HEADER;
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
  if (isInDiffTab(document.uri.toString())) {
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
      // Use replaceTabWithView for unified close-then-open pattern
      const tabInfo = findTextEditorTab(uriString);
      await replaceTabWithView(document.uri, tabInfo, 'databricks-notebook');
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
        // Use replaceTabWithView for unified close-then-open pattern
        const tabInfo = findTextEditorTab(uriString);
        await replaceTabWithView(document.uri, tabInfo, 'databricks-notebook');
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

// Track cells that have been auto-detected to avoid repeated changes
// Uses cell document URI which is stable across index changes
const autoDetectedCells = new Set<string>();

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
    trackingSet: autoDetectedCells,
  });
}

/**
 * Handle newly added cells to ensure magic commands are present
 * @param notebook - The notebook document
 * @param cell - The newly added cell
 */
async function handleNewCell(notebook: vscode.NotebookDocument, cell: vscode.NotebookCell): Promise<void> {
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
  if (requiredMagic && !contentStartsWithMagic(content, requiredMagic)) {
    await ensureMagicCommand(notebook, cell, requiredMagic, languageId);
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
    trackingSet: autoDetectedCells,
  });
}

/**
 * Convert a Python cell to a magic-command language (SQL, Scala, R, Shell)
 * Called when user manually types magic command or changes language via UI
 * @param notebook - The notebook document
 * @param cell - The cell to convert
 * @param languageId - The target language ID
 * @param magicCommand - The magic command (e.g., '%sql')
 */
async function convertCellToLanguage(
  notebook: vscode.NotebookDocument,
  cell: vscode.NotebookCell,
  languageId: string,
  magicCommand: string
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
    trackingSet: autoDetectedCells,
  });
}

/**
 * Convert a magic-command language cell back to Python
 * Called when user removes the magic command from a cell (e.g., deletes %sql from SQL cell)
 * @param notebook - The notebook document
 * @param cell - The cell to convert
 * @param content - The current cell content (without magic command)
 */
async function convertToPythonCell(
  notebook: vscode.NotebookDocument,
  cell: vscode.NotebookCell,
  content: string
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
    trackingSet: autoDetectedCells,
  });
}

/**
 * Clear the disableSqlAutoDetect flag from cell metadata
 * Called when content no longer starts with SQL keywords, allowing future auto-detect
 * @param notebook - The notebook document
 * @param cell - The cell to update
 */
async function clearDisableSqlAutoDetectFlag(
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

/**
 * Handle cell content or language changes
 * @param notebook - The notebook document
 * @param change - The cell change event
 */
async function handleCellContentChange(
  notebook: vscode.NotebookDocument,
  change: { cell: vscode.NotebookCell; document?: vscode.TextDocument; metadata?: unknown; outputs?: unknown }
): Promise<void> {
  const cell = change.cell;

  // Only process code cells
  if (cell.kind !== vscode.NotebookCellKind.Code) {
    return;
  }

  const cellKey = cell.document.uri.toString();
  const languageId = cell.document.languageId;
  const content = cell.document.getText().trim();

  const requiredMagic = LANGUAGE_TO_MAGIC[languageId];

  // Handle magic-command language cells (SQL, Scala, R, Shell) without magic command
  // This happens when: 1) user changes language via picker, 2) user manually removes magic
  if (requiredMagic && !contentStartsWithMagic(content, requiredMagic)) {
    // Skip if we just processed this cell to avoid infinite loops
    if (autoDetectedCells.has(cellKey)) {
      return;
    }

    // If disableSqlAutoDetect flag is set, user is converting back to SQL via language picker
    // Add the magic command and clear the flag
    if (cell.metadata?.disableSqlAutoDetect === true) {
      await ensureMagicCommand(notebook, cell, requiredMagic, languageId);
      return;
    }

    // If cell has content but no magic command, user manually deleted it
    // Convert back to Python
    if (content.length > 0) {
      await convertToPythonCell(notebook, cell, content);
      return;
    }

    // Otherwise, it's a fresh/empty cell via language picker
    // Add the magic command
    await ensureMagicCommand(notebook, cell, requiredMagic, languageId);
    return;
  }

  // Handle language change FROM magic-command language to Python
  // If language is now Python but content still has a magic command, handle it
  if (languageId === 'python' && !autoDetectedCells.has(cellKey)) {
    // Check if content starts with any magic command
    // Use sorted list (longest first) to prevent %r matching %run
    for (const magic of SORTED_MAGIC_COMMANDS) {
      if (contentStartsWithMagic(content, magic)) {
        // If user manually added magic command (disableSqlAutoDetect flag is set),
        // convert to the appropriate language immediately
        if (cell.metadata?.disableSqlAutoDetect === true) {
          const targetLanguage = magic === '%sql' ? 'sql' : magic === '%scala' ? 'scala' : magic === '%r' ? 'r' : 'shellscript';
          await convertCellToLanguage(notebook, cell, targetLanguage, magic);
          return;
        }
        // Otherwise, remove the magic command (language was changed to Python)
        await removeMagicCommand(notebook, cell, magic, languageId);
        return;
      }
    }

    // Check if SQL auto-detect is disabled for this cell (user explicitly removed %sql)
    const disableSqlAutoDetect = cell.metadata?.disableSqlAutoDetect === true;
    const hasSqlKeywords = SQL_KEYWORDS_REGEX.test(content);

    if (disableSqlAutoDetect) {
      // Skip auto-detect while flag is set (user is editing the converted cell).
      // Don't clear the flag during typing to avoid disruptive cell replacements.
      // The flag will be cleared when cell is empty or notebook is reloaded.
      if (content.length === 0) {
        await clearDisableSqlAutoDetectFlag(notebook, cell);
      }
      return;
    }

    // Auto-detect SQL in Python cells (existing functionality)
    if (hasSqlKeywords) {
      await ensureMagicCommand(notebook, cell, '%sql', 'sql');
    }
  }
}

/**
 * Handle notebook cell content changes for auto-detection
 * @param event - The notebook document change event
 */
async function handleNotebookCellChanges(event: vscode.NotebookDocumentChangeEvent): Promise<void> {
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

  // 2. Handle newly added cells (for magic command injection) - process in parallel
  const addedCellPromises: Promise<void>[] = [];
  for (const contentChange of event.contentChanges) {
    for (const addedCell of contentChange.addedCells) {
      addedCellPromises.push(handleNewCell(event.notebook, addedCell));
    }
  }
  await Promise.all(addedCellPromises);

  // 3. Process cell content/language changes - process in parallel
  const changePromises = event.cellChanges.map((change) =>
    handleCellContentChange(event.notebook, change)
  );
  await Promise.all(changePromises);
}

/**
 * Show Quick Pick to select Databricks profile
 */
async function showProfileQuickPick(manager: ProfileManager): Promise<void> {
  const profiles = manager.getAllProfiles();

  if (profiles.length === 0) {
    vscode.window.showInformationMessage(
      'No Databricks profiles found in ~/.databrickscfg. Run "databricks auth login" to configure authentication.'
    );
    return;
  }

  const currentName = manager.getSelectedProfileName();

  // Create Quick Pick items
  const items: (vscode.QuickPickItem & { profileName?: string })[] = profiles.map(p => ({
    label: p.name === currentName ? `$(check) ${p.name}` : p.name,
    description: p.host,
    detail: p.authType ? `Auth: ${p.authType}` : undefined,
    profileName: p.name
  }));

  // Add separator and refresh option
  items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
  items.push({
    label: '$(refresh) Refresh Profiles',
    description: 'Re-read ~/.databrickscfg'
  });

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select Databricks profile',
    title: 'Databricks Profile'
  });

  if (selected?.profileName) {
    await manager.selectProfile(selected.profileName);
  } else if (selected?.label.includes('Refresh')) {
    await manager.loadProfiles();
    vscode.window.showInformationMessage('Databricks profiles refreshed');
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

  // Profile manager is disposed via context.subscriptions, but clear reference
  profileManager = undefined;
}
