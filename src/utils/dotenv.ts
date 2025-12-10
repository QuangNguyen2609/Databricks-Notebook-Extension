/**
 * Simple .env file parser
 *
 * Parses .env files in the standard format:
 * - KEY=value
 * - KEY="quoted value"
 * - KEY='single quoted value'
 * - # comments
 * - Empty lines are ignored
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Parse a single line from a .env file
 *
 * @param line - Line to parse
 * @returns [key, value] tuple or null if line is not a valid variable assignment
 */
function parseLine(line: string): [string, string] | null {
  // Trim the line
  const trimmed = line.trim();

  // Skip empty lines and comments
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  // Find the first = sign
  const equalIndex = trimmed.indexOf('=');
  if (equalIndex === -1) {
    return null;
  }

  // Extract key and value
  const key = trimmed.substring(0, equalIndex).trim();
  let value = trimmed.substring(equalIndex + 1);

  // Skip if key is empty
  if (!key) {
    return null;
  }

  // Handle quoted values
  value = value.trim();
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    // Remove quotes
    value = value.substring(1, value.length - 1);
    // Handle escape sequences in double-quoted strings
    if (value.startsWith('"')) {
      value = value
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\\\/g, '\\');
    }
  } else {
    // For unquoted values, remove inline comments
    const commentIndex = value.indexOf(' #');
    if (commentIndex !== -1) {
      value = value.substring(0, commentIndex).trim();
    }
  }

  return [key, value];
}

/**
 * Parse a .env file and return the variables as an object
 *
 * @param filePath - Path to the .env file
 * @returns Object with environment variables, or empty object if file doesn't exist
 */
export function parseEnvFile(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};

  try {
    if (!fs.existsSync(filePath)) {
      return result;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
      const parsed = parseLine(line);
      if (parsed) {
        const [key, value] = parsed;
        result[key] = value;
      }
    }
  } catch (error) {
    console.warn(`[dotenv] Failed to parse ${filePath}:`, error);
  }

  return result;
}

/**
 * Find .env file paths to load for a notebook
 *
 * Searches in order (returns in priority order - highest first):
 * 1. Custom path (if provided)
 * 2. .env in the notebook's directory
 * 3. .env in the workspace root
 *
 * @param notebookPath - Path to the notebook file
 * @param workspaceRoot - Path to the workspace root
 * @param customPath - Optional custom path to .env file
 * @returns Array of .env file paths that exist, in order of priority (first = highest priority)
 */
export function findEnvFiles(
  notebookPath?: string,
  workspaceRoot?: string,
  customPath?: string
): string[] {
  const envFiles: string[] = [];

  // Check user-configured path first (highest priority)
  if (customPath) {
    // Resolve relative paths against workspace root
    const resolvedPath = path.isAbsolute(customPath)
      ? customPath
      : workspaceRoot
        ? path.join(workspaceRoot, customPath)
        : customPath;

    console.log(`[dotenv] Checking custom path: ${resolvedPath}, exists: ${fs.existsSync(resolvedPath)}`);
    if (fs.existsSync(resolvedPath)) {
      envFiles.push(resolvedPath);
    }
  }

  // Check notebook directory
  if (notebookPath) {
    const notebookDir = path.dirname(notebookPath);
    const notebookEnv = path.join(notebookDir, '.env');
    console.log(`[dotenv] Checking notebook dir: ${notebookEnv}, exists: ${fs.existsSync(notebookEnv)}`);
    if (fs.existsSync(notebookEnv) && !envFiles.includes(notebookEnv)) {
      envFiles.push(notebookEnv);
    }
  }

  // Check workspace root
  if (workspaceRoot) {
    const workspaceEnv = path.join(workspaceRoot, '.env');
    console.log(`[dotenv] Checking workspace root: ${workspaceEnv}, exists: ${fs.existsSync(workspaceEnv)}`);
    if (fs.existsSync(workspaceEnv) && !envFiles.includes(workspaceEnv)) {
      envFiles.push(workspaceEnv);
    }
  }

  console.log(`[dotenv] Found ${envFiles.length} .env files: ${envFiles.join(', ')}`);
  return envFiles;
}

/**
 * Load environment variables from .env files
 *
 * Loads variables from multiple .env files, with later files taking precedence.
 * Files are loaded in reverse order (workspace root first, then notebook dir, then custom).
 *
 * @param notebookPath - Path to the notebook file
 * @param workspaceRoot - Path to the workspace root
 * @param customPath - Optional custom path to .env file
 * @returns Merged environment variables from all .env files
 */
export function loadEnvFilesFromPaths(
  notebookPath?: string,
  workspaceRoot?: string,
  customPath?: string
): Record<string, string> {
  const envFiles = findEnvFiles(notebookPath, workspaceRoot, customPath);

  // No .env files found
  if (envFiles.length === 0) {
    return {};
  }

  // Load files in reverse order so that higher priority files override lower priority
  // envFiles order: [custom, notebook, workspace]
  // Load order: workspace, notebook, custom (so custom wins)
  const reversedFiles = [...envFiles].reverse();

  const merged: Record<string, string> = {};
  for (const filePath of reversedFiles) {
    const envVars = parseEnvFile(filePath);
    Object.assign(merged, envVars);
    console.debug(`[dotenv] Loaded ${Object.keys(envVars).length} variables from ${filePath}`);
  }

  return merged;
}
