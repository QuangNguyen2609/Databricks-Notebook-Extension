/**
 * Persistent Python Executor
 *
 * Manages a long-running Python subprocess for code execution.
 * Maintains variable state between cell executions through a persistent namespace.
 */

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as readline from 'readline';

/**
 * Result from executing Python code
 */
export interface ExecutionResult {
  /** Whether execution was successful */
  success: boolean;
  /** Standard output from execution */
  stdout: string;
  /** Standard error from execution */
  stderr: string;
  /** Error message if execution failed */
  error?: string;
  /** Type of error (e.g., "SyntaxError", "RuntimeError") */
  errorType?: string;
  /** Line number where error occurred */
  lineNumber?: number;
  /** Display outputs from display() function (HTML strings) */
  displayData?: string[];
}

/**
 * Request to send to the Python kernel
 */
interface KernelRequest {
  id: string;
  command: 'execute' | 'reset' | 'variables' | 'ping';
  code?: string;
}

/**
 * Virtual environment info from Python kernel
 */
interface VenvInfo {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  is_venv: boolean;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  venv_path: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  venv_name: string | null;
}

/**
 * Response from the Python kernel
 */
interface KernelResponse {
  id?: string;
  type: 'ready' | 'result' | 'error';
  success: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
  errorType?: string;
  lineNumber?: number;
  message?: string;
  variables?: Record<string, { type: string; repr: string }>;
  displayData?: string[];  // HTML outputs from display()
  // Python protocol uses snake_case
  // eslint-disable-next-line @typescript-eslint/naming-convention
  spark_status?: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  venv_info?: VenvInfo;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  databricks_connect_version?: string | null;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  databricks_connect_compatible?: boolean;
}

/** Last spark status from kernel initialization */
let lastSparkStatus: string | undefined;

/** Last venv info from kernel initialization */
let lastVenvInfo: VenvInfo | undefined;

/** Last databricks-connect version from kernel initialization */
let lastDbConnectVersion: string | undefined;

/**
 * Manages a persistent Python process for code execution
 */
