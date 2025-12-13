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

  // Use display() which generates rich HTML tables with sorting, column resizing, etc.
  // display() uses df.collect() (not show()) so it doesn't have JVM stdout issues.
  // It already limits to 100 rows and shows "Showing X of Y rows" in the footer.
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

/**
 * Wrap pip command for execution in the current Python interpreter
 *
 * @param pipCode - The pip command to wrap (e.g., "install pandas" or "%pip install pandas")
 * @returns Python code that executes pip in the current interpreter's environment
 */
export function wrapPipCode(pipCode: string): string {
  // Strip %pip prefix if present
  let cleanCode = stripMagicPrefix(pipCode, '%pip');

  // Parse the pip arguments
  // Split by whitespace but preserve quoted strings
  const args = cleanCode.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];

  // Escape each argument for Python string representation
  const escapedArgs = args.map(arg => {
    // Remove surrounding quotes if present, then escape for Python
    const cleanArg = arg.replace(/^["']|["']$/g, '');
    // Escape backslashes and quotes
    return cleanArg.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  });

  // Build the command list as a Python list literal
  const argsListStr = escapedArgs.map(arg => `"${arg}"`).join(', ');

  return `import subprocess as _sp
import sys as _sys
_cmd = [_sys.executable, "-m", "pip"] + [${argsListStr}]
print(f"[pip] Running: {' '.join(_cmd)}")
_result = _sp.run(_cmd, capture_output=True, text=True)
if _result.stdout:
    print(_result.stdout)
if _result.stderr:
    print(_result.stderr, file=_sys.stderr)
if _result.returncode != 0:
    raise RuntimeError(f"pip command failed with exit code {_result.returncode}")
print(f"[pip] Command completed successfully")`;
}
