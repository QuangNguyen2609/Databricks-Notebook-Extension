/**
 * Kernel Utilities
 *
 * Helper functions for Python kernel process management.
 * Extracted from PersistentExecutor to reduce function complexity.
 */

import * as vscode from 'vscode';
import * as readline from 'readline';
import { showInfoMessage, showWarningMessage } from '../utils/notifications';
import { loadEnvFilesFromPaths } from '../utils/dotenv';

/**
 * Virtual environment info from Python kernel
 */
export interface VenvInfo {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  is_venv: boolean;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  venv_path: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  venv_name: string | null;
}

/**
 * Ready signal response from Python kernel
 */
export interface ReadyResponse {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  python_info?: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  spark_status?: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  venv_info?: VenvInfo;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  databricks_connect_version?: string | null;
}

/**
 * Kernel status info extracted from ready response
 */
export interface KernelStatusInfo {
  sparkStatus?: string;
  venvInfo?: VenvInfo;
  dbConnectVersion?: string;
}

// ===== ENVIRONMENT HELPERS =====

/**
 * Build environment variables for Python kernel process
 *
 * Loading order (later overrides earlier):
 * 1. VS Code process environment (process.env)
 * 2. .env files (workspace root, then notebook dir, then custom path)
 * 3. Explicit Databricks variables (profile, debug, paths)
 *
 * @param profileName - Optional Databricks profile name
 * @param debugMode - Whether debug mode is enabled
 * @param notebookPath - Optional path to the notebook file (for local imports)
 * @param workspaceRoot - Optional workspace root directory (for package discovery)
 * @returns Environment variables object
 */
export function buildKernelEnvironment(
  profileName: string | undefined,
  debugMode: boolean,
  notebookPath?: string,
  workspaceRoot?: string
): NodeJS.ProcessEnv {
  // Start with VS Code's environment
  const env: NodeJS.ProcessEnv = { ...process.env };

  // Get custom .env path from VS Code settings
  const customDotenvPath = vscode.workspace
    .getConfiguration('databricks-notebook')
    .get<string>('dotenvPath') || undefined;

  // Load .env files (workspace root, then notebook dir, then custom path)
  // Later files override earlier ones
  console.log(`[dotenv] Loading .env files - notebookPath: ${notebookPath}, workspaceRoot: ${workspaceRoot}, customPath: ${customDotenvPath}`);
  const dotenvVars = loadEnvFilesFromPaths(notebookPath, workspaceRoot, customDotenvPath);
  const varCount = Object.keys(dotenvVars).length;
  if (varCount > 0) {
    console.log(`[dotenv] Loaded ${varCount} environment variables from .env files`);
  } else {
    console.log(`[dotenv] No .env files found or no variables loaded`);
  }
  for (const [key, value] of Object.entries(dotenvVars)) {
    env[key] = value;
  }

  // Databricks-specific variables (highest priority - override .env)
  if (profileName) {
    env.DATABRICKS_CONFIG_PROFILE = profileName;
  }

  if (debugMode) {
    env.DATABRICKS_KERNEL_DEBUG = 'true';
  }

  // Add paths for local module imports
  if (notebookPath) {
    env.DATABRICKS_NOTEBOOK_PATH = notebookPath;
  }

  if (workspaceRoot) {
    env.DATABRICKS_WORKSPACE_ROOT = workspaceRoot;
  }

  return env;
}

/**
 * Check if debug mode is enabled via environment variable
 * @returns true if DATABRICKS_KERNEL_DEBUG=true
 */
export function isDebugModeEnabled(): boolean {
  return process.env.DATABRICKS_KERNEL_DEBUG === 'true';
}

// ===== PROCESS HELPERS =====

/**
 * Setup readline interface for process stdout
 * @param stdout - Process stdout stream
 * @param onLine - Callback for each line received
 * @returns readline.Interface
 */
export function setupReadlineInterface(
  stdout: NodeJS.ReadableStream,
  onLine: (line: string) => void
): readline.Interface {
  // Pause the stream to prevent data loss before readline is ready
  // Check if pause/resume are available (they may not be in mocked streams)
  if (typeof stdout.pause === 'function') {
    stdout.pause();
  }

  const rl = readline.createInterface({
    input: stdout,
    crlfDelay: Infinity,
  });

  rl.on('line', onLine);

  // Resume the stream now that readline is listening
  if (typeof stdout.resume === 'function') {
    stdout.resume();
  }

  return rl;
}

