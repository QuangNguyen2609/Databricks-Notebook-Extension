/**
 * Catalog Service for Databricks Intellisense
 *
 * Fetches catalog metadata (catalogs, schemas, tables, columns) from Databricks
 * via the Python kernel. Implements lazy loading with in-memory caching.
 *
 * Cache is cleared only on kernel restart - no repeated queries during a session.
 *
 * IMPORTANT: Results are only cached when the executor is available and running.
 * Failed queries due to executor not being ready are NOT cached, allowing retry
 * on subsequent requests once the executor is available.
 */

import { PersistentExecutor } from '../kernels/persistentExecutor';
import { RequestCache, FetchResult } from '../utils/requestCache';
import { CatalogInfo, SchemaInfo, TableInfo, ColumnInfo } from './types';

/**
 * Result from executing code, distinguishing between "executor not available"
 * and "query executed but returned null/empty"
 */
interface ExecuteResult {
  /** Whether the executor was available and query was attempted */
  executed: boolean;
  /** The result data (null if query failed or returned no data) */
  data: unknown;
}

/**
 * Service for fetching and caching Databricks catalog metadata
 */
export class CatalogService {
  // Request caches with deduplication for each data type
  private _catalogsCache = new RequestCache<CatalogInfo[]>();
  private _schemasCache = new RequestCache<SchemaInfo[]>();
  private _tablesCache = new RequestCache<TableInfo[]>();
  private _columnsCache = new RequestCache<ColumnInfo[]>();
  private _defaultCatalogCache = new RequestCache<string | null>();
  private _defaultSchemaCache = new RequestCache<string | null>();

  constructor(private getExecutor: () => PersistentExecutor | null) {}

  /**
   * Get the default catalog (fetched once per session)
   * Only caches result if executor was available - allows retry if executor wasn't ready
   */
  async getDefaultCatalog(): Promise<string | null> {
    return this._defaultCatalogCache.getOrFetch('default', async (): Promise<FetchResult<string | null>> => {
      const result = await this.fetchDefaultCatalog();
      return {
        shouldCache: result.executed,
        data: result.data as string | null,
      };
    });
  }

  /**
   * Get the default schema/database (fetched once per session)
   * Only caches result if executor was available - allows retry if executor wasn't ready
   */
  async getDefaultSchema(): Promise<string | null> {
    return this._defaultSchemaCache.getOrFetch('default', async (): Promise<FetchResult<string | null>> => {
      const result = await this.fetchDefaultSchema();
      return {
        shouldCache: result.executed,
        data: result.data as string | null,
      };
    });
  }

  /**
   * Get all catalogs (fetched once per session)
   * Only caches result if executor was available - allows retry if executor wasn't ready
   */
  async getCatalogs(): Promise<CatalogInfo[]> {
    return this._catalogsCache.getOrFetch('catalogs', async (): Promise<FetchResult<CatalogInfo[]>> => {
      const result = await this.fetchCatalogs();
      return {
        shouldCache: result.executed,
        data: (result.data as CatalogInfo[]) || [],
      };
    });
  }

  /**
   * Get schemas in a catalog (fetched once per catalog per session)
   * Only caches result if executor was available - allows retry if executor wasn't ready
   */
  async getSchemas(catalogName: string): Promise<SchemaInfo[]> {
    return this._schemasCache.getOrFetch(catalogName, async (): Promise<FetchResult<SchemaInfo[]>> => {
      const result = await this.fetchSchemas(catalogName);
      return {
        shouldCache: result.executed,
        data: (result.data as SchemaInfo[]) || [],
      };
    });
  }

  /**
   * Get tables in a schema (fetched once per catalog.schema per session)
   * Only caches result if executor was available - allows retry if executor wasn't ready
   */
  async getTables(catalogName: string, schemaName: string): Promise<TableInfo[]> {
    const cacheKey = `${catalogName}.${schemaName}`;
    return this._tablesCache.getOrFetch(cacheKey, async (): Promise<FetchResult<TableInfo[]>> => {
      const result = await this.fetchTables(catalogName, schemaName);
      return {
        shouldCache: result.executed,
        data: (result.data as TableInfo[]) || [],
      };
    });
  }

