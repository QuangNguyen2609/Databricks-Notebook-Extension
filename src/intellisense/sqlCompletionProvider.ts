/**
 * SQL Completion Provider for Databricks Notebooks
 *
 * Provides intellisense for catalogs, schemas, tables, and columns
 * from Databricks Unity Catalog.
 */

import * as vscode from 'vscode';
import { CatalogService } from './catalogService';
import { SqlContextParser } from './sqlParser';
import { SchemaInfo, TableInfo, ColumnInfo, SqlContext } from './types';

/**
 * VS Code CompletionItemProvider for SQL cells in Databricks notebooks
 */
export class SqlCompletionProvider implements vscode.CompletionItemProvider {
  constructor(
    private catalogService: CatalogService,
    private sqlParser: SqlContextParser
  ) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _context: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[] | undefined> {
    // Only provide completions for SQL language
    if (document.languageId !== 'sql') {
      return undefined;
    }

    const text = document.getText();
    const offset = document.offsetAt(position);

    // Parse SQL context
    const context = this.sqlParser.parse(text, offset);

    try {
      switch (context.type) {
        case 'schema':
          return await this.provideSchemaCompletions(context);

        case 'table':
          return await this.provideTableCompletions(context);

        case 'column':
          return await this.provideColumnCompletions(context);

        case 'schema_or_table':
          return await this.provideAmbiguousCompletions(context);

        default:
          return undefined;
      }
    } catch (error) {
      console.error('[SqlCompletionProvider] Error providing completions:', error);
      return undefined;
    }
  }

  /**
   * Provide schema completions (from default catalog if not specified)
   */
  private async provideSchemaCompletions(context: SqlContext): Promise<vscode.CompletionItem[]> {
    // Use specified catalog or default
    let catalogName = context.catalogName;
    if (!catalogName) {
      const defaultCatalog = await this.catalogService.getDefaultCatalog();
      if (!defaultCatalog) {
        return [];
      }
      catalogName = defaultCatalog;
    }

    const schemas = await this.catalogService.getSchemas(catalogName);
    return this.filterAndCreateItems(
      schemas,
      context.prefix,
      (schema) => this.createSchemaItem(schema, catalogName!)
    );
  }

  /**
   * Provide table completions
   */
  private async provideTableCompletions(context: SqlContext): Promise<vscode.CompletionItem[]> {
    let catalogName = context.catalogName;
    const schemaName = context.schemaName;

    if (!schemaName) {
      return [];
    }

    // Use default catalog if not specified
    if (!catalogName) {
      const defaultCatalog = await this.catalogService.getDefaultCatalog();
      if (!defaultCatalog) {
        return [];
      }
      catalogName = defaultCatalog;
    }

    const tables = await this.catalogService.getTables(catalogName, schemaName);
    return this.filterAndCreateItems(tables, context.prefix, (table) =>
      this.createTableItem(table)
    );
  }

  /**
   * Provide column completions
   */
  private async provideColumnCompletions(context: SqlContext): Promise<vscode.CompletionItem[]> {
    let catalogName = context.catalogName;
    let schemaName = context.schemaName;
    const tableName = context.tableName;

    if (!tableName) {
      return [];
    }

    // Use default catalog if not specified
    if (!catalogName) {
      const defaultCatalog = await this.catalogService.getDefaultCatalog();
      if (!defaultCatalog) {
        return [];
      }
      catalogName = defaultCatalog;
    }

    // Use default schema if not specified
    if (!schemaName) {
      const defaultSchema = await this.catalogService.getDefaultSchema();
      if (!defaultSchema) {
        return [];
      }
      schemaName = defaultSchema;
    }

    const columns = await this.catalogService.getColumns(catalogName, schemaName, tableName);
    return this.filterAndCreateItems(columns, context.prefix, (column) =>
      this.createColumnItem(column)
    );
  }

  /**
   * Provide completions for ambiguous context (could be catalog. or schema.)
   * Shows both schemas (if it's a catalog) and tables (if it's a schema in default catalog)
   */
  private async provideAmbiguousCompletions(context: SqlContext): Promise<vscode.CompletionItem[]> {
    const ambiguousPart = context.ambiguousFirstPart;
    if (!ambiguousPart) {
      return [];
    }

    const items: vscode.CompletionItem[] = [];

    // Check if it's a catalog - show schemas from that catalog
    const isCatalog = await this.catalogService.isCatalog(ambiguousPart);
    if (isCatalog) {
      const schemas = await this.catalogService.getSchemas(ambiguousPart);
      const schemaItems = this.filterAndCreateItems(schemas, context.prefix, (schema) =>
        this.createSchemaItem(schema, ambiguousPart)
      );
      items.push(...schemaItems);
    }

    // Check if it's a schema in default catalog - show tables from that schema
    const isSchemaInDefault = await this.catalogService.isSchemaInDefaultCatalog(ambiguousPart);
    if (isSchemaInDefault) {
      const defaultCatalog = await this.catalogService.getDefaultCatalog();
      if (defaultCatalog) {
        const tables = await this.catalogService.getTables(defaultCatalog, ambiguousPart);
        const tableItems = this.filterAndCreateItems(tables, context.prefix, (table) =>
          this.createTableItem(table)
        );
        items.push(...tableItems);
      }
    }

    return items;
  }

  /**
   * Filter items by prefix and create completion items
   */
  private filterAndCreateItems<T extends { name: string }>(
    items: T[],
    prefix: string,
    createItem: (item: T) => vscode.CompletionItem
  ): vscode.CompletionItem[] {
    const lowerPrefix = prefix.toLowerCase();
    return items
      .filter((item) => item.name.toLowerCase().startsWith(lowerPrefix))
      .map(createItem);
  }

  /**
   * Create completion item for a schema
   */
  private createSchemaItem(schema: SchemaInfo, catalogName: string): vscode.CompletionItem {
    const item = new vscode.CompletionItem(schema.name, vscode.CompletionItemKind.Folder);
    item.detail = `Schema in ${catalogName}`;
    item.insertText = this.quoteIfNeeded(schema.name);
    // Trigger completion again after inserting schema
    item.command = {
      command: 'editor.action.triggerSuggest',
      title: 'Trigger Suggest',
    };
    return item;
  }

  /**
   * Create completion item for a table
   */
  private createTableItem(table: TableInfo): vscode.CompletionItem {
    const item = new vscode.CompletionItem(table.name, vscode.CompletionItemKind.Class);
    item.detail = `Table in ${table.catalogName}.${table.schemaName}`;
    item.insertText = this.quoteIfNeeded(table.name);
    return item;
  }

  /**
   * Create completion item for a column
   */
  private createColumnItem(column: ColumnInfo): vscode.CompletionItem {
    const item = new vscode.CompletionItem(column.name, vscode.CompletionItemKind.Field);
    item.detail = column.dataType;
    item.insertText = this.quoteIfNeeded(column.name);
    return item;
  }

  /**
   * Quote identifier if it contains special characters
   */
  private quoteIfNeeded(identifier: string): string {
    // Quote if not a simple identifier (letters, numbers, underscore)
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
      return identifier;
    }
    return `\`${identifier}\``;
  }
}
