/**
 * Type definitions for Databricks Notebook Viewer
 */

/**
 * Supported cell types in Databricks notebooks
 */
export type CellType =
  | 'code'
  | 'markdown'
  | 'sql'
  | 'scala'
  | 'r'
  | 'shell'
  | 'run'
  | 'fs'
  | 'pip';

/**
 * Default notebook language
 */
export type DefaultLanguage = 'python' | 'scala' | 'sql' | 'r';

/**
 * Metadata associated with a cell
 */
export interface CellMetadata {
  /** Cell title from DBTITLE */
  title?: string;
  /** Whether the cell is collapsed */
  collapsed?: boolean;
  /** The magic command used (e.g., %sql, %md) */
  magicCommand?: string;
}

/**
 * Represents a single cell in a Databricks notebook
 */
export interface DatabricksCell {
  /** The type of cell content */
  type: CellType;
  /** The actual content of the cell (with MAGIC prefixes removed) */
  content: string;
  /** Optional cell title */
  title?: string;
  /** The language for syntax highlighting */
  language: string;
  /** Original lines from the source file (for round-trip preservation) */
  originalLines: string[];
  /** Additional metadata */
  metadata?: CellMetadata;
}

/**
 * Represents a parsed Databricks notebook
 */
export interface ParsedNotebook {
  /** All cells in the notebook */
  cells: DatabricksCell[];
  /** The default language of the notebook */
  defaultLanguage: DefaultLanguage;
}

/**
 * Magic command configuration
 */
export interface MagicCommandConfig {
  /** The cell type this command creates */
  type: CellType;
  /** The VS Code language ID for syntax highlighting */
  language: string;
}

/**
 * Result of attempting to parse a file
 */
export interface ParseResult {
  /** Whether parsing was successful */
  success: boolean;
  /** The parsed notebook (if successful) */
  notebook?: ParsedNotebook;
  /** Error message (if unsuccessful) */
  error?: string;
}
