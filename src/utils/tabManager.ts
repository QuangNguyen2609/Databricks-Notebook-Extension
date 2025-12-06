/**
 * Tab Manager Utility
 *
 * Provides functions for finding, closing, and replacing tabs
 * with consistent view column preservation.
 */

import * as vscode from 'vscode';

/**
 * Result of finding a tab
 */
export interface TabInfo {
  tab: vscode.Tab;
  viewColumn: vscode.ViewColumn;
}

/**
 * Find a text editor tab by URI.
 *
 * @param uriString - The URI string of the document
 * @returns Tab info or null if not found
 */
export function findTextEditorTab(uriString: string): TabInfo | null {
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
 * Find a notebook tab by URI.
 *
 * @param uriString - The URI string of the document
 * @returns Tab info or null if not found
 */
export function findNotebookTab(uriString: string): TabInfo | null {
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
 * Check if a URI is currently open in a diff editor tab.
 *
 * @param uriString - The URI string to check
 * @returns true if the URI is in a diff tab
 */
export function isInDiffTab(uriString: string): boolean {
  return vscode.window.tabGroups.all.some(group =>
    group.tabs.some(tab =>
      (tab.input instanceof vscode.TabInputTextDiff ||
       tab.input instanceof vscode.TabInputNotebookDiff) &&
      (tab.input.original.toString() === uriString ||
       tab.input.modified.toString() === uriString)
    )
  );
}

/**
 * Close a tab and open a new view in the same position.
 * Implements the "close-then-open" pattern for seamless tab replacement.
 *
 * @param uri - The file URI
 * @param currentTab - The tab to close (or null to just open)
 * @param viewType - The editor type to open with (e.g., 'databricks-notebook', 'default')
 * @returns The view column where the new editor was opened
 */
export async function replaceTabWithView(
  uri: vscode.Uri,
  currentTab: TabInfo | null,
  viewType: string
): Promise<vscode.ViewColumn> {
  const viewColumn = currentTab?.viewColumn || vscode.ViewColumn.Active;

  // Close existing tab first to avoid duplicate tabs
  if (currentTab) {
    await vscode.window.tabGroups.close(currentTab.tab);
  }

  // Open new view in the same column
  await vscode.commands.executeCommand(
    'vscode.openWith',
    uri,
    viewType,
    viewColumn
  );

  return viewColumn;
}

/**
 * Open a file as a Databricks notebook, replacing any existing text editor tab.
 *
 * @param uri - The file URI to open
 * @returns The view column where the notebook was opened
 */
export async function openAsNotebook(uri: vscode.Uri): Promise<vscode.ViewColumn> {
  const tabInfo = findTextEditorTab(uri.toString());
  return replaceTabWithView(uri, tabInfo, 'databricks-notebook');
}

/**
 * Open a notebook as raw text, replacing any existing notebook tab.
 *
 * @param uri - The file URI to open
 * @returns The view column where the text editor was opened
 */
export async function openAsText(uri: vscode.Uri): Promise<vscode.ViewColumn> {
  const tabInfo = findNotebookTab(uri.toString());
  return replaceTabWithView(uri, tabInfo, 'default');
}
