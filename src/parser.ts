/**
 * Parser for Databricks .py notebook format
 *
 * Databricks notebooks exported as .py files follow a specific format:
 * - Start with "# Databricks notebook source"
 * - Cells are separated by "# COMMAND ----------"
 * - Magic commands start with "# MAGIC "
 * - Cell titles use "# DBTITLE 0,Title" or "# DBTITLE 1,Title"
 */

import {
  DatabricksCell,
  ParsedNotebook,
  CellType,
  MagicCommandConfig,
} from './types';

// Constants for parsing
const NOTEBOOK_HEADER = '# Databricks notebook source';
const CELL_DELIMITER = '# COMMAND ----------';
const MAGIC_PREFIX = '# MAGIC ';
const MAGIC_PREFIX_BARE = '# MAGIC'; // For lines with no content after MAGIC
const TITLE_PREFIX = '# DBTITLE ';

/**
 * Mapping of magic commands to their cell types and languages
 * Note: Order matters for matching - longer commands should be checked first
 */
const MAGIC_COMMANDS: Record<string, MagicCommandConfig> = {
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

/**
 * Sorted list of magic commands (longest first) for proper matching
 */
const SORTED_MAGIC_COMMANDS = Object.keys(MAGIC_COMMANDS).sort(
  (a, b) => b.length - a.length
);

/**
 * Check if the content is a Databricks notebook
 * @param content - The file content to check
 * @returns true if the file starts with the Databricks notebook header
 */
export function isDatabricksNotebook(content: string): boolean {
  const firstLine = content.split('\n')[0]?.trim();
  return firstLine === NOTEBOOK_HEADER;
}

/**
 * Parse a Databricks .py notebook into structured cells
 * @param content - The notebook file content
 * @returns Parsed notebook or null if not a valid Databricks notebook
 */
export function parseNotebook(content: string): ParsedNotebook | null {
  if (!isDatabricksNotebook(content)) {
    return null;
  }

  const lines = content.split('\n');
  const cells: DatabricksCell[] = [];

  // Find all cell boundaries (delimiter positions)
  const delimiterPositions: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === CELL_DELIMITER) {
      delimiterPositions.push(i);
    }
  }

  // Check if there's content before the first delimiter (cell without leading delimiter)
  const firstDelimiterPos = delimiterPositions.length > 0 ? delimiterPositions[0] : lines.length;

  // Collect lines before first delimiter (after header)
  const preDelimiterLines: string[] = [];
  for (let i = 1; i < firstDelimiterPos; i++) {
    preDelimiterLines.push(lines[i]);
  }

  // Check if there's actual content (not just blank lines)
  const hasPreDelimiterContent = preDelimiterLines.some(line => line.trim() !== '');

  if (hasPreDelimiterContent) {
    // Parse the first cell (no delimiter before it)
    const cell = parseCell(preDelimiterLines, preDelimiterLines);
    if (cell) {
      cells.push(cell);
    }
  }

  // Parse each cell - include everything from delimiter to next delimiter
  for (let i = 0; i < delimiterPositions.length; i++) {
    const startPos = delimiterPositions[i];
    const endPos = i + 1 < delimiterPositions.length ? delimiterPositions[i + 1] : lines.length;

    // Collect all lines for this cell (including delimiter and blanks)
    const cellRawLines: string[] = [];
    for (let j = startPos; j < endPos; j++) {
      cellRawLines.push(lines[j]);
    }

    // Extract content lines (skip delimiter line)
    const contentLines = cellRawLines.slice(1);

    const cell = parseCell(contentLines, cellRawLines);
    if (cell) {
      cells.push(cell);
    }
  }

  return {
    cells,
    defaultLanguage: 'python',
  };
}

/**
 * Parse a single cell from its lines
 * @param lines - The content lines (after delimiter)
 * @param rawLines - The raw lines including delimiter (for round-trip preservation)
 * @returns Parsed cell or null if empty
 */
