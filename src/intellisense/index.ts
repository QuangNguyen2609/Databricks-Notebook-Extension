/**
 * Intellisense module for Databricks Notebooks
 *
 * Provides SQL completion for catalogs, schemas, tables, and columns
 * from Databricks Unity Catalog.
 */

export { CatalogService } from './catalogService';
export { SqlCompletionProvider } from './sqlCompletionProvider';
export { SqlContextParser } from './sqlParser';
export type {
  CatalogInfo,
  SchemaInfo,
  TableInfo,
  ColumnInfo,
  SqlContext,
  SqlContextType,
} from './types';
