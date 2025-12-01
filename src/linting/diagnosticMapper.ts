/**
 * Diagnostic Mapper for Cross-Cell Linting
 *
 * Maps diagnostics from virtual Python documents back to individual notebook cells.
 * Converts line numbers and ranges from virtual document coordinates to cell-relative coordinates.
 */

import * as vscode from 'vscode';
import { VirtualDocument, CellMarker } from './virtualDocumentGenerator';

/**
 * Maps diagnostics from virtual documents to notebook cells
 */
export class DiagnosticMapper {
  /**
   * Map diagnostics from virtual document to cell coordinates
   * @param virtualDoc - The virtual document
   * @param diagnostics - Diagnostics from pyright on the virtual file
   * @returns Map of cell index to diagnostics for that cell
   */
  mapDiagnostics(
    virtualDoc: VirtualDocument,
    diagnostics: readonly vscode.Diagnostic[]
  ): Map<number, vscode.Diagnostic[]> {
    const cellDiagnostics = new Map<number, vscode.Diagnostic[]>();

    for (const diagnostic of diagnostics) {
      const mappedDiagnostic = this.mapSingleDiagnostic(virtualDoc, diagnostic);

      if (mappedDiagnostic) {
        const { cellIndex, diagnostic: cellDiag } = mappedDiagnostic;

        if (!cellDiagnostics.has(cellIndex)) {
          cellDiagnostics.set(cellIndex, []);
        }

        cellDiagnostics.get(cellIndex)!.push(cellDiag);
      }
    }

    return cellDiagnostics;
  }

  /**
   * Map a single diagnostic from virtual document to cell
   * @param virtualDoc - The virtual document
   * @param diagnostic - The diagnostic to map
   * @returns Mapped diagnostic with cell index, or null if not mappable
   */
  private mapSingleDiagnostic(
    virtualDoc: VirtualDocument,
    diagnostic: vscode.Diagnostic
  ): { cellIndex: number; diagnostic: vscode.Diagnostic } | null {
    const virtualLine = diagnostic.range.start.line;

    // Find which cell this line belongs to
    const marker = this.findCellForLine(virtualLine, virtualDoc.cellMarkers);

    if (!marker) {
      // Diagnostic is in preamble or outside any cell - ignore it
      return null;
    }

    // Convert line numbers to cell-relative
    const cellRelativeLine = this.convertLineNumber(virtualLine, marker);
    const cellRelativeEndLine = this.convertLineNumber(diagnostic.range.end.line, marker);

    // Create new diagnostic with cell URI and adjusted range
    const cellRange = new vscode.Range(
      cellRelativeLine,
      diagnostic.range.start.character,
      cellRelativeEndLine,
      diagnostic.range.end.character
    );

    const cellDiagnostic = new vscode.Diagnostic(
      cellRange,
      diagnostic.message,
      diagnostic.severity
    );

    // Preserve diagnostic metadata
    cellDiagnostic.code = diagnostic.code;
    cellDiagnostic.source = diagnostic.source;
    cellDiagnostic.tags = diagnostic.tags;

    // Add related information if present
    if (diagnostic.relatedInformation) {
      cellDiagnostic.relatedInformation = diagnostic.relatedInformation;
    }

    return {
      cellIndex: marker.cellIndex,
      diagnostic: cellDiagnostic,
    };
  }

  /**
   * Find which cell a line belongs to
   * @param lineNumber - Line number in virtual document
   * @param markers - Cell markers
   * @returns Cell marker containing this line, or undefined if not found
   */
  private findCellForLine(lineNumber: number, markers: CellMarker[]): CellMarker | undefined {
    return markers.find(
      (marker) => lineNumber >= marker.lineStart && lineNumber <= marker.lineEnd
    );
  }

  /**
   * Convert line number from virtual document to cell-relative
   * @param virtualLine - Line number in virtual document
   * @param marker - Cell marker
   * @returns Line number relative to cell start
   */
  private convertLineNumber(virtualLine: number, marker: CellMarker): number {
    return virtualLine - marker.lineStart;
  }

  /**
   * Get cell URI for a cell index in the notebook
   * @param notebook - The notebook document
   * @param cellIndex - Index of the cell
   * @returns Cell document URI, or undefined if cell not found
   */
  getCellUri(notebook: vscode.NotebookDocument, cellIndex: number): vscode.Uri | undefined {
    if (cellIndex < 0 || cellIndex >= notebook.cellCount) {
      return undefined;
    }

    return notebook.cellAt(cellIndex).document.uri;
  }
}
