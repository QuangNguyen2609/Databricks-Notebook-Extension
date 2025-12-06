/**
 * Shared Constants for Databricks Notebook Viewer
 *
 * All magic commands, delimiters, and patterns are defined here
 * to ensure consistency across the codebase.
 */

import { MagicCommandConfig, CellType } from '../types';

// ===== NOTEBOOK FORMAT CONSTANTS =====

/** Header that identifies a Databricks notebook source file */
export const DATABRICKS_NOTEBOOK_HEADER = '# Databricks notebook source';

/** Delimiter between cells in Databricks notebook format */
export const CELL_DELIMITER = '# COMMAND ----------';

/** Prefix for MAGIC command lines */
export const MAGIC_PREFIX = '# MAGIC ';

/** Bare MAGIC prefix (for blank lines in markdown) */
export const MAGIC_PREFIX_BARE = '# MAGIC';

/** Prefix for cell title metadata */
export const TITLE_PREFIX = '# DBTITLE ';

// ===== MAGIC COMMAND CONFIGURATION =====

/**
 * Complete mapping of magic commands to their cell types and languages.
 * Sorted by length (longest first) for proper matching.
 */
export const MAGIC_COMMANDS: Record<string, MagicCommandConfig> = {
  '%md-sandbox': { type: 'markdown', language: 'markdown' },
  '%md': { type: 'markdown', language: 'markdown' },
  '%sql': { type: 'sql', language: 'sql' },
  '%scala': { type: 'scala', language: 'scala' },
  '%python': { type: 'code', language: 'python' },
  '%sh': { type: 'shell', language: 'shellscript' },
  '%fs': { type: 'fs', language: 'shellscript' },
  '%run': { type: 'run', language: 'python' },
  '%pip': { type: 'pip', language: 'shellscript' },
  '%r': { type: 'r', language: 'r' },
};

/** Sorted magic commands (longest first) for proper matching */
export const SORTED_MAGIC_COMMANDS = Object.keys(MAGIC_COMMANDS).sort(
  (a, b) => b.length - a.length
);

/**
 * Reverse mapping: Language ID to required magic command
 * For languages that require a magic command prefix
 */
export const LANGUAGE_TO_MAGIC: Record<string, string> = {
  'sql': '%sql',
  'scala': '%scala',
  'r': '%r',
  'shellscript': '%sh',
};

/**
 * Mapping of magic commands to Databricks cell types
 */
export const MAGIC_TO_CELL_TYPE: Record<string, CellType> = {
  '%sql': 'sql',
  '%scala': 'scala',
  '%r': 'r',
  '%sh': 'shell',
  '%md': 'markdown',
  '%md-sandbox': 'markdown',
  '%fs': 'fs',
  '%run': 'run',
  '%pip': 'pip',
};

/**
 * Reverse mapping: Cell type to magic command
 */
export const CELL_TYPE_TO_MAGIC: Record<CellType, string> = {
  code: '%python',
  markdown: '%md',
  sql: '%sql',
  scala: '%scala',
  r: '%r',
  shell: '%sh',
  fs: '%fs',
  run: '%run',
  pip: '%pip',
};

// ===== SQL AUTO-DETECTION =====

/**
 * SQL keywords that trigger auto-detection of SQL cells.
 * Pattern matches start of content (case-insensitive).
 */
export const SQL_KEYWORDS_REGEX = /^(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|WITH|MERGE|TRUNCATE|EXPLAIN|DESCRIBE|SHOW|USE)\b/i;

// ===== HELPER FUNCTIONS =====

/**
 * Check if content starts with a specific magic command.
 * Ensures exact match (followed by whitespace, newline, or end of string)
 * to prevent %r matching %run.
 *
 * @param content - The content to check
 * @param magic - The magic command to look for
 * @returns true if content starts with the exact magic command
 */
export function contentStartsWithMagic(content: string, magic: string): boolean {
  if (!content.startsWith(magic)) {
    return false;
  }
  const afterMagic = content.substring(magic.length);
  return afterMagic.length === 0 || /^[\s\n]/.test(afterMagic);
}

/**
 * Find which magic command a content string starts with.
 * Uses sorted list (longest first) to prevent partial matches.
 *
 * @param content - The content to check
 * @returns The magic command found, or undefined if none
 */
export function findMagicCommand(content: string): string | undefined {
  for (const magic of SORTED_MAGIC_COMMANDS) {
    if (contentStartsWithMagic(content, magic)) {
      return magic;
    }
  }
  return undefined;
}

/**
 * Get the magic command for a cell type.
 *
 * @param type - The cell type
 * @param originalCommand - Original command to preserve if available
 * @returns The appropriate magic command string
 */
export function getMagicCommandForType(type: CellType, originalCommand?: string): string {
  if (originalCommand) {
    return originalCommand;
  }
  return CELL_TYPE_TO_MAGIC[type] || '%python';
}
