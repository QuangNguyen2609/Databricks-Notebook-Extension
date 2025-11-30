/**
 * SQL Context Parser for Databricks Notebooks
 *
 * Lightweight parser to determine completion context from cursor position.
 * Handles both 2-level (schema.table) and 3-level (catalog.schema.table) naming.
 */

import { SqlContext } from './types';

/**
 * Table reference extracted from SQL
 */
interface TableReference {
  catalogName?: string;
  schemaName?: string;
  tableName: string;
  alias?: string;
}

/**
 * Parser for SQL completion context
 */
export class SqlContextParser {
  /**
   * Parse SQL text and determine completion context at cursor position
   */
  parse(text: string, cursorOffset: number): SqlContext {
    const textBeforeCursor = text.substring(0, cursorOffset);
    const cleanText = this.removeComments(textBeforeCursor);

    // Check for table/schema context (FROM, JOIN, INTO, UPDATE, TABLE)
    const tableContext = this.parseTableContext(cleanText);
    if (tableContext) {
      return tableContext;
    }

    // Check for column context (SELECT, WHERE, AND, OR, ON, ORDER BY, GROUP BY)
    const columnContext = this.parseColumnContext(cleanText, text);
    if (columnContext) {
      return columnContext;
    }

    return { type: 'unknown', prefix: '' };
  }

  /**
   * Parse context after FROM, JOIN, INTO, UPDATE, TABLE keywords
   */
  private parseTableContext(textBeforeCursor: string): SqlContext | null {
    // Match: FROM/JOIN/INTO/UPDATE/TABLE followed by optional identifier parts
    // Captures everything after the keyword up to cursor
    const pattern = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+([`\w.]*)?$/i;
    const match = textBeforeCursor.match(pattern);

    if (!match) {
      return null;
    }

    const identifier = match[1] || '';
    return this.parseIdentifier(identifier);
  }

  /**
   * Parse a potentially multi-part identifier (catalog.schema.table)
   */
  private parseIdentifier(identifier: string): SqlContext {
    // Split by dots, handling backticks
    const parts = this.splitIdentifier(identifier);

    // No parts or empty - show schemas from default catalog
    if (parts.length === 0 || (parts.length === 1 && parts[0] === '')) {
      return { type: 'schema', prefix: '' };
    }

    // One part with no trailing dot - prefix filter for schemas
    if (parts.length === 1 && !identifier.endsWith('.')) {
      return { type: 'schema', prefix: parts[0] };
    }

    // One part with trailing dot (e.g., "abc.") - ambiguous
    // Could be catalog. (show schemas) OR schema. (show tables)
    if (parts.length === 1 && identifier.endsWith('.')) {
      return {
        type: 'schema_or_table',
        prefix: '',
        ambiguousFirstPart: parts[0],
      };
    }

    // Two parts - either typing in catalog.schema or schema.table context
    if (parts.length === 2) {
      if (identifier.endsWith('.')) {
        // "catalog.schema." - show tables
        return {
          type: 'table',
          catalogName: parts[0],
          schemaName: parts[1],
          prefix: '',
        };
      } else {
        // "catalog.sch" or "schema.tab" - still ambiguous, filter by prefix
        return {
          type: 'schema_or_table',
          ambiguousFirstPart: parts[0],
          prefix: parts[1],
        };
      }
    }

    // Three parts - explicit catalog.schema.table
    if (parts.length === 3) {
      if (identifier.endsWith('.')) {
        // "catalog.schema.table." - would be column context but handled elsewhere
        return { type: 'unknown', prefix: '' };
      } else {
        // "catalog.schema.tab" - filter tables
        return {
          type: 'table',
          catalogName: parts[0],
          schemaName: parts[1],
          prefix: parts[2],
        };
      }
    }

    return { type: 'unknown', prefix: '' };
  }

  /**
   * Parse column context (after table alias or in SELECT/WHERE clauses)
   */
  private parseColumnContext(textBeforeCursor: string, fullText: string): SqlContext | null {
    // Check for table.column or alias.column pattern
    const dotPattern = /([`\w]+)\.([`\w]*)$/;
    const dotMatch = textBeforeCursor.match(dotPattern);

    if (!dotMatch) {
      return null;
    }

    const aliasOrTable = this.stripBackticks(dotMatch[1]);
    const prefix = this.stripBackticks(dotMatch[2]);

    // Check if we're in a column context (SELECT, WHERE, etc.)
    const isColumnContext = this.isInColumnContext(textBeforeCursor);
    if (!isColumnContext) {
      return null;
    }

    // Try to find matching table reference
    const tableRefs = this.extractTableReferences(fullText);
    const matchingRef = tableRefs.find(
      (ref) => ref.alias === aliasOrTable || ref.tableName === aliasOrTable
    );

    if (matchingRef) {
      return {
        type: 'column',
        catalogName: matchingRef.catalogName,
        schemaName: matchingRef.schemaName,
        tableName: matchingRef.tableName,
        prefix,
      };
    }

    // No matching table reference found - might be a direct table reference
    // Check if aliasOrTable could be a schema.table reference
    const beforeDot = textBeforeCursor.substring(0, textBeforeCursor.lastIndexOf(aliasOrTable));
    const schemaMatch = beforeDot.match(/([`\w]+)\.\s*$/);

