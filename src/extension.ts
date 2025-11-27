/**
 * Databricks Notebook Viewer - VS Code Extension
 *
 * This extension provides notebook visualization for Databricks .py files,
 * rendering them with proper cell separation, markdown rendering, and
 * syntax highlighting for various languages (Python, SQL, Scala, R, etc.)
 */

import * as vscode from 'vscode';
import { DatabricksNotebookSerializer, checkIsDatabricksNotebook } from './serializer';
import { DatabricksNotebookController } from './controller';

// Track shown documents to avoid duplicate notifications
const notifiedDocuments = new Set<string>();

/**
 * Extension activation
 * Called when VS Code activates the extension
 */
export function activate(context: vscode.ExtensionContext): void {
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

  // Register the notebook controller (optional execution support)
  const controller = new DatabricksNotebookController();
  context.subscriptions.push(controller);

  // Register command to open .py file as Databricks notebook
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'databricks-notebook.openAsNotebook',
      async (uri?: vscode.Uri) => {
        await openAsNotebook(uri);
      }
    )
  );

  // Auto-detect Databricks notebooks when opening .py files
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (document) => {
      await handleDocumentOpen(document);
    })
  );

  // Check currently open documents
  for (const editor of vscode.window.visibleTextEditors) {
    handleDocumentOpen(editor.document);
  }
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
 * Handle document open event to detect Databricks notebooks
 * @param document - The opened document
 */
async function handleDocumentOpen(document: vscode.TextDocument): Promise<void> {
  // Only check Python files
  if (document.languageId !== 'python' || !document.fileName.endsWith('.py')) {
    return;
  }

  // Skip if already notified for this document
  if (notifiedDocuments.has(document.uri.toString())) {
    return;
  }

  // Check if it's a Databricks notebook
  const isDatabricks = await checkIsDatabricksNotebook(document.uri);

  if (!isDatabricks) {
    return;
  }

  // Get configuration
  const config = vscode.workspace.getConfiguration('databricks-notebook');
  const autoOpen = config.get<boolean>('autoOpenNotebooks', false);
  const showNotification = config.get<boolean>('showNotification', true);

  // Mark as notified
  notifiedDocuments.add(document.uri.toString());

  if (autoOpen) {
    // Auto-open as notebook
    vscode.commands.executeCommand('databricks-notebook.openAsNotebook', document.uri);
  } else if (showNotification) {
    // Show notification
    const action = await vscode.window.showInformationMessage(
      'This appears to be a Databricks notebook. Would you like to open it as a notebook?',
      'Open as Notebook',
      'Keep as Python',
      "Don't ask again"
    );

    if (action === 'Open as Notebook') {
      vscode.commands.executeCommand('databricks-notebook.openAsNotebook', document.uri);
    } else if (action === "Don't ask again") {
      config.update('showNotification', false, vscode.ConfigurationTarget.Global);
    }
  }
}

/**
 * Extension deactivation
 * Called when VS Code deactivates the extension
 */
export function deactivate(): void {
  console.log('Databricks Notebook Viewer is now deactivated');
  notifiedDocuments.clear();
}
