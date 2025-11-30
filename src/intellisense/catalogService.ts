/**
 * Catalog Service for Databricks Intellisense
 *
 * Fetches catalog metadata (catalogs, schemas, tables, columns) from Databricks
 * via the Python kernel. Implements lazy loading with in-memory caching.
 *
 * Cache is cleared only on kernel restart - no repeated queries during a session.
 */

import { PersistentExecutor } from '../kernels/persistentExecutor';
import { CatalogInfo, SchemaInfo, TableInfo, ColumnInfo } from './types';

/**
 * Service for fetching and caching Databricks catalog metadata
 */
export class CatalogService {
  // Default catalog (fetched once per session)
  private defaultCatalog: string | null = null;
  private defaultCatalogFetched = false;

  // Default schema/database (fetched once per session)
  private defaultSchema: string | null = null;
  private defaultSchemaFetched = false;

  // Cache - populated on first use, never refetched until clearCache()
  private catalogCache: CatalogInfo[] | null = null;
  private schemaCache = new Map<string, SchemaInfo[]>(); // key: catalogName
  private tableCache = new Map<string, TableInfo[]>(); // key: catalog.schema
  private columnCache = new Map<string, ColumnInfo[]>(); // key: catalog.schema.table

  // Track in-flight requests to avoid duplicate queries
  private pendingRequests = new Map<string, Promise<unknown>>();

  constructor(private getExecutor: () => PersistentExecutor | null) {}

  /**
   * Get the default catalog (fetched once per session)
   */
  async getDefaultCatalog(): Promise<string | null> {
    if (this.defaultCatalogFetched) {
      return this.defaultCatalog;
    }

    const key = 'defaultCatalog';
    if (this.pendingRequests.has(key)) {
      await this.pendingRequests.get(key);
      return this.defaultCatalog;
    }

    const promise = this.fetchDefaultCatalog();
    this.pendingRequests.set(key, promise);

    try {
      this.defaultCatalog = await promise;
      this.defaultCatalogFetched = true;
      return this.defaultCatalog;
    } finally {
      this.pendingRequests.delete(key);
    }
  }

  /**
   * Get the default schema/database (fetched once per session)
   */
  async getDefaultSchema(): Promise<string | null> {
    if (this.defaultSchemaFetched) {
      return this.defaultSchema;
    }

    const key = 'defaultSchema';
    if (this.pendingRequests.has(key)) {
      await this.pendingRequests.get(key);
      return this.defaultSchema;
    }

    const promise = this.fetchDefaultSchema();
    this.pendingRequests.set(key, promise);

    try {
      this.defaultSchema = await promise;
      this.defaultSchemaFetched = true;
      return this.defaultSchema;
    } finally {
      this.pendingRequests.delete(key);
    }
  }

  /**
   * Get all catalogs (fetched once per session)
   */
  async getCatalogs(): Promise<CatalogInfo[]> {
    if (this.catalogCache !== null) {
      return this.catalogCache;
    }

    const key = 'catalogs';
    if (this.pendingRequests.has(key)) {
      await this.pendingRequests.get(key);
      return this.catalogCache || [];
    }

    const promise = this.fetchCatalogs();
    this.pendingRequests.set(key, promise);

    try {
      this.catalogCache = await promise;
      return this.catalogCache;
    } finally {
      this.pendingRequests.delete(key);
    }
  }

  /**
   * Get schemas in a catalog (fetched once per catalog per session)
   */
  async getSchemas(catalogName: string): Promise<SchemaInfo[]> {
    const cached = this.schemaCache.get(catalogName);
    if (cached !== undefined) {
      return cached;
    }

    const key = `schemas:${catalogName}`;
    if (this.pendingRequests.has(key)) {
      await this.pendingRequests.get(key);
      return this.schemaCache.get(catalogName) || [];
    }

    const promise = this.fetchSchemas(catalogName);
    this.pendingRequests.set(key, promise);

    try {
      const schemas = await promise;
      this.schemaCache.set(catalogName, schemas);
      return schemas;
    } finally {
      this.pendingRequests.delete(key);
    }
  }

  /**
   * Get tables in a schema (fetched once per catalog.schema per session)
   */
  async getTables(catalogName: string, schemaName: string): Promise<TableInfo[]> {
    const cacheKey = `${catalogName}.${schemaName}`;
    const cached = this.tableCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const key = `tables:${cacheKey}`;
    if (this.pendingRequests.has(key)) {
      await this.pendingRequests.get(key);
      return this.tableCache.get(cacheKey) || [];
    }

    const promise = this.fetchTables(catalogName, schemaName);
    this.pendingRequests.set(key, promise);

    try {
      const tables = await promise;
      this.tableCache.set(cacheKey, tables);
      return tables;
    } finally {
      this.pendingRequests.delete(key);
    }
  }

  /**
   * Get columns in a table (fetched once per catalog.schema.table per session)
   */
  async getColumns(
    catalogName: string,
    schemaName: string,
    tableName: string
  ): Promise<ColumnInfo[]> {
    const cacheKey = `${catalogName}.${schemaName}.${tableName}`;
    const cached = this.columnCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const key = `columns:${cacheKey}`;
    if (this.pendingRequests.has(key)) {
      await this.pendingRequests.get(key);
      return this.columnCache.get(cacheKey) || [];
    }

    const promise = this.fetchColumns(catalogName, schemaName, tableName);
    this.pendingRequests.set(key, promise);

    try {
      const columns = await promise;
      this.columnCache.set(cacheKey, columns);
      return columns;
    } finally {
      this.pendingRequests.delete(key);
    }
  }