    if (schemaMatch) {
      // Pattern: schema.table.column
      return {
        type: 'column',
        schemaName: this.stripBackticks(schemaMatch[1]),
        tableName: aliasOrTable,
        prefix,
      };
    }

    return null;
  }

  /**
   * Check if cursor position is in a column context
   */
  private isInColumnContext(text: string): boolean {
    const upperText = text.toUpperCase();

    // Find the last occurrence of table-context keywords
    const fromIndex = upperText.lastIndexOf('FROM');
    const joinIndex = upperText.lastIndexOf('JOIN');
    const tableKeywordIndex = Math.max(fromIndex, joinIndex);

    // Find column-context keywords after table keywords
    const selectIndex = upperText.lastIndexOf('SELECT');
    const whereIndex = upperText.lastIndexOf('WHERE');
    const andIndex = upperText.lastIndexOf(' AND ');
    const orIndex = upperText.lastIndexOf(' OR ');
    const onIndex = upperText.lastIndexOf(' ON ');
    const orderIndex = upperText.lastIndexOf('ORDER BY');
    const groupIndex = upperText.lastIndexOf('GROUP BY');
    const setIndex = upperText.lastIndexOf('SET');

    // If we're after a column keyword, we're in column context
    const columnKeywordIndex = Math.max(
      selectIndex,
      whereIndex,
      andIndex,
      orIndex,
      onIndex,
      orderIndex,
      groupIndex,
      setIndex
    );

    // We're in column context if:
    // 1. We found a column keyword, AND
    // 2. The cursor is after that keyword, AND
    // 3. Either there's no table keyword after the column keyword, OR we're in SELECT before FROM
    if (columnKeywordIndex === -1) {
      return false;
    }

    // SELECT clause (before FROM) is always column context
    if (selectIndex > -1 && (tableKeywordIndex === -1 || selectIndex > tableKeywordIndex)) {
      return true;
    }

    // WHERE, ORDER BY, GROUP BY, ON, AND, OR after FROM are column context
    if (tableKeywordIndex > -1 && columnKeywordIndex > tableKeywordIndex) {
      return true;
    }

    return false;
  }

  /**
   * Extract table references from SQL (for column completion)
   */
  extractTableReferences(sql: string): TableReference[] {
    const references: TableReference[] = [];

    // Match: FROM/JOIN [catalog.][schema.]table [AS] [alias]
    const pattern = /\b(?:FROM|JOIN)\s+(`?[\w]+`?(?:\.`?[\w]+`?){0,2})(?:\s+(?:AS\s+)?(`?[\w]+`?))?/gi;

    let match;
    while ((match = pattern.exec(sql)) !== null) {
      const fullName = match[1];
      const alias = match[2] ? this.stripBackticks(match[2]) : undefined;
      const parts = this.splitIdentifier(fullName);

      let ref: TableReference;
      if (parts.length === 3) {
        ref = {
          catalogName: parts[0],
          schemaName: parts[1],
          tableName: parts[2],
          alias,
        };
      } else if (parts.length === 2) {
        ref = {
          schemaName: parts[0],
          tableName: parts[1],
          alias,
        };
      } else {
        ref = {
          tableName: parts[0],
          alias,
        };
      }

      references.push(ref);
    }

    return references;
  }

  /**
   * Split identifier by dots, handling backticks
   */
  private splitIdentifier(identifier: string): string[] {
    const parts: string[] = [];
    let current = '';
    let inBackticks = false;

    for (const char of identifier) {
      if (char === '`') {
        inBackticks = !inBackticks;
      } else if (char === '.' && !inBackticks) {
        parts.push(this.stripBackticks(current));
        current = '';
      } else {
        current += char;
      }
    }

    if (current) {
      parts.push(this.stripBackticks(current));
    }

    return parts;
  }

  /**
   * Remove backticks from identifier
   */
  private stripBackticks(identifier: string): string {
    return identifier.replace(/`/g, '');
  }

  /**
   * Remove SQL comments from text
   */
  private removeComments(text: string): string {
    return text
      .replace(/--.*$/gm, '') // Single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, ''); // Multi-line comments
  }
}
