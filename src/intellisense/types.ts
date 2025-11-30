/**
 * Type definitions for Databricks Catalog Intellisense
 */

/**
 * Represents a catalog in Unity Catalog
 */
export interface CatalogInfo {
  name: string;
}

/**
 * Represents a schema within a catalog
 */
export interface SchemaInfo {
  name: string;
  catalogName: string;
}

/**
 * Represents a table within a schema
 */
export interface TableInfo {
  name: string;
  schemaName: string;
  catalogName: string;
}

/**
 * Represents a column within a table
 */
export interface ColumnInfo {
  name: string;
  dataType: string;
}

/**
 * SQL context types for completion
 */
export type SqlContextType = 'schema' | 'table' | 'column' | 'schema_or_table' | 'unknown';

/**
 * SQL context at cursor position for completion
 */
export interface SqlContext {
  /** Type of completion to provide */
  type: SqlContextType;
  /** Partial text user is typing (for filtering) */
  prefix: string;
  /** Catalog name if specified (3-level naming) */
  catalogName?: string;
  /** Schema name if specified */
  schemaName?: string;
  /** Table name if specified (for column completion) */
  tableName?: string;
  /** Whether this is an ambiguous 2-part reference that could be catalog.schema or schema.table */
  ambiguousFirstPart?: string;
}