export class PersistentExecutor implements vscode.Disposable {
  private _process: cp.ChildProcess | null = null;
  private _pythonPath: string;
  private _kernelScriptPath: string;
  private _workingDirectory: string;
  private _profileName: string | undefined;
  private _isReady = false;
  private _debugMode = false;
  private _pendingRequests = new Map<string, {
    resolve: (result: KernelResponse) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private _requestCounter = 0;
  private _readlineInterface: readline.Interface | null = null;

  /** Event emitter for process lifecycle events */
  private _onDidChangeState = new vscode.EventEmitter<'starting' | 'ready' | 'stopped' | 'error'>();
  readonly onDidChangeState = this._onDidChangeState.event;

  /**
   * Create a new PersistentExecutor
   *
   * @param pythonPath - Path to the Python executable
   * @param extensionPath - Path to the extension directory (for kernel script)
   * @param workingDirectory - Working directory for code execution
   * @param profileName - Databricks profile name to use for authentication
   */
  constructor(pythonPath: string, extensionPath: string, workingDirectory?: string, profileName?: string) {
    this._pythonPath = pythonPath;
    this._kernelScriptPath = path.join(extensionPath, 'dist', 'python', 'kernel_runner.py');
    this._workingDirectory = workingDirectory || process.cwd();
    this._profileName = profileName;
  }

  /**
   * Start the Python process
   */
  async start(): Promise<boolean> {
    if (this._process) {
      return true; // Already running
    }

    this._onDidChangeState.fire('starting');

    // Check if debug mode is enabled via environment variable (developer-only)
    // Set DATABRICKS_KERNEL_DEBUG=true to enable verbose logging
    this._debugMode = process.env.DATABRICKS_KERNEL_DEBUG === 'true';

    if (this._debugMode) {
      console.debug(`[Executor] Starting Python process:`);
      console.debug(`[Executor]   Python: ${this._pythonPath}`);
      console.debug(`[Executor]   Script: ${this._kernelScriptPath}`);
      console.debug(`[Executor]   CWD: ${this._workingDirectory}`);
    }

    return new Promise((resolve) => {
      try {
        // Build environment with optional Databricks profile
        const env: NodeJS.ProcessEnv = { ...process.env };
        if (this._profileName) {
          env.DATABRICKS_CONFIG_PROFILE = this._profileName;
        }
        // Pass debug mode to Python kernel
        if (this._debugMode) {
          env.DATABRICKS_KERNEL_DEBUG = 'true';
        }

        this._process = cp.spawn(this._pythonPath, [this._kernelScriptPath], {
          cwd: this._workingDirectory,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        // Track if we've already resolved to prevent multiple resolutions
        let resolved = false;
        const resolveOnce = (value: boolean) => {
          if (!resolved) {
            resolved = true;
            resolve(value);
          }
        };

        // Set up readline for stdout IMMEDIATELY and synchronously
        // This must happen before any async operations to avoid missing the ready signal
        if (this._process.stdout) {
          // Pause the stream to prevent data loss before readline is ready
          this._process.stdout.pause();

          this._readlineInterface = readline.createInterface({
            input: this._process.stdout,
            crlfDelay: Infinity,
          });

          this._readlineInterface.on('line', (line) => {
            this.handleOutput(line);
          });

          // Resume the stream now that readline is listening
          this._process.stdout.resume();
        }

        // Handle stderr - only log in debug mode or for non-debug messages
        this._process.stderr?.on('data', (data) => {
          const output = data.toString();
          // Filter out kernel debug messages unless debug mode is enabled
          if (this._debugMode || !output.includes('[KERNEL DEBUG]')) {
            console.error('[Python Kernel stderr]:', output);
          }
        });

        // Handle process errors
        this._process.on('error', (error) => {
          console.error('[Python Kernel error]:', error);
          this._onDidChangeState.fire('error');
          this.cleanup();
          resolveOnce(false);
        });

        // Handle process exit
        this._process.on('exit', (code, signal) => {
          if (this._debugMode) {
            console.debug(`[Python Kernel] Process exited with code ${code}, signal ${signal}`);
          }
          this._onDidChangeState.fire('stopped');
          this.cleanup();
          // If process exits before ready, resolve with false
          if (!this._isReady) {
            resolveOnce(false);
          }
        });

        // Wait for ready signal with configurable timeout (default 30 seconds)
        // Databricks Connect initialization can be slow on first run
        const STARTUP_TIMEOUT_DEFAULT = 30000;
        const startupTimeout = vscode.workspace
          .getConfiguration('databricks-notebook')
          .get<number>('kernelStartupTimeout', STARTUP_TIMEOUT_DEFAULT);
        const readyTimeout = setTimeout(() => {
          if (!this._isReady) {
            console.error(`[Python Kernel] Timeout waiting for ready signal (${startupTimeout}ms)`);
            clearInterval(checkReady);
            this.stop();
            resolveOnce(false);
          }
        }, startupTimeout);

        // Check for ready signal more frequently
        const checkReady = setInterval(() => {
          if (this._isReady) {
            clearTimeout(readyTimeout);
            clearInterval(checkReady);
            resolveOnce(true);
          }
        }, 50);

      } catch (error) {
        console.error('[Python Kernel] Failed to start:', error);
        this._onDidChangeState.fire('error');
        resolve(false);
      }
    });
  }

  /**
   * Handle output from the Python process
   */
  private handleOutput(line: string): void {
    try {
      const response: KernelResponse = JSON.parse(line);

      if (response.type === 'ready') {
        this._isReady = true;
        this._onDidChangeState.fire('ready');
        // Log Python info (Python protocol uses snake_case) - only in debug mode
        // eslint-disable-next-line @typescript-eslint/naming-convention
        if (this._debugMode && (response as { python_info?: string }).python_info) {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          console.debug(`[Executor] ${(response as { python_info?: string }).python_info}`);
        }

        // Store and log venv info
        if (response.venv_info) {
          lastVenvInfo = response.venv_info;
          if (response.venv_info.is_venv) {
            const venvName = response.venv_info.venv_name || 'venv';
            if (this._debugMode) {
              console.debug(`[Executor] Using virtual environment: ${venvName} (${response.venv_info.venv_path})`);
            }
            // Show informational message about venv
            vscode.window.showInformationMessage(`Kernel: Using virtual environment "${venvName}"`);
          }
        }

        // Store and log databricks-connect version
        if (response.databricks_connect_version) {
          lastDbConnectVersion = response.databricks_connect_version;
          if (this._debugMode) {
            console.debug(`[Executor] databricks-connect version: ${response.databricks_connect_version}`);
          }
        }

        // Store and log spark status
        if (response.spark_status) {
          lastSparkStatus = response.spark_status;
          if (this._debugMode) {
            console.debug(`[Executor] ${response.spark_status}`);
          }
          // Show notification for spark status
          if (response.spark_status.startsWith('OK:')) {
            vscode.window.showInformationMessage(`Kernel: ${response.spark_status}`);
          } else if (response.spark_status.startsWith('WARN:')) {
            vscode.window.showWarningMessage(`Kernel: ${response.spark_status}`);
          }
        }
        return;
      }

      if (response.id && this._pendingRequests.has(response.id)) {
        const pending = this._pendingRequests.get(response.id)!;
        clearTimeout(pending.timeout);
        this._pendingRequests.delete(response.id);
        pending.resolve(response);
      }
    } catch (error) {
      console.error('[Python Kernel] Failed to parse output:', line, error);
    }
  }

  /**
   * Get the last spark status from kernel initialization
   */
  static getLastSparkStatus(): string | undefined {
    return lastSparkStatus;
  }

  /**
   * Get the last venv info from kernel initialization
   */
  static getLastVenvInfo(): VenvInfo | undefined {
    return lastVenvInfo;
  }

  /**
   * Get the last databricks-connect version from kernel initialization
   */
  static getLastDbConnectVersion(): string | undefined {
    return lastDbConnectVersion;
  }

  /**
   * Execute Python code
   *
   * @param code - Python code to execute
   * @param timeout - Execution timeout in milliseconds (default: 60000)
   * @returns ExecutionResult
   */
  async execute(code: string, timeout: number = 60000): Promise<ExecutionResult> {
    if (!this._process || !this._isReady) {
      const started = await this.start();
      if (!started) {
        return {
          success: false,
          stdout: '',
          stderr: '',
          error: 'Failed to start Python kernel',
        };
      }
    }

    const requestId = `exec-${++this._requestCounter}`;
    const request: KernelRequest = {
      id: requestId,
      command: 'execute',
      code,
    };

    try {
      const response = await this.sendRequest(request, timeout);
      return {
        success: response.success,
        stdout: response.stdout || '',
        stderr: response.stderr || '',
        error: response.error,
        errorType: response.errorType,
        lineNumber: response.lineNumber,
        displayData: response.displayData,
      };
    } catch (error) {
      return {
        success: false,
        stdout: '',
        stderr: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Reset the Python namespace
   */
  async reset(): Promise<boolean> {
    if (!this._process || !this._isReady) {
      return true; // Nothing to reset
    }

    const requestId = `reset-${++this._requestCounter}`;
    const request: KernelRequest = {
      id: requestId,
      command: 'reset',
    };

    try {
      const response = await this.sendRequest(request, 5000);
      return response.success;
    } catch {
      return false;
    }
  }

  /**
   * Get variables in the namespace
   */
  async getVariables(): Promise<Record<string, { type: string; repr: string }>> {
    if (!this._process || !this._isReady) {
      return {};
    }

    const requestId = `vars-${++this._requestCounter}`;
    const request: KernelRequest = {
      id: requestId,
      command: 'variables',
    };

    try {
      const response = await this.sendRequest(request, 5000);
      return response.variables || {};
    } catch {
      return {};
    }
  }

  /**
   * Check if the kernel is alive
   */
  async ping(): Promise<boolean> {
    if (!this._process || !this._isReady) {
      return false;
    }

    const requestId = `ping-${++this._requestCounter}`;
    const request: KernelRequest = {
      id: requestId,
      command: 'ping',
    };

    try {
      const response = await this.sendRequest(request, 5000);
      return response.success;
    } catch {
      return false;
    }
  }

  /**
   * Send a request to the kernel and wait for response
   */
  private sendRequest(request: KernelRequest, timeout: number): Promise<KernelResponse> {
    return new Promise((resolve, reject) => {
      if (!this._process?.stdin) {
        reject(new Error('Process not running'));
        return;
      }

      const timeoutHandle = setTimeout(() => {
        this._pendingRequests.delete(request.id);
        reject(new Error('Execution timeout'));
      }, timeout);

      this._pendingRequests.set(request.id, {
        resolve,
        reject,
        timeout: timeoutHandle,
      });

      const requestLine = JSON.stringify(request) + '\n';
      this._process.stdin.write(requestLine);
    });
  }

  /**
   * Interrupt current execution
   */
  interrupt(): void {
    if (this._process) {
      this._process.kill('SIGINT');
    }
  }

  /**
   * Stop the Python process
   */
  stop(): void {
    this.cleanup();
    if (this._process) {
      this._process.kill('SIGTERM');
      this._process = null;
    }
  }

  /**
   * Restart the Python process
   */
  async restart(): Promise<boolean> {
    this.stop();
    return this.start();
  }

  /**
   * Set the Databricks profile and restart the kernel if running
   *
   * @param profileName - Databricks profile name to use
   */
  async setProfile(profileName: string | undefined): Promise<void> {
    if (this._profileName !== profileName) {
      this._profileName = profileName;
      if (this.isRunning()) {
        await this.restart();
      }
    }
  }

  /**
   * Check if the process is running
   */
  isRunning(): boolean {
    return this._process !== null && this._isReady;
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    this._isReady = false;

    // Reject all pending requests
    for (const [id, pending] of this._pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Process terminated'));
      this._pendingRequests.delete(id);
    }

    // Close readline interface
    if (this._readlineInterface) {
      this._readlineInterface.close();
      this._readlineInterface = null;
    }
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.stop();
    this._onDidChangeState.dispose();
  }
}
