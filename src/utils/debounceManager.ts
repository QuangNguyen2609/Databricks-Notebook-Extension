/**
 * Debounce Manager Utility
 *
 * Provides a reusable debounce pattern with proper cleanup.
 * Handles keyed debouncing for multiple concurrent operations.
 */

import * as vscode from 'vscode';

/**
 * A pending debounced operation
 */
interface PendingOperation<T> {
  timeout: NodeJS.Timeout;
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

/**
 * Manages debounced operations with proper cleanup.
 * Supports keyed debouncing for managing multiple concurrent debounce timers.
 *
 * @example
 * class MyService implements vscode.Disposable {
 *   private readonly _debouncer = new DebounceManager<void>();
 *
 *   async handleChange(key: string): Promise<void> {
 *     await this._debouncer.debounce(key, 500, async () => {
 *       // This runs after 500ms of no calls with this key
 *       await this.processChange(key);
 *     });
 *   }
 *
 *   dispose(): void {
 *     this._debouncer.dispose();
 *   }
 * }
 */
export class DebounceManager<T = void> implements vscode.Disposable {
  private readonly _pending = new Map<string, PendingOperation<T>>();
  private _isDisposed = false;

  /**
   * Debounce an operation by key.
   * If called again with the same key before the delay, the timer resets.
   *
   * @param key - Unique key for this debounce operation
   * @param delayMs - Delay in milliseconds
   * @param operation - The operation to execute after the delay
   * @returns Promise that resolves when the operation completes
   */
  debounce(
    key: string,
    delayMs: number,
    operation: () => T | Promise<T>
  ): Promise<T> {
    if (this._isDisposed) {
      return Promise.reject(new Error('DebounceManager is disposed'));
    }

    // Cancel existing operation for this key
    this.cancel(key);

    // Create new pending operation
    let resolveOp: (value: T) => void;
    let rejectOp: (reason: unknown) => void;

    const promise = new Promise<T>((resolve, reject) => {
      resolveOp = resolve;
      rejectOp = reject;
    });

    const timeout = setTimeout(async () => {
      try {
        const result = await operation();
        this._pending.delete(key);
        resolveOp(result);
      } catch (error) {
        this._pending.delete(key);
        rejectOp(error);
      }
    }, delayMs);

    this._pending.set(key, {
      timeout,
      promise,
      resolve: resolveOp!,
      reject: rejectOp!,
    });

    return promise;
  }

  /**
   * Cancel a pending debounced operation.
   *
   * @param key - The key of the operation to cancel
   * @returns true if an operation was cancelled
   */
  cancel(key: string): boolean {
    const pending = this._pending.get(key);
    if (pending) {
      clearTimeout(pending.timeout);
      this._pending.delete(key);
      return true;
    }
    return false;
  }

  /**
   * Check if there's a pending operation for a key.
   *
   * @param key - The key to check
   * @returns true if there's a pending operation
   */
  isPending(key: string): boolean {
    return this._pending.has(key);
  }

  /**
   * Get the number of pending operations.
   */
  get pendingCount(): number {
    return this._pending.size;
  }

  /**
   * Cancel all pending operations.
   */
  cancelAll(): void {
    for (const pending of this._pending.values()) {
      clearTimeout(pending.timeout);
    }
    this._pending.clear();
  }

  /**
   * Dispose the manager and cancel all pending operations.
   */
  dispose(): void {
    if (this._isDisposed) {
      return;
    }

    this._isDisposed = true;
    this.cancelAll();
  }
}

/**
 * Simple debounce function for one-off use cases.
 * For reusable debouncing, prefer DebounceManager.
 *
 * @param fn - The function to debounce
 * @param delayMs - Delay in milliseconds
 * @returns A debounced version of the function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delayMs: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      fn(...args);
      timeout = null;
    }, delayMs);
  };
}

/**
 * Create a debounced function with a cancel method.
 *
 * @param fn - The function to debounce
 * @param delayMs - Delay in milliseconds
 * @returns An object with the debounced function and a cancel method
 */
export function debounceCancellable<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delayMs: number
): {
  call: (...args: Parameters<T>) => void;
  cancel: () => void;
} {
  let timeout: NodeJS.Timeout | null = null;

  return {
    call: (...args: Parameters<T>) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(() => {
        fn(...args);
        timeout = null;
      }, delayMs);
    },
    cancel: () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    },
  };
}
