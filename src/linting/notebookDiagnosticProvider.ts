/**
 * Notebook Diagnostic Provider for Cross-Cell Linting
 *
 * Orchestrates cross-cell linting by generating virtual documents, listening for
 * pyright diagnostics, and mapping them back to notebook cells.
 */

import * as vscode from 'vscode';
import { VirtualDocumentGenerator, VirtualDocument } from './virtualDocumentGenerator';
import { DiagnosticMapper } from './diagnosticMapper';

/**
 * Provides cross-cell linting for Databricks notebooks
 */
export class NotebookDiagnosticProvider implements vscode.Disposable {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private generator: VirtualDocumentGenerator;
  private mapper: DiagnosticMapper;
  private updateDebounce: Map<string, NodeJS.Timeout> = new Map();
  private virtualDocuments: Map<string, VirtualDocument> = new Map();
  private disposables: vscode.Disposable[] = [];
  private debounceMs: number;
  private enabled: boolean;
  private includeDatabricksPreamble: boolean;
  private pendingUpdates: Set<Promise<void>> = new Set();

  /**
   * Create a new NotebookDiagnosticProvider
   * @param context - Extension context
   */
  constructor(private context: vscode.ExtensionContext) {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('databricks-notebook');
    this.context.subscriptions.push(this.diagnosticCollection);

    // Get workspace root for cache directory
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('No workspace folder open');
    }

    this.generator = new VirtualDocumentGenerator(workspaceRoot);
    this.mapper = new DiagnosticMapper();

    // Load configuration
    const config = vscode.workspace.getConfiguration('databricks-notebook.linting');
    this.enabled = config.get<boolean>('enabled', true);
    this.debounceMs = config.get<number>('debounceMs', 500);
    this.includeDatabricksPreamble = config.get<boolean>('includeDatabricksTypes', true);

