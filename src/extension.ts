/**
 * Databricks Notebook Studio - VS Code Extension
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
  MAGIC_TO_CELL_TYPE,
  MAGIC_TO_LANGUAGE,
  SORTED_MAGIC_COMMANDS,
  SQL_KEYWORDS_REGEX,
  contentStartsWithMagic,
} from './constants';
import {
  ensureMagicCommand,
  handleNewCell,
  removeMagicCommand,
  convertCellToLanguage,
  convertToPythonCell,
  clearDisableSqlAutoDetectFlag,
} from './utils/cellOperations';
import {
  findTextEditorTab,
  findNotebookTab,
  isInDiffTab,
  replaceTabWithView,
} from './utils/tabManager';
import { sessionState } from './utils/sessionState';

// Global kernel manager instance
let kernelManager: KernelManager | undefined;

// Global catalog service for SQL intellisense
let catalogService: CatalogService | undefined;

// Global profile manager for Databricks authentication
let profileManager: ProfileManager | undefined;

// ===== ACTIVATION HELPER FUNCTIONS =====

/**
 * Initialize ProfileManager and KernelManager with concurrent loading.
 * @param context - The extension context
 * @returns Object containing profileManager and kernelManager
 */
async function initializeManagers(
  context: vscode.ExtensionContext
): Promise<{ profileManager: ProfileManager; kernelManager: KernelManager }> {
  // Register the notebook serializer
  context.subscriptions.push(
    vscode.workspace.registerNotebookSerializer(
      'databricks-notebook',
      new DatabricksNotebookSerializer(),
      { transientOutputs: true }
    )
  );

  // Initialize ProfileManager and KernelManager
  const pm = new ProfileManager(context);
  context.subscriptions.push(pm);

  const km = new KernelManager(context.extensionPath, pm);
  context.subscriptions.push(km);

  // Run profile loading and kernel initialization concurrently
  const [profileLoadResult, kernelInitResult] = await Promise.allSettled([
    pm.loadProfiles(),
    km.initialize()
  ]);

  // Handle profile loading result
  if (profileLoadResult.status === 'rejected') {
    console.error('Failed to load profiles:', profileLoadResult.reason);
  }

  // Handle kernel initialization result
  if (kernelInitResult.status === 'fulfilled') {
    console.log(`Kernel manager initialized with ${km.getControllerCount()} controllers`);
  } else {
    console.error('Failed to initialize kernel manager:', kernelInitResult.reason);
    // Non-fatal error - continue without kernel support
  }

  return { profileManager: pm, kernelManager: km };
}

/**
 * Initialize Status Bar (if enabled in settings).
 * @param context - The extension context
 * @param pm - The profile manager
 */
function initializeStatusBar(
  context: vscode.ExtensionContext,
  pm: ProfileManager
): void {
  const config = vscode.workspace.getConfiguration('databricks-notebook');
  if (config.get<boolean>('showProfileInStatusBar', true)) {
    const statusBar = new DatabricksStatusBar(pm);
    context.subscriptions.push(statusBar);
  }
}

/**
 * Initialize SQL intellisense providers and catalog service.
 * @param context - The extension context
 * @param km - The kernel manager
 * @returns The initialized catalog service
 */
function initializeIntellisenseProviders(
  context: vscode.ExtensionContext,
  km: KernelManager
): CatalogService {
  // Initialize SQL intellisense for catalog/schema/table completion
  const cs = new CatalogService(() => km.getActiveExecutor() ?? null);

  // Register kernel-related commands (with callback to clear catalog cache on restart)
  km.registerCommands(context, () => {
    cs.clearCache();
  });

  const sqlParser = new SqlContextParser();
  const sqlCompletionProvider = new SqlCompletionProvider(cs, sqlParser);

  // Register completion provider for SQL in notebook cells
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'sql', scheme: 'vscode-notebook-cell' },
      sqlCompletionProvider,
      '.' // Trigger on dot for schema.table completion
    )
  );

  return cs;
}

/**
 * Initialize cross-cell linting provider.
 * @param context - The extension context
 */
function initializeLintingProvider(context: vscode.ExtensionContext): void {
  try {
    const lintingProvider = new NotebookDiagnosticProvider(context);
    context.subscriptions.push(lintingProvider);
    console.log('Cross-cell linting provider initialized');
  } catch (error) {
    console.error('Failed to initialize linting provider:', error);
    // Non-fatal error - continue without linting
  }
}

/**
 * Register profile selection commands.
 * @param context - The extension context
 * @param pm - The profile manager
 */
