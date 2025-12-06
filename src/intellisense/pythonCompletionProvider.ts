/**
 * Python Completion Provider for Databricks notebooks
 *
 * Provides code completions for Python cells in Databricks notebooks.
 * - Live completions for spark and its sub-objects (queries kernel for methods)
 * - Live completions for any Python variable (queries kernel for type and methods)
 * - Static completions for dbutils (from type stubs)
 */

import * as vscode from 'vscode';
import { PersistentExecutor } from '../kernels/persistentExecutor';
import { RequestCache, FetchResult } from '../utils/requestCache';

// Regex to match spark object access patterns like "spark.", "spark.catalog.", "spark.read.format("csv")."
const SPARK_OBJECT_REGEX = /\bspark(\.[a-zA-Z_][a-zA-Z0-9_]*)*\.$/;

// Regex to match any variable access pattern like "df.", "result.", "my_var."
const VARIABLE_DOT_REGEX = /\b([a-zA-Z_][a-zA-Z0-9_]*)\.$/;

// Reserved keywords and built-ins that shouldn't trigger completions
const RESERVED_WORDS = new Set([
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
  'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from',
  'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not',
  'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
  'True', 'False', 'None'
]);

/**
 * Provides code completions for Python cells in Databricks notebooks.
 * - Live completions for spark and its sub-objects (queries kernel dynamically)
 * - Live completions for any Python variable (queries kernel for type and methods)
 * - Static completions for dbutils (from type stubs)
 */
export class PythonCompletionProvider implements vscode.CompletionItemProvider {
  private _completionsCache = new RequestCache<vscode.CompletionItem[]>();
  private _dbutilsCompletions: Map<string, vscode.CompletionItem[]>;

  constructor(
    private getExecutor: () => PersistentExecutor | null
  ) {
    this._dbutilsCompletions = this.buildDbutilsCompletions();
  }

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _context: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[] | undefined> {
    // Only for Python cells
    if (document.languageId !== 'python') {
      return undefined;
    }

    // Check if IntelliSense is enabled
    const config = vscode.workspace.getConfiguration('databricks-notebook.intellisense');
    if (!config.get<boolean>('enabled', true)) {
      return undefined;
    }

    const linePrefix = document.lineAt(position).text.substring(0, position.character);

    // Check for dbutils completions first (static, always available)
    if (linePrefix.endsWith('dbutils.')) {
      return this._dbutilsCompletions.get('dbutils');
    }
    if (linePrefix.endsWith('dbutils.fs.')) {
      return this._dbutilsCompletions.get('dbutils.fs');
    }
    if (linePrefix.endsWith('dbutils.notebook.')) {
      return this._dbutilsCompletions.get('dbutils.notebook');
    }
    if (linePrefix.endsWith('dbutils.secrets.')) {
      return this._dbutilsCompletions.get('dbutils.secrets');
    }
    if (linePrefix.endsWith('dbutils.widgets.')) {
      return this._dbutilsCompletions.get('dbutils.widgets');
    }

    // Check for spark object completions (spark., spark.catalog., spark.read., etc.)
    if (config.get<boolean>('sparkLiveCompletions', true)) {
      const sparkMatch = linePrefix.match(SPARK_OBJECT_REGEX);
      if (sparkMatch) {
        // Extract the spark object path (e.g., "spark" or "spark.catalog" or "spark.read")
        const sparkPath = sparkMatch[0].slice(0, -1); // Remove trailing dot
        return this.getVariableCompletions(sparkPath);
      }
    }

    // Check for any variable completions (live kernel query)
    if (config.get<boolean>('dataFrameCompletions', true)) {
      const variableMatch = linePrefix.match(VARIABLE_DOT_REGEX);
      if (variableMatch) {
        const varName = variableMatch[1];

        // Skip reserved words and dbutils/spark (handled separately)
        if (RESERVED_WORDS.has(varName) || varName === 'dbutils' || varName === 'spark') {
          return undefined;
        }

        return this.getVariableCompletions(varName);
      }
    }

    return undefined;
  }

  /**
   * Get completions for a variable by querying the kernel
   * Uses caching to avoid repeated queries for the same variable
   */
  private async getVariableCompletions(varName: string): Promise<vscode.CompletionItem[]> {
    return this._completionsCache.getOrFetch(varName, async (): Promise<FetchResult<vscode.CompletionItem[]>> => {
      const items = await this.fetchVariableMethods(varName);
      // Cache successful results, don't cache empty results (variable might be defined later)
      return { shouldCache: items.length > 0, data: items };
    });
  }

