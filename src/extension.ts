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

// Track documents currently being processed to avoid race conditions
const processingDocuments = new Set<string>();

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
 * Close the text editor tab for a given URI
 * @param uriString - The URI string of the document to close
 */
async function closeTextEditorTab(uriString: string): Promise<void> {
  for (const tabGroup of vscode.window.tabGroups.all) {
    for (const tab of tabGroup.tabs) {
      if (
        tab.input instanceof vscode.TabInputText &&
        tab.input.uri.toString() === uriString
      ) {
        await vscode.window.tabGroups.close(tab);
        return;
      }
    }
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

  const uriString = document.uri.toString();

  // Skip if already processing this document (avoid race conditions)
  if (processingDocuments.has(uriString)) {
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

  if (autoOpen) {
    // Mark as processing to prevent duplicate handling
    processingDocuments.add(uriString);

    try {
      // Open as notebook first
      await vscode.commands.executeCommand(
        'vscode.openWith',
        document.uri,
        'databricks-notebook'
      );

      // Close the text editor tab that was opened
      await closeTextEditorTab(uriString);
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
        // Open as notebook
        await vscode.commands.executeCommand(
          'vscode.openWith',
          document.uri,
          'databricks-notebook'
        );

        // Close the text editor tab
        await closeTextEditorTab(uriString);
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

/**
 * Extension deactivation
 * Called when VS Code deactivates the extension
 */
export function deactivate(): void {
  console.log('Databricks Notebook Viewer is now deactivated');
  processingDocuments.clear();
}
