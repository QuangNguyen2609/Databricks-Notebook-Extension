/**
 * Code Transformation Utilities
 *
 * Functions for transforming code before execution.
 * These are extracted to be testable independently of VS Code.
 */

/**
 * Escape a string for use in a Python triple-quoted string.
 * Handles backslashes and triple quotes properly.
 *
 * @param str - The string to escape
 * @returns The escaped string safe for Python triple-quoted strings
 */
export function escapeForPythonTripleQuote(str: string): string {
  return str
    .replace(/\\/g, '\\\\')      // Escape backslashes first
    .replace(/"""/g, '\\"\\"\\"'); // Escape triple quotes
}

/**
 * Strip a magic command prefix from code
 *
 * @param code - The code to strip
 * @param prefix - The magic prefix to remove (e.g., '%sql', '%python')
 * @returns The code with the prefix removed
 */
export function stripMagicPrefix(code: string, prefix: string): string {
  let result = code.trim();
  if (result.startsWith(prefix)) {
    result = result.substring(prefix.length).trim();
  }
  return result;
}

/**
 * Wrap SQL code for execution via spark.sql()
 *
 * @param sql - The SQL code to wrap
 * @returns Python code that executes the SQL
 */
export function wrapSqlCode(sql: string): string {
  // Strip %sql prefix if present
  const cleanSql = stripMagicPrefix(sql, '%sql');

  // Escape for Python triple-quoted string
  const escapedSql = escapeForPythonTripleQuote(cleanSql);

  return `
if 'spark' not in dir():
    raise NameError("""'spark' is not defined. Initialize it first by running:

# For Databricks Connect:
from databricks.connect import DatabricksSession
spark = DatabricksSession.builder.getOrCreate()

# Or configure your cluster connection:
spark = DatabricksSession.builder.remote("sc://YOUR_WORKSPACE:443/;token=YOUR_TOKEN;x-databricks-cluster-id=YOUR_CLUSTER_ID").getOrCreate()
""")
_df = spark.sql("""${escapedSql}""")
display(_df)`.trim();
}

/**
 * Wrap shell code for execution via subprocess
 *
 * @param shellCode - The shell code to wrap
 * @returns Python code that executes the shell command
 */
export function wrapShellCode(shellCode: string): string {
  // Strip %sh prefix if present
  const cleanCode = stripMagicPrefix(shellCode, '%sh');

  // Escape for Python triple-quoted string
  const escapedCode = escapeForPythonTripleQuote(cleanCode);

  return `import subprocess as _sp
_result = _sp.run("""${escapedCode}""", shell=True, capture_output=True, text=True)
if _result.stdout:
    print(_result.stdout)
if _result.stderr:
    print(_result.stderr)`;
}
