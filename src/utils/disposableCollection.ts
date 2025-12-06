/**
 * Disposable Collection Utility
 *
 * Provides a reusable pattern for managing VS Code disposables.
 * Handles proper cleanup and prevents common disposal-related bugs.
 */

import * as vscode from 'vscode';

/**
 * A collection of disposables that can be disposed together.
 * Provides a cleaner API than managing arrays of disposables manually.
 *
 * @example
 * class MyClass implements vscode.Disposable {
 *   private readonly _disposables = new DisposableCollection();
 *
 *   constructor() {
 *     this._disposables.add(
 *       vscode.window.onDidChangeActiveTextEditor(() => {}),
 *       vscode.workspace.onDidChangeConfiguration(() => {})
 *     );
 *   }
 *
 *   dispose(): void {
 *     this._disposables.dispose();
 *   }
 * }
 */
export class DisposableCollection implements vscode.Disposable {
  private _disposables: vscode.Disposable[] = [];
  private _isDisposed = false;

  /**
   * Add one or more disposables to the collection.
   * Returns the first disposable for chaining convenience.
   *
   * @param disposables - Disposables to add
   * @returns The first disposable (for chaining)
   */
  add<T extends vscode.Disposable>(...disposables: T[]): T {
    if (this._isDisposed) {
      // If already disposed, immediately dispose the new items
      disposables.forEach(d => d.dispose());
      console.warn('[DisposableCollection] Adding to already disposed collection');
    } else {
      this._disposables.push(...disposables);
    }
    return disposables[0];
  }

  /**
   * Add a disposable and return it for chaining.
   * Alias for add() with a single item.
   *
   * @param disposable - Disposable to add
   * @returns The same disposable
   */
  push<T extends vscode.Disposable>(disposable: T): T {
    return this.add(disposable);
  }

  /**
   * Remove a specific disposable from the collection without disposing it.
   *
   * @param disposable - Disposable to remove
   * @returns true if the disposable was found and removed
   */
  remove(disposable: vscode.Disposable): boolean {
    const index = this._disposables.indexOf(disposable);
    if (index !== -1) {
      this._disposables.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get the number of disposables in the collection.
   */
  get size(): number {
    return this._disposables.length;
  }

  /**
   * Check if the collection has been disposed.
   */
  get isDisposed(): boolean {
    return this._isDisposed;
  }

  /**
   * Dispose all items in the collection.
   * After calling this, the collection is marked as disposed and
   * any new items added will be immediately disposed.
   */
  dispose(): void {
    if (this._isDisposed) {
      return;
    }

    this._isDisposed = true;

    // Dispose in reverse order (LIFO) for proper cleanup
    const items = this._disposables;
    this._disposables = [];

    for (let i = items.length - 1; i >= 0; i--) {
      try {
        items[i].dispose();
      } catch (error) {
        console.error('[DisposableCollection] Error disposing item:', error);
      }
    }
  }

  /**
   * Clear all disposables without disposing them.
   * Use with caution - this can lead to resource leaks.
   */
  clear(): void {
    this._disposables = [];
  }

  /**
   * Create a subscription that automatically adds itself to this collection.
   * Useful for event subscriptions.
   *
   * @param event - The event to subscribe to
   * @param listener - The event listener
   * @returns The disposable subscription
   */
  subscribe<T>(
    event: vscode.Event<T>,
    listener: (e: T) => void
  ): vscode.Disposable {
    const disposable = event(listener);
    this.add(disposable);
    return disposable;
  }
}

/**
 * Create a disposable from a cleanup function.
 *
 * @param cleanup - Function to call on dispose
 * @returns A disposable that calls the cleanup function
 *
 * @example
 * const timer = setInterval(() => {}, 1000);
 * const disposable = toDisposable(() => clearInterval(timer));
 */
export function toDisposable(cleanup: () => void): vscode.Disposable {
  return { dispose: cleanup };
}

/**
 * Create a disposable collection pre-populated with items.
 *
 * @param disposables - Initial disposables
 * @returns A new DisposableCollection
 */
export function createDisposableCollection(
  ...disposables: vscode.Disposable[]
): DisposableCollection {
  const collection = new DisposableCollection();
  collection.add(...disposables);
  return collection;
}
