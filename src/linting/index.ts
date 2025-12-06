/**
 * Linting module for cross-cell Python type checking
 *
 * This module provides cross-cell linting for Databricks notebooks by generating
 * virtual Python documents that Pylance/pyright can analyze.
 */

export { NotebookDiagnosticProvider } from './notebookDiagnosticProvider';
export { DiagnosticMapper } from './diagnosticMapper';
export { VirtualDocumentGenerator } from './virtualDocumentGenerator';
export type { VirtualDocument, CellMarker } from './virtualDocumentGenerator';