    // Listen for configuration changes
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('databricks-notebook.linting')) {
          this.reloadConfiguration();
        }
      })
    );

    // Listen for pyright diagnostics on virtual files
    this.disposables.push(
      vscode.languages.onDidChangeDiagnostics((event) => {
        this.onDidChangeDiagnostics(event);
      })
    );

    // Listen for notebook lifecycle events
    this.disposables.push(
      vscode.workspace.onDidOpenNotebookDocument(async (notebook) => {
        if (notebook.notebookType === 'databricks-notebook' && this.enabled) {
          await this.analyzeNotebook(notebook);
        }
      }),

      vscode.workspace.onDidChangeNotebookDocument(async (event) => {
        if (event.notebook.notebookType === 'databricks-notebook' && this.enabled) {
          // Schedule debounced update
          this.scheduleUpdate(event.notebook);
        }
      }),

      vscode.workspace.onDidCloseNotebookDocument((notebook) => {
        if (notebook.notebookType === 'databricks-notebook') {
          this.clearDiagnostics(notebook.uri);
        }
      })
    );

    console.log('[NotebookDiagnosticProvider] Initialized');
  }

  /**
   * Reload configuration from settings
   */
  private reloadConfiguration(): void {
    const config = vscode.workspace.getConfiguration('databricks-notebook.linting');
    const wasEnabled = this.enabled;

    this.enabled = config.get<boolean>('enabled', true);
    this.debounceMs = config.get<number>('debounceMs', 500);
    this.includeDatabricksPreamble = config.get<boolean>('includeDatabricksTypes', true);

    // If linting was disabled, clear all diagnostics
    if (wasEnabled && !this.enabled) {
      this.diagnosticCollection.clear();
      this.virtualDocuments.clear();
      console.log('[NotebookDiagnosticProvider] Linting disabled');
    }

    // If linting was enabled, reanalyze all open notebooks
    if (!wasEnabled && this.enabled) {
      console.log('[NotebookDiagnosticProvider] Linting enabled');
      this.reanalyzeAllNotebooks();
    }
  }

  /**
   * Reanalyze all open Databricks notebooks
   */
  private async reanalyzeAllNotebooks(): Promise<void> {
    const notebooks = vscode.workspace.notebookDocuments.filter(
      (nb) => nb.notebookType === 'databricks-notebook'
    );

    await Promise.all(notebooks.map((notebook) => this.analyzeNotebook(notebook)));
  }

  /**
   * Analyze a notebook and generate virtual document
   * @param notebook - The notebook to analyze
   */
  async analyzeNotebook(notebook: vscode.NotebookDocument): Promise<void> {
    if (!this.enabled) {
      return;
    }

    try {
      await this.updateDiagnostics(notebook);
    } catch (error) {
      console.error('[NotebookDiagnosticProvider] Failed to analyze notebook:', error);
      vscode.window.showErrorMessage(
        `Failed to analyze notebook for linting: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Schedule a debounced update for a notebook
   * @param notebook - The notebook to update
   */
  private scheduleUpdate(notebook: vscode.NotebookDocument): void {
    const key = notebook.uri.toString();

    // Clear existing timeout
    if (this.updateDebounce.has(key)) {
      clearTimeout(this.updateDebounce.get(key)!);
    }

    // Schedule new update
    const timeout = setTimeout(() => {
      const updatePromise = this.updateDiagnostics(notebook)
        .catch((error) => {
          console.error('[NotebookDiagnosticProvider] Failed to update diagnostics:', error);
        })
        .finally(() => {
          this.updateDebounce.delete(key);
          this.pendingUpdates.delete(updatePromise);
        });

      this.pendingUpdates.add(updatePromise);
    }, this.debounceMs);

    this.updateDebounce.set(key, timeout);
  }

  /**
   * Update diagnostics for a notebook
   * @param notebook - The notebook to update
   */
  private async updateDiagnostics(notebook: vscode.NotebookDocument): Promise<void> {
    try {
      // Generate virtual document
      const virtualDoc = this.generator.generateDocument(notebook, this.includeDatabricksPreamble);

      // Store virtual document for diagnostic mapping
      this.virtualDocuments.set(notebook.uri.toString(), virtualDoc);

      // Write virtual document to file system
      await this.generator.writeVirtualDocument(virtualDoc);

      console.debug(
        `[NotebookDiagnosticProvider] Updated virtual doc for ${notebook.uri.fsPath}`
      );

      // Note: Diagnostics will be applied when pyright emits them via onDidChangeDiagnostics
    } catch (error) {
      console.error('[NotebookDiagnosticProvider] Failed to update diagnostics:', error);
    }
  }

  /**
   * Handle diagnostic changes from VS Code language services
   * @param event - Diagnostic change event
   */
  private onDidChangeDiagnostics(event: vscode.DiagnosticChangeEvent): void {
    if (!this.enabled) {
      return;
    }

    // Check if any of the changed URIs are virtual documents
    for (const uri of event.uris) {
      console.debug(`[NotebookDiagnosticProvider] Diagnostic change for: ${uri.fsPath}`);

      // Check if this is a virtual document
      if (!uri.fsPath.includes('.databricks-cache') || !uri.fsPath.endsWith('.virtual.py')) {
        continue;
      }

      console.log(`[NotebookDiagnosticProvider] Virtual document diagnostic change: ${uri.fsPath}`);

      // Find the notebook this virtual document belongs to
      const notebookUri = this.findNotebookForVirtualDoc(uri.fsPath);
      if (!notebookUri) {
        console.warn(`[NotebookDiagnosticProvider] Could not find notebook for virtual doc: ${uri.fsPath}`);
        continue;
      }

      console.log(`[NotebookDiagnosticProvider] Found notebook: ${notebookUri.fsPath}`);

      // Get diagnostics for the virtual file
      const virtualDiagnostics = vscode.languages.getDiagnostics(uri);
      console.log(`[NotebookDiagnosticProvider] Got ${virtualDiagnostics.length} diagnostics from pyright`);

      // Get virtual document
      const virtualDoc = this.virtualDocuments.get(notebookUri.toString());
      if (!virtualDoc) {
        console.warn(`[NotebookDiagnosticProvider] Virtual document not found in cache`);
        continue;
      }

      // Map diagnostics to cells
      const cellDiagnostics = this.mapper.mapDiagnostics(virtualDoc, virtualDiagnostics);
      console.log(`[NotebookDiagnosticProvider] Mapped to ${cellDiagnostics.size} cells`);

      // Apply diagnostics to cells
      const notebook = vscode.workspace.notebookDocuments.find(
        (nb) => nb.uri.toString() === notebookUri.toString()
      );

      if (notebook) {
        this.applyDiagnosticsToNotebook(notebook, cellDiagnostics);
      } else {
        console.warn(`[NotebookDiagnosticProvider] Notebook not found in workspace`);
      }
    }
  }

  /**
   * Find notebook URI for a virtual document path
   * @param virtualPath - Path to virtual document
   * @returns Notebook URI, or undefined if not found
   */
  private findNotebookForVirtualDoc(virtualPath: string): vscode.Uri | undefined {
    for (const [notebookUriStr, virtualDoc] of this.virtualDocuments.entries()) {
      if (virtualDoc.filePath === virtualPath) {
        return vscode.Uri.parse(notebookUriStr);
      }
    }
    return undefined;
  }

  /**
   * Apply diagnostics to notebook cells
   * @param notebook - The notebook
   * @param cellDiagnostics - Map of cell index to diagnostics
   */
  private applyDiagnosticsToNotebook(
    notebook: vscode.NotebookDocument,
    cellDiagnostics: Map<number, vscode.Diagnostic[]>
  ): void {
    // Clear existing diagnostics for this notebook
    for (let i = 0; i < notebook.cellCount; i++) {
      const cell = notebook.cellAt(i);
      this.diagnosticCollection.delete(cell.document.uri);
    }

    // Apply new diagnostics
    for (const [cellIndex, diagnostics] of cellDiagnostics.entries()) {
      const cellUri = this.mapper.getCellUri(notebook, cellIndex);
      if (cellUri) {
        this.diagnosticCollection.set(cellUri, diagnostics);
        console.debug(
          `[NotebookDiagnosticProvider] Applied ${diagnostics.length} diagnostics to cell ${cellIndex}`
        );
      }
    }
  }

  /**
   * Clear diagnostics for a notebook
   * @param notebookUri - The notebook URI
   */
  clearDiagnostics(notebookUri: vscode.Uri): void {
    // Clear virtual document
    this.virtualDocuments.delete(notebookUri.toString());

    // Delete virtual file
    this.generator.deleteVirtualDocument(notebookUri).catch((error) => {
      console.debug('[NotebookDiagnosticProvider] Failed to delete virtual doc:', error);
    });

    // Clear debounce timeout
    const key = notebookUri.toString();
    if (this.updateDebounce.has(key)) {
      clearTimeout(this.updateDebounce.get(key)!);
      this.updateDebounce.delete(key);
    }

    // Note: Diagnostics will be cleared automatically when virtual file is deleted
    // and pyright no longer reports diagnostics for it
  }

  /**
   * Dispose of resources
   *
   * Uses synchronous cleanup to avoid race conditions during disposal.
   * Pending updates will complete but their results won't update diagnostics
   * since the diagnostic collection is cleared synchronously.
   */
  dispose(): void {
    // Clear all debounce timers synchronously
    for (const timeout of this.updateDebounce.values()) {
      clearTimeout(timeout);
    }
    this.updateDebounce.clear();

    // Clear diagnostics synchronously
    this.diagnosticCollection.clear();

    // Dispose of event listeners synchronously
    this.disposables.forEach((d) => d.dispose());

    // Note: pendingUpdates will complete but won't update diagnostics
    // since the diagnostic collection is already cleared

    console.log('[NotebookDiagnosticProvider] Disposed');
  }
}