function registerProfileCommands(
  context: vscode.ExtensionContext,
  pm: ProfileManager
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('databricks-notebook.selectProfile', async () => {
      await showProfileQuickPick(pm);
    }),
    vscode.commands.registerCommand('databricks-notebook.refreshProfiles', async () => {
      await pm.loadProfiles();
      vscode.window.showInformationMessage('Databricks profiles refreshed');
    })
  );
}

/**
 * Register notebook-related commands (open as notebook, view source, refresh catalog).
 * @param context - The extension context
 * @param cs - The catalog service
 */
function registerNotebookCommands(
  context: vscode.ExtensionContext,
  cs: CatalogService
): void {
  // Command to refresh catalog cache manually
  context.subscriptions.push(
    vscode.commands.registerCommand('databricks-notebook.refreshCatalogCache', () => {
      cs.clearCache();
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
}

/**
 * Setup event listeners for document and notebook changes.
 * @param context - The extension context
 */
function setupEventListeners(context: vscode.ExtensionContext): void {
  // Clear viewing as raw text flag when text editor tab is closed
  // This allows the file to be auto-opened as notebook when reopened
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs((event) => {
      for (const closedTab of event.closed) {
        if (closedTab.input instanceof vscode.TabInputText) {
          sessionState.clearRawTextView(closedTab.input.uri.toString());
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

  // Clean up auto-detected cells when notebook is closed to prevent memory leaks
  context.subscriptions.push(
    vscode.workspace.onDidCloseNotebookDocument((notebook) => {
      if (notebook.notebookType !== 'databricks-notebook') {
        return;
      }
      // Clean up entries for this notebook
      sessionState.clearAutoDetectedForNotebook(notebook.uri.fsPath);
    })
  );
}

/**
 * Extension activation
 * Called when VS Code activates the extension
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('Databricks Notebook Studio is now active');

  // Initialize core components
  const managers = await initializeManagers(context);
  profileManager = managers.profileManager;
  kernelManager = managers.kernelManager;

  // Setup UI components
  initializeStatusBar(context, profileManager);

  // Initialize linting provider
  initializeLintingProvider(context);

  // Initialize intellisense providers
  catalogService = initializeIntellisenseProviders(context, kernelManager);

  // Register commands
  registerProfileCommands(context, profileManager);
  registerNotebookCommands(context, catalogService);

  // Setup event listeners
  setupEventListeners(context);
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
  sessionState.markAsRawText(uriString);

  try {
    const tabInfo = findNotebookTab(uriString);
    await replaceTabWithView(fileUri, tabInfo, 'default');
  } catch (error) {
    // Clean up on error
    sessionState.clearRawTextView(uriString);
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
  if (sessionState.isProcessing(uriString)) {
    return;
  }

  // Skip if user explicitly chose to view as raw text
  if (sessionState.isViewingAsRawText(uriString)) {
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
    // Mark as processing to prevent duplicate handling (auto-clears after timeout)
    sessionState.startProcessing(uriString);

    try {
      // Use replaceTabWithView for unified close-then-open pattern
      const tabInfo = findTextEditorTab(uriString);
      await replaceTabWithView(document.uri, tabInfo, 'databricks-notebook');
    } catch (error) {
      // Log error but let processing flag auto-clear via timeout
      console.error('[Extension] Failed to auto-open notebook:', error);
    }
  } else if (showNotification) {
    // Mark as processing (auto-clears after timeout)
    sessionState.startProcessing(uriString);

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
    } catch (error) {
      // Log error but let processing flag auto-clear via timeout
      console.error('[Extension] Failed during notification flow:', error);
    }
  }
}

// ===== CELL CONTENT CHANGE HANDLERS =====

// Get the auto-detected cells Set from sessionState for use with cellOperations utilities
const autoDetectedCells = sessionState.getAutoDetectedCells();

/**
 * Handle magic-command language cells (SQL, Scala, R, Shell) without magic command.
 * This happens when: 1) user changes language via picker, 2) user manually removes magic
 * @param notebook - The notebook document
 * @param cell - The cell to handle
 * @param cellKey - The cell's unique key (URI string)
 * @param content - The trimmed cell content
 * @param requiredMagic - The required magic command for this language
 * @param languageId - The cell's language ID
 */
async function handleMagicLanguageCell(
  notebook: vscode.NotebookDocument,
  cell: vscode.NotebookCell,
  cellKey: string,
  content: string,
  requiredMagic: string,
  languageId: string
): Promise<void> {
  // Skip if we just processed this cell to avoid infinite loops
  if (autoDetectedCells.has(cellKey)) {
    return;
  }

  // Use databricksType metadata to distinguish between:
  // 1. User changed language from Python to this language (databricksType is 'code' or undefined)
  // 2. User manually deleted the magic command (databricksType matches the current language)
  const databricksType = cell.metadata?.databricksType as string | undefined;
  const expectedType = MAGIC_TO_CELL_TYPE[requiredMagic];
  const wasMagicLanguageCell = databricksType === expectedType;

  if (wasMagicLanguageCell && content.length > 0) {
    // Cell was already a magic-language cell (e.g., SQL) but magic was removed.
    // User intentionally deleted the magic command → convert to Python.
    await convertToPythonCell(notebook, cell, content, autoDetectedCells);
    return;
  }

  // Cell is being converted to a magic language (e.g., Python → SQL),
  // or it's a fresh/empty cell that needs magic command.
  // ensureMagicCommand also clears the disableSqlAutoDetect flag if present.
  await ensureMagicCommand(notebook, cell, requiredMagic, languageId, autoDetectedCells);
}

/**
 * Handle magic command found in Python cell content.
 * Either converts to target language or removes magic based on context.
 * @param notebook - The notebook document
 * @param cell - The cell to handle
 * @param magic - The magic command found
 * @param languageId - The cell's current language ID
 */
async function handleMagicInPythonCell(
  notebook: vscode.NotebookDocument,
  cell: vscode.NotebookCell,
  magic: string,
  languageId: string
): Promise<void> {
  // If user manually added magic command (disableSqlAutoDetect flag is set),
  // convert to the appropriate language immediately
  if (cell.metadata?.disableSqlAutoDetect === true) {
    const targetLanguage = MAGIC_TO_LANGUAGE[magic] ?? 'shellscript';
    await convertCellToLanguage(notebook, cell, targetLanguage, magic, autoDetectedCells);
    return;
  }
  // Otherwise, remove the magic command (language was changed to Python)
  await removeMagicCommand(notebook, cell, magic, languageId, autoDetectedCells);
}

/**
 * Handle SQL auto-detection in Python cells.
 * Converts Python cells starting with SQL keywords to SQL cells.
 * @param notebook - The notebook document
 * @param cell - The cell to handle
 * @param content - The trimmed cell content
 */
async function handleSqlAutoDetection(
  notebook: vscode.NotebookDocument,
  cell: vscode.NotebookCell,
  content: string
): Promise<void> {
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
    await ensureMagicCommand(notebook, cell, '%sql', 'sql', autoDetectedCells);
  }
}

/**
 * Handle Python cell content changes.
 * Checks for magic commands and SQL auto-detection.
 * @param notebook - The notebook document
 * @param cell - The cell to handle
 * @param cellKey - The cell's unique key (URI string)
 * @param content - The trimmed cell content
 * @param languageId - The cell's language ID
 */
async function handlePythonCell(
  notebook: vscode.NotebookDocument,
  cell: vscode.NotebookCell,
  cellKey: string,
  content: string,
  languageId: string
): Promise<void> {
  // Skip if already processed
  if (autoDetectedCells.has(cellKey)) {
    return;
  }

  // Check if content starts with any magic command
  // Use sorted list (longest first) to prevent %r matching %run
  for (const magic of SORTED_MAGIC_COMMANDS) {
    if (contentStartsWithMagic(content, magic)) {
      await handleMagicInPythonCell(notebook, cell, magic, languageId);
      return;
    }
  }

  // Handle SQL auto-detection
  await handleSqlAutoDetection(notebook, cell, content);
}

/**
 * Handle cell content or language changes.
 * Delegates to focused handlers based on cell language.
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
  if (requiredMagic && !contentStartsWithMagic(content, requiredMagic)) {
    await handleMagicLanguageCell(notebook, cell, cellKey, content, requiredMagic, languageId);
    return;
  }

  // Handle Python cells
  if (languageId === 'python') {
    await handlePythonCell(notebook, cell, cellKey, content, languageId);
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
      addedCellPromises.push(handleNewCell(event.notebook, addedCell, autoDetectedCells));
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
  console.log('Databricks Notebook Studio is now deactivated');

  // Clear all session state (processing, raw text, auto-detected cells)
  sessionState.clear();

  // Clear catalog cache
  catalogService?.clearCache();
  catalogService = undefined;

  // Kernel manager is disposed via context.subscriptions, but clear reference
  kernelManager = undefined;

  // Profile manager is disposed via context.subscriptions, but clear reference
  profileManager = undefined;
}