  /**
   * Get columns in a table (fetched once per catalog.schema.table per session)
   * Only caches result if executor was available - allows retry if executor wasn't ready
   */
  async getColumns(
    catalogName: string,
    schemaName: string,
    tableName: string
  ): Promise<ColumnInfo[]> {
    const cacheKey = `${catalogName}.${schemaName}.${tableName}`;
    return this._columnsCache.getOrFetch(cacheKey, async (): Promise<FetchResult<ColumnInfo[]>> => {
      const result = await this.fetchColumns(catalogName, schemaName, tableName);
      return {
        shouldCache: result.executed,
        data: (result.data as ColumnInfo[]) || [],
      };
    });
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
    this._defaultCatalogCache.clear();
    this._defaultSchemaCache.clear();
    this._catalogsCache.clear();
    this._schemasCache.clear();
    this._tablesCache.clear();
    this._columnsCache.clear();
    console.log('[CatalogService] Cache cleared');
  }

  // ========== Private fetch methods ==========

  private async fetchDefaultCatalog(): Promise<ExecuteResult> {
    const code = `
import json
try:
    _default_catalog = spark.catalog.currentCatalog()
    print(json.dumps({"defaultCatalog": _default_catalog}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;
    const execResult = await this.executeCode(code);
    if (!execResult.executed) {
      return { executed: false, data: null };
    }
    const result = execResult.data as { defaultCatalog?: string } | null;
    if (result && result.defaultCatalog) {
      return { executed: true, data: result.defaultCatalog };
    }
    return { executed: true, data: null };
  }

  private async fetchDefaultSchema(): Promise<ExecuteResult> {
    const code = `
import json
try:
    _default_schema = spark.catalog.currentDatabase()
    print(json.dumps({"defaultSchema": _default_schema}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;
    const execResult = await this.executeCode(code);
    if (!execResult.executed) {
      return { executed: false, data: null };
    }
    const result = execResult.data as { defaultSchema?: string } | null;
    if (result && result.defaultSchema) {
      return { executed: true, data: result.defaultSchema };
    }
    return { executed: true, data: null };
  }

  private async fetchCatalogs(): Promise<ExecuteResult> {
    const code = `
import json
try:
    _df = spark.sql("SHOW CATALOGS")
    _catalogs = [{"name": r.catalog} for r in _df.collect()]
    print(json.dumps(_catalogs))
except Exception as e:
    print(json.dumps([]))
`;
    const execResult = await this.executeCode(code);
    if (!execResult.executed) {
      return { executed: false, data: [] };
    }
    if (Array.isArray(execResult.data)) {
      return { executed: true, data: execResult.data as CatalogInfo[] };
    }
    return { executed: true, data: [] };
  }

  private async fetchSchemas(catalogName: string): Promise<ExecuteResult> {
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
    const execResult = await this.executeCode(code);
    if (!execResult.executed) {
      return { executed: false, data: [] };
    }
    if (Array.isArray(execResult.data)) {
      return { executed: true, data: execResult.data as SchemaInfo[] };
    }
    return { executed: true, data: [] };
  }

  private async fetchTables(catalogName: string, schemaName: string): Promise<ExecuteResult> {
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
    const execResult = await this.executeCode(code);
    if (!execResult.executed) {
      return { executed: false, data: [] };
    }
    if (Array.isArray(execResult.data)) {
      return { executed: true, data: execResult.data as TableInfo[] };
    }
    return { executed: true, data: [] };
  }

  private async fetchColumns(
    catalogName: string,
    schemaName: string,
    tableName: string
  ): Promise<ExecuteResult> {
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
    const execResult = await this.executeCode(code);
    if (!execResult.executed) {
      return { executed: false, data: [] };
    }
    if (Array.isArray(execResult.data)) {
      return { executed: true, data: execResult.data as ColumnInfo[] };
    }
    return { executed: true, data: [] };
  }

  /**
   * Execute Python code and parse JSON result from stdout
   * Returns ExecuteResult indicating whether executor was available
   */
  private async executeCode(code: string): Promise<ExecuteResult> {
    const executor = this.getExecutor();
    if (!executor || !executor.isRunning()) {
      console.log('[CatalogService] Executor not available - query not executed, will retry on next request');
      return { executed: false, data: null };
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
              return { executed: true, data: JSON.parse(line) };
            } catch {
              continue;
            }
          }
        }
      }
      return { executed: true, data: null };
    } catch (error) {
      console.error('[CatalogService] Execution error:', error);
      return { executed: true, data: null };
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
