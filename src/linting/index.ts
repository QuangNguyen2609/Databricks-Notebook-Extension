/**
 * Linting module for cross-cell Python type checking
 *
 * This module provides cross-cell linting for Databricks notebooks by generating
 * virtual Python documents that Pylance/pyright can analyze.
 */

export { VirtualDocumentGenerator, VirtualDocument, CellMarker } from './virtualDocumentGenerator';
export { DiagnosticMapper } from './diagnosticMapper';
export { NotebookDiagnosticProvider } from './notebookDiagnosticProvider';