  /**
   * Fetch methods for a variable by querying the kernel
   * Returns the variable's type and all its public methods/attributes
   */
  private async fetchVariableMethods(varName: string): Promise<vscode.CompletionItem[]> {
    const executor = this.getExecutor();
    if (!executor || !executor.isRunning()) {
      // No kernel available
      return [];
    }

    // Query the kernel for the variable's type and methods
    const code = `
import json
try:
    obj = ${varName}
    obj_type = type(obj).__name__
    # Get module for more specific type info
    obj_module = type(obj).__module__
    if obj_module and obj_module != 'builtins':
        full_type = f"{obj_module}.{obj_type}"
    else:
        full_type = obj_type

    # Get all public attributes and methods
    members = []
    for name in dir(obj):
        if name.startswith('_'):
            continue
        try:
            attr = getattr(obj, name)
            is_callable = callable(attr)
            members.append({'name': name, 'isMethod': is_callable})
        except:
            members.append({'name': name, 'isMethod': False})

    print(json.dumps({'type': full_type, 'members': members}))
except NameError:
    print(json.dumps({'error': 'not_defined'}))
except Exception as e:
    print(json.dumps({'error': str(e)}))
`;

    try {
      const result = await executor.execute(code, 5000);
      if (result.success && result.stdout) {
        const data = JSON.parse(result.stdout.trim());

        if (data.error) {
          // Variable not defined or other error
          return [];
        }

        const typeName = data.type as string;
        const members = data.members as Array<{ name: string; isMethod: boolean }>;

        return members.map(member => {
          const kind = member.isMethod
            ? vscode.CompletionItemKind.Method
            : vscode.CompletionItemKind.Property;
          const item = new vscode.CompletionItem(member.name, kind);
          item.detail = `${typeName}${member.isMethod ? ' method' : ' property'}`;
          return item;
        });
      }
    } catch (error) {
      console.error(`[PythonCompletionProvider] Failed to fetch ${varName} methods:`, error);
    }

    return [];
  }

  private buildDbutilsCompletions(): Map<string, vscode.CompletionItem[]> {
    const completions = new Map<string, vscode.CompletionItem[]>();

    // dbutils modules
    completions.set('dbutils', [
      this.createModuleItem('fs', 'File system utilities'),
      this.createModuleItem('notebook', 'Notebook utilities'),
      this.createModuleItem('secrets', 'Secrets management'),
      this.createModuleItem('widgets', 'Input widgets'),
    ]);

    // dbutils.fs methods
    completions.set('dbutils.fs', [
      this.createMethodItem('ls', 'List files', 'ls(path: str) -> List[FileInfo]'),
      this.createMethodItem('cp', 'Copy files', 'cp(src: str, dst: str, recurse: bool = False) -> bool'),
      this.createMethodItem('mv', 'Move files', 'mv(src: str, dst: str, recurse: bool = False) -> bool'),
      this.createMethodItem('rm', 'Remove files', 'rm(path: str, recurse: bool = False) -> bool'),
      this.createMethodItem('mkdirs', 'Create directories', 'mkdirs(path: str) -> bool'),
      this.createMethodItem('head', 'Read file head', 'head(path: str, maxBytes: int = 65536) -> str'),
      this.createMethodItem('put', 'Write file', 'put(path: str, contents: str, overwrite: bool = False) -> bool'),
    ]);

    // dbutils.notebook methods
    completions.set('dbutils.notebook', [
      this.createMethodItem('run', 'Run another notebook', 'run(path: str, timeout: int = 0, arguments: Dict = None) -> str'),
      this.createMethodItem('exit', 'Exit notebook with value', 'exit(value: str) -> None'),
    ]);

    // dbutils.secrets methods
    completions.set('dbutils.secrets', [
      this.createMethodItem('get', 'Get secret value', 'get(scope: str, key: str) -> str'),
      this.createMethodItem('getBytes', 'Get secret as bytes', 'getBytes(scope: str, key: str) -> bytes'),
      this.createMethodItem('list', 'List secrets in scope', 'list(scope: str) -> List[SecretMetadata]'),
      this.createMethodItem('listScopes', 'List all scopes', 'listScopes() -> List[SecretScope]'),
    ]);

    // dbutils.widgets methods
    completions.set('dbutils.widgets', [
      this.createMethodItem('text', 'Create text widget', 'text(name: str, defaultValue: str = "", label: str = None) -> None'),
      this.createMethodItem('dropdown', 'Create dropdown widget', 'dropdown(name: str, defaultValue: str, choices: List[str], label: str = None) -> None'),
      this.createMethodItem('multiselect', 'Create multiselect widget', 'multiselect(name: str, defaultValue: str, choices: List[str], label: str = None) -> None'),
      this.createMethodItem('combobox', 'Create combobox widget', 'combobox(name: str, defaultValue: str, choices: List[str], label: str = None) -> None'),
      this.createMethodItem('get', 'Get widget value', 'get(name: str) -> str'),
      this.createMethodItem('getAll', 'Get all widget values', 'getAll() -> Dict[str, str]'),
      this.createMethodItem('remove', 'Remove widget', 'remove(name: str) -> None'),
      this.createMethodItem('removeAll', 'Remove all widgets', 'removeAll() -> None'),
    ]);

    return completions;
  }

  private createModuleItem(name: string, detail: string): vscode.CompletionItem {
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
    item.detail = detail;
    return item;
  }

  private createMethodItem(name: string, detail: string, signature: string): vscode.CompletionItem {
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Method);
    item.detail = detail;
    item.documentation = new vscode.MarkdownString(`\`${signature}\``);
    return item;
  }

  /**
   * Clear cached completions (called on kernel restart)
   */
  clearCache(): void {
    this._completionsCache.clear();
  }
}