function parseCell(lines: string[], rawLines?: string[]): DatabricksCell | null {
  // Create a copy to avoid mutating the original
  const cellLines = [...lines];

  // Filter out empty lines at start and end
  while (cellLines.length > 0 && cellLines[0].trim() === '') {
    cellLines.shift();
  }
  while (cellLines.length > 0 && cellLines[cellLines.length - 1].trim() === '') {
    cellLines.pop();
  }

  if (cellLines.length === 0) {
    return null;
  }

  let title: string | undefined;
  let startIndex = 0;

  // Check for DBTITLE
  if (cellLines[0].startsWith(TITLE_PREFIX)) {
    const titleMatch = cellLines[0].match(/# DBTITLE \d,(.+)/);
    if (titleMatch) {
      title = titleMatch[1];
    }
    startIndex = 1;

    // Skip empty lines after title
    while (
      startIndex < cellLines.length &&
      cellLines[startIndex].trim() === ''
    ) {
      startIndex++;
    }
  }

  const contentLines = cellLines.slice(startIndex);

  if (contentLines.length === 0) {
    // Cell with only a title, treat as empty Python cell
    return {
      type: 'code',
      content: '',
      title,
      language: 'python',
      originalLines: rawLines || lines,
    };
  }

  // Check if this is a MAGIC cell
  const firstContentLine = contentLines[0];

  if (firstContentLine.startsWith(MAGIC_PREFIX) || firstContentLine === MAGIC_PREFIX_BARE) {
    return parseMagicCell(contentLines, title, rawLines || lines);
  }

  // Regular Python cell
  return {
    type: 'code',
    content: contentLines.join('\n'),
    title,
    language: 'python',
    originalLines: rawLines || lines,
  };
}

/**
 * Parse a cell that contains MAGIC commands
 * @param lines - The cell lines (starting with MAGIC)
 * @param title - Optional cell title
 * @param originalLines - Original lines for round-trip
 * @returns Parsed cell
 */
function parseMagicCell(
  lines: string[],
  title: string | undefined,
  originalLines: string[]
): DatabricksCell {
  // Extract magic command from first line
  const firstLine = lines[0].replace(MAGIC_PREFIX, '').trim();

  let magicCommand: string | undefined;
  let cellInfo: MagicCommandConfig = { type: 'code', language: 'python' };

  // Find matching magic command (use sorted list to match longer commands first)
  for (const cmd of SORTED_MAGIC_COMMANDS) {
    if (firstLine.startsWith(cmd)) {
      magicCommand = cmd;
      cellInfo = MAGIC_COMMANDS[cmd];
      break;
    }
  }

  // Extract content, removing MAGIC prefix from each line
  const contentLines = lines.map((line) => {
    if (line.startsWith(MAGIC_PREFIX)) {
      return line.substring(MAGIC_PREFIX.length);
    }
    // Handle bare "# MAGIC" with no trailing space (blank line in markdown)
    if (line === MAGIC_PREFIX_BARE) {
      return '';
    }
    return line;
  });

  // Process based on magic command type
  if (magicCommand === '%md' || magicCommand === '%md-sandbox') {
    // For markdown, remove the %md from first line (don't show it)
    contentLines[0] = contentLines[0].replace(magicCommand, '').trim();
    // Remove empty first line if exists
    if (contentLines[0] === '') {
      contentLines.shift();
    }
  }
  // For all other magic commands (%sql, %run, %python, etc.), keep them visible
  // Don't remove the magic command from content

  return {
    type: cellInfo.type,
    content: contentLines.join('\n'),
    title,
    language: cellInfo.language,
    originalLines,
    metadata: { magicCommand },
  };
}

/**
 * Serialize cells back to Databricks .py format
 *
 * Key principle: If a cell's content hasn't changed, use the original lines exactly.
 * This prevents unnecessary git diffs from formatting changes.
 *
 * @param cells - The cells to serialize
 * @returns The serialized notebook content
 */
export function serializeNotebook(cells: DatabricksCell[]): string {
  const lines: string[] = [NOTEBOOK_HEADER];

  cells.forEach((cell) => {
    // If cell has originalLines (content unchanged), use them directly
    // originalLines includes the delimiter, so just append as-is
    if (cell.originalLines && cell.originalLines.length > 0) {
      cell.originalLines.forEach(line => lines.push(line));
      return;
    }

    // Cell was modified - need to re-serialize
    // Don't add blank before delimiter - previous cell's originalLines includes trailing blanks
    lines.push(CELL_DELIMITER, '');

    // Add title if present
    if (cell.title) {
      lines.push(`${TITLE_PREFIX}0,${cell.title}`);
    }

    if (cell.type === 'code' && cell.language === 'python') {
      // Plain Python - no MAGIC needed
      lines.push(cell.content);
    } else if (cell.type === 'markdown') {
      // Markdown cell - %md on its own line, content on subsequent lines
      lines.push(`${MAGIC_PREFIX}%md`);
      // Split content and remove trailing empty lines to avoid extra blank MAGIC lines
      const contentLines = cell.content.split('\n');
      while (contentLines.length > 0 && contentLines[contentLines.length - 1].trim() === '') {
        contentLines.pop();
      }
      contentLines.forEach((line) => {
        lines.push(`${MAGIC_PREFIX}${line}`);
      });
    } else {
      // Other magic types (sql, scala, shell, etc.)
      // Content already includes the magic command, just add MAGIC prefix
      const contentLines = cell.content.split('\n');
      while (contentLines.length > 0 && contentLines[contentLines.length - 1].trim() === '') {
        contentLines.pop();
      }
      contentLines.forEach((line) => {
        lines.push(`${MAGIC_PREFIX}${line}`);
      });
    }
  });

  return lines.join('\n');
}

/**
 * Get the appropriate magic command for a cell type
 * @param type - The cell type
 * @param originalCommand - The original magic command (if known)
 * @returns The magic command string
 */
function getMagicCommandForType(type: CellType, originalCommand?: string): string {
  // If we have the original command, use it
  if (originalCommand) {
    return originalCommand;
  }

  // Map cell types to magic commands
  const typeToCommand: Record<CellType, string> = {
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

  return typeToCommand[type] || '%python';
}

/**
 * Count the number of cells in a notebook
 * @param content - The notebook content
 * @returns Number of cells, or 0 if not a valid notebook
 */
export function countCells(content: string): number {
  const notebook = parseNotebook(content);
  return notebook?.cells.length ?? 0;
}

/**
 * Extract just the cell types from a notebook (for quick analysis)
 * @param content - The notebook content
 * @returns Array of cell types
 */
export function getCellTypes(content: string): CellType[] {
  const notebook = parseNotebook(content);
  return notebook?.cells.map((c) => c.type) ?? [];
}