  /**
   * Check if a name matches any known catalog
   */
  async isCatalog(name: string): Promise<boolean> {
    const catalogs = await this.getCatalogs();
    return catalogs.some((c) => c.name.toLowerCase() === name.toLowerCase());
  }

  /**
   * Check if a name matches any schema in the default catalog
   */
  async isSchemaInDefaultCatalog(name: string): Promise<boolean> {
    const defaultCatalog = await this.getDefaultCatalog();
    if (!defaultCatalog) {
      return false;
    }

    const schemas = await this.getSchemas(defaultCatalog);
    return schemas.some((s) => s.name.toLowerCase() === name.toLowerCase());
  }

  /**
   * Clear all cached data (call on kernel restart)
   */
  clearCache(): void {
    this.defaultCatalog = null;
    this.defaultCatalogFetched = false;
    this.defaultSchema = null;
    this.defaultSchemaFetched = false;
    this.catalogCache = null;
    this.schemaCache.clear();
    this.tableCache.clear();
    this.columnCache.clear();
    this.pendingRequests.clear();
    console.log('[CatalogService] Cache cleared');
  }

  // ========== Private fetch methods ==========

  private async fetchDefaultCatalog(): Promise<string | null> {
    const code = `
import json
try:
    _default_catalog = spark.catalog.currentCatalog()
    print(json.dumps({"defaultCatalog": _default_catalog}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;
    const result = await this.executeCode(code) as { defaultCatalog?: string } | null;
    if (result && result.defaultCatalog) {
      return result.defaultCatalog;
    }
    return null;
  }

  private async fetchDefaultSchema(): Promise<string | null> {
    const code = `
import json
try:
    _default_schema = spark.catalog.currentDatabase()
    print(json.dumps({"defaultSchema": _default_schema}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;
    const result = await this.executeCode(code) as { defaultSchema?: string } | null;
    if (result && result.defaultSchema) {
      return result.defaultSchema;
    }
    return null;
  }

  private async fetchCatalogs(): Promise<CatalogInfo[]> {
    const code = `
import json
try:
    _df = spark.sql("SHOW CATALOGS")
    _catalogs = [{"name": r.catalog} for r in _df.collect()]
    print(json.dumps(_catalogs))
except Exception as e:
    print(json.dumps([]))
`;
    const result = await this.executeCode(code);
    if (Array.isArray(result)) {
      return result as CatalogInfo[];
    }
    return [];
  }

  private async fetchSchemas(catalogName: string): Promise<SchemaInfo[]> {
    const escapedCatalog = this.escapeIdentifier(catalogName);
    const code = `
import json
try:
    _df = spark.sql("SHOW SCHEMAS IN \`${escapedCatalog}\`")
    _schemas = [{"name": r.databaseName, "catalogName": "${escapedCatalog}"} for r in _df.collect()]
    print(json.dumps(_schemas))
except Exception as e:
    print(json.dumps([]))
`;
    const result = await this.executeCode(code);
    if (Array.isArray(result)) {
      return result as SchemaInfo[];
    }
    return [];
  }

  private async fetchTables(catalogName: string, schemaName: string): Promise<TableInfo[]> {
    const escapedCatalog = this.escapeIdentifier(catalogName);
    const escapedSchema = this.escapeIdentifier(schemaName);
    const code = `
import json
try:
    _df = spark.sql("SHOW TABLES IN \`${escapedCatalog}\`.\`${escapedSchema}\`")
    _tables = [{"name": r.tableName, "schemaName": "${escapedSchema}", "catalogName": "${escapedCatalog}"} for r in _df.collect()]
    print(json.dumps(_tables))
except Exception as e:
    print(json.dumps([]))
`;
    const result = await this.executeCode(code);
    if (Array.isArray(result)) {
      return result as TableInfo[];
    }
    return [];
  }

  private async fetchColumns(
    catalogName: string,
    schemaName: string,
    tableName: string
  ): Promise<ColumnInfo[]> {
    const escapedCatalog = this.escapeIdentifier(catalogName);
    const escapedSchema = this.escapeIdentifier(schemaName);
    const escapedTable = this.escapeIdentifier(tableName);
    const code = `
import json
try:
    _df = spark.sql("DESCRIBE \`${escapedCatalog}\`.\`${escapedSchema}\`.\`${escapedTable}\`")
    _cols = [{"name": r.col_name, "dataType": r.data_type} for r in _df.collect() if not r.col_name.startswith("#")]
    print(json.dumps(_cols))
except Exception as e:
    print(json.dumps([]))
`;
    const result = await this.executeCode(code);
    if (Array.isArray(result)) {
      return result as ColumnInfo[];
    }
    return [];
  }

  /**
   * Execute Python code and parse JSON result from stdout
   */
  private async executeCode(code: string): Promise<unknown> {
    const executor = this.getExecutor();
    if (!executor || !executor.isRunning()) {
      console.log('[CatalogService] Executor not available');
      return null;
    }

    try {
      const result = await executor.execute(code, 30000); // 30 second timeout
      if (result.success && result.stdout) {
        // Find the last line that looks like JSON
        const lines = result.stdout.trim().split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].trim();
          if (line.startsWith('{') || line.startsWith('[')) {
            try {
              return JSON.parse(line);
            } catch {
              continue;
            }
          }
        }
      }
      return null;
    } catch (error) {
      console.error('[CatalogService] Execution error:', error);
      return null;
    }
  }

  /**
   * Escape identifier for use in SQL (prevent injection)
   */
  private escapeIdentifier(identifier: string): string {
    // Remove any existing backticks and escape special characters
    return identifier.replace(/`/g, '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
}
