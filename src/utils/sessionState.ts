/**
 * Session State Manager
 *
 * Manages mutable session state with proper encapsulation.
 * Consolidates global Sets for tracking document processing state.
 */

import { PROCESSING_TIMEOUT_MS } from '../constants';

/**
 * Manages session state for the extension.
 * Provides thread-safe operations for tracking document states.
 */
export class SessionState {
  /** Track documents currently being processed to avoid race conditions */
  private readonly _processingDocuments = new Set<string>();

  /** Track URIs currently being viewed as raw text (session-based) */
  private readonly _viewingAsRawText = new Set<string>();

  /** Track cells that have been auto-detected to avoid repeated changes */
  private readonly _autoDetectedCells = new Set<string>();

  /** Pending timeouts for processing document cleanup */
  private readonly _processingTimeouts = new Map<string, NodeJS.Timeout>();

  // ===== Processing Documents State =====

  /**
   * Check if a document is currently being processed.
   * @param uriString - The document URI string
   */
  isProcessing(uriString: string): boolean {
    return this._processingDocuments.has(uriString);
  }

  /**
   * Mark a document as being processed.
   * Automatically clears after a timeout to handle race conditions.
   * @param uriString - The document URI string
   * @param timeout - Optional timeout in ms (default: 500ms)
   */
  startProcessing(uriString: string, timeout: number = PROCESSING_TIMEOUT_MS): void {
    this._processingDocuments.add(uriString);

    // Clear any existing timeout for this URI
    const existingTimeout = this._processingTimeouts.get(uriString);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Set new timeout to auto-clear
    const timeoutId = setTimeout(() => {
      this._processingDocuments.delete(uriString);
      this._processingTimeouts.delete(uriString);
    }, timeout);

    this._processingTimeouts.set(uriString, timeoutId);
  }

  /**
   * Clear the processing state for a document.
   * @param uriString - The document URI string
   */
  clearProcessing(uriString: string): void {
    this._processingDocuments.delete(uriString);
    const timeout = this._processingTimeouts.get(uriString);
    if (timeout) {
      clearTimeout(timeout);
      this._processingTimeouts.delete(uriString);
    }
  }

  // ===== Viewing as Raw Text State =====

  /**
   * Check if a document is being viewed as raw text.
   * @param uriString - The document URI string
   */
  isViewingAsRawText(uriString: string): boolean {
    return this._viewingAsRawText.has(uriString);
  }

  /**
   * Mark a document as being viewed as raw text.
   * @param uriString - The document URI string
   */
  markAsRawText(uriString: string): void {
    this._viewingAsRawText.add(uriString);
  }

  /**
   * Clear the raw text viewing state for a document.
   * @param uriString - The document URI string
   */
  clearRawTextView(uriString: string): void {
    this._viewingAsRawText.delete(uriString);
  }

  // ===== Auto-Detected Cells State =====

  /**
   * Check if a cell has been auto-detected.
   * @param cellKey - The cell's unique key (typically URI string)
   */
  isAutoDetected(cellKey: string): boolean {
    return this._autoDetectedCells.has(cellKey);
  }

  /**
   * Mark a cell as auto-detected.
   * @param cellKey - The cell's unique key
   */
  markAutoDetected(cellKey: string): void {
    this._autoDetectedCells.add(cellKey);
  }

  /**
   * Clear the auto-detected state for a cell.
   * @param cellKey - The cell's unique key
   */
  clearAutoDetected(cellKey: string): void {
    this._autoDetectedCells.delete(cellKey);
  }

  /**
   * Clear all auto-detected cells for a specific notebook.
   * @param notebookPath - The notebook's file path
   */
  clearAutoDetectedForNotebook(notebookPath: string): void {
    for (const key of this._autoDetectedCells) {
      if (key.includes(notebookPath)) {
        this._autoDetectedCells.delete(key);
      }
    }
  }

  /**
   * Get the auto-detected cells Set for direct manipulation.
   * Use with caution - prefer the above methods when possible.
   * This is provided for compatibility with existing code patterns.
   */
  getAutoDetectedCells(): Set<string> {
    return this._autoDetectedCells;
  }

  // ===== Lifecycle =====

  /**
   * Clear all session state.
   * Should be called on extension deactivation.
   */
  clear(): void {
    // Clear processing timeouts first
    for (const timeout of this._processingTimeouts.values()) {
      clearTimeout(timeout);
    }
    this._processingTimeouts.clear();

    // Clear all Sets
    this._processingDocuments.clear();
    this._viewingAsRawText.clear();
    this._autoDetectedCells.clear();
  }

  /**
   * Get diagnostics about the current state (for debugging).
   */
  getDiagnostics(): {
    processingCount: number;
    rawTextCount: number;
    autoDetectedCount: number;
  } {
    return {
      processingCount: this._processingDocuments.size,
      rawTextCount: this._viewingAsRawText.size,
      autoDetectedCount: this._autoDetectedCells.size,
    };
  }
}

/** Singleton instance for the extension */
export const sessionState = new SessionState();
