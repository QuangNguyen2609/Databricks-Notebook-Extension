/**
 * Notification utilities with auto-dismiss support.
 *
 * VS Code's standard notifications (showInformationMessage, etc.) don't support
 * auto-dismiss. This module provides wrapper functions that show pop-up notifications
 * and auto-dismiss after a configurable timeout using withProgress API.
 */

import * as vscode from 'vscode';

/** Default timeout for auto-dismissing notifications (10 seconds) */
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Show an information message pop-up that auto-dismisses after timeout.
 *
 * @param message - The message to show
 * @param timeoutMs - Timeout in milliseconds (default: 10000)
 */
export function showInfoMessage(message: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): void {
  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: message,
      cancellable: true,
    },
    async (_progress, token) => {
      return new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, timeoutMs);
        token.onCancellationRequested(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
  );
}

/**
 * Show a warning message pop-up that auto-dismisses after timeout.
 *
 * @param message - The message to show
 * @param timeoutMs - Timeout in milliseconds (default: 10000)
 */
export function showWarningMessage(message: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): void {
  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `$(warning) ${message}`,
      cancellable: true,
    },
    async (_progress, token) => {
      return new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, timeoutMs);
        token.onCancellationRequested(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
  );
}

/**
 * Show an error message pop-up that auto-dismisses after timeout.
 *
 * @param message - The message to show
 * @param timeoutMs - Timeout in milliseconds (default: 10000)
 */
export function showErrorMessage(message: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): void {
  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `$(error) ${message}`,
      cancellable: true,
    },
    async (_progress, token) => {
      return new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, timeoutMs);
        token.onCancellationRequested(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
  );
}

/**
 * Show an information message as a standard VS Code notification (no auto-dismiss).
 * Use this when user interaction is required (e.g., buttons/actions).
 *
 * @param message - The message to show
 * @param items - Optional action buttons
 * @returns Promise that resolves to the selected action or undefined
 */
export function showInfoNotification<T extends string>(
  message: string,
  ...items: T[]
): Thenable<T | undefined> {
  return vscode.window.showInformationMessage(message, ...items);
}

/**
 * Show a warning message as a standard VS Code notification (no auto-dismiss).
 * Use this when user interaction is required.
 *
 * @param message - The message to show
 * @param items - Optional action buttons
 * @returns Promise that resolves to the selected action or undefined
 */
export function showWarningNotification<T extends string>(
  message: string,
  ...items: T[]
): Thenable<T | undefined> {
  return vscode.window.showWarningMessage(message, ...items);
}

/**
 * Show an error message as a standard VS Code notification (no auto-dismiss).
 * Use this when user interaction is required.
 *
 * @param message - The message to show
 * @param items - Optional action buttons
 * @returns Promise that resolves to the selected action or undefined
 */
export function showErrorNotification<T extends string>(
  message: string,
  ...items: T[]
): Thenable<T | undefined> {
  return vscode.window.showErrorMessage(message, ...items);
}
