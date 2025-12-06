/**
 * Intellisense module for Databricks Notebooks
 *
 * Provides:
 * - SQL completion for catalogs, schemas, tables, and columns from Databricks Unity Catalog
 * - Python completion for spark and dbutils
 * - Type stubs for dbutils modules
 */

export { CatalogService } from './catalogService';
export { SqlCompletionProvider } from './sqlCompletionProvider';
export { SqlContextParser } from './sqlParser';
export { PythonCompletionProvider } from './pythonCompletionProvider';
export { generateDbutilsTypeStub } from './dbutilsTypeStubs';
export type {
  CatalogInfo,
  SchemaInfo,
  TableInfo,
  ColumnInfo,
  SqlContext,
  SqlContextType,
} from './types';