/**
 * Filter stderr output - only log non-debug messages unless debug mode is enabled
 * @param output - Stderr output string
 * @param debugMode - Whether debug mode is enabled
 * @returns true if output should be logged
 */
export function shouldLogStderr(output: string, debugMode: boolean): boolean {
  return debugMode || !output.includes('[KERNEL DEBUG]');
}

/**
 * Create a single-use resolver to prevent multiple promise resolutions
 * @param resolve - Original resolve function
 * @returns Wrapped resolve function that only resolves once
 */
export function createSingleUseResolver<T>(
  resolve: (value: T) => void
): (value: T) => void {
  let resolved = false;
  return (value: T) => {
    if (!resolved) {
      resolved = true;
      resolve(value);
    }
  };
}

// ===== READY SIGNAL HELPERS =====

/**
 * Extract kernel status info from ready response
 * @param response - Ready response from kernel
 * @returns Extracted status info
 */
export function extractKernelStatusInfo(response: ReadyResponse): KernelStatusInfo {
  const info: KernelStatusInfo = {};

  if (response.venv_info) {
    info.venvInfo = response.venv_info;
  }

  if (response.databricks_connect_version) {
    info.dbConnectVersion = response.databricks_connect_version;
  }

  if (response.spark_status) {
    info.sparkStatus = response.spark_status;
  }

  return info;
}

/**
 * Show notifications for kernel status (venv, spark)
 * @param statusInfo - Kernel status info
 */
export function showKernelStatusNotifications(statusInfo: KernelStatusInfo): void {
  // Notify about virtual environment
  if (statusInfo.venvInfo?.is_venv) {
    const venvName = statusInfo.venvInfo.venv_name || 'venv';
    showInfoMessage(`Kernel: Using virtual environment "${venvName}"`);
  }

  // Notify about spark status
  if (statusInfo.sparkStatus) {
    if (statusInfo.sparkStatus.startsWith('OK:')) {
      showInfoMessage(`Kernel: ${statusInfo.sparkStatus}`);
    } else if (statusInfo.sparkStatus.startsWith('WARN:')) {
      showWarningMessage(`Kernel: ${statusInfo.sparkStatus}`);
    }
  }
}

/**
 * Log kernel status info in debug mode
 * @param statusInfo - Kernel status info
 * @param pythonInfo - Optional python info string
 */
export function logKernelStatusDebug(
  statusInfo: KernelStatusInfo,
  pythonInfo?: string
): void {
  if (pythonInfo) {
    console.debug(`[Executor] ${pythonInfo}`);
  }

  if (statusInfo.venvInfo?.is_venv) {
    const venvName = statusInfo.venvInfo.venv_name || 'venv';
    console.debug(`[Executor] Using virtual environment: ${venvName} (${statusInfo.venvInfo.venv_path})`);
  }

  if (statusInfo.dbConnectVersion) {
    console.debug(`[Executor] databricks-connect version: ${statusInfo.dbConnectVersion}`);
  }

  if (statusInfo.sparkStatus) {
    console.debug(`[Executor] ${statusInfo.sparkStatus}`);
  }
}

// ===== TIMEOUT HELPERS =====

/**
 * Create ready signal waiter with timeout
 * @param checkReady - Function that returns true when ready
 * @param onTimeout - Callback when timeout occurs
 * @param timeoutMs - Timeout in milliseconds
 * @param checkIntervalMs - Check interval in milliseconds
 * @returns Cleanup function to clear timers
 */
export function createReadyWaiter(
  checkReady: () => boolean,
  onReady: () => void,
  onTimeout: () => void,
  timeoutMs: number,
  checkIntervalMs: number
): () => void {
  const checkInterval = setInterval(() => {
    if (checkReady()) {
      clearTimeout(timeout);
      clearInterval(checkInterval);
      onReady();
    }
  }, checkIntervalMs);

  const timeout = setTimeout(() => {
    clearInterval(checkInterval);
    onTimeout();
  }, timeoutMs);

  // Return cleanup function
  return () => {
    clearTimeout(timeout);
    clearInterval(checkInterval);
  };
}

/**
 * Get kernel startup timeout from configuration
 * @returns Timeout in milliseconds
 */
export function getKernelStartupTimeout(defaultTimeout: number): number {
  return vscode.workspace
    .getConfiguration('databricks-notebook')
    .get<number>('kernelStartupTimeout', defaultTimeout);
}
