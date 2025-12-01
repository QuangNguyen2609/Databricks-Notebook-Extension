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
}

/** Last spark status from kernel initialization */
let lastSparkStatus: string | undefined;

/**
 * Manages a persistent Python process for code execution
 */
export class PersistentExecutor implements vscode.Disposable {
  private process: cp.ChildProcess | null = null;
  private pythonPath: string;
  private kernelScriptPath: string;
  private workingDirectory: string;
  private profileName: string | undefined;
  private isReady = false;
  private pendingRequests = new Map<string, {
    resolve: (result: KernelResponse) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private requestCounter = 0;
  private readlineInterface: readline.Interface | null = null;

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
    this.pythonPath = pythonPath;
    this.kernelScriptPath = path.join(extensionPath, 'dist', 'python', 'kernel_runner.py');
    this.workingDirectory = workingDirectory || process.cwd();
    this.profileName = profileName;
  }

  /**
   * Start the Python process
   */
  async start(): Promise<boolean> {
    if (this.process) {
      return true; // Already running
    }

    this._onDidChangeState.fire('starting');

    console.debug(`[Executor] Starting Python process:`);
    console.debug(`[Executor]   Python: ${this.pythonPath}`);
    console.debug(`[Executor]   Script: ${this.kernelScriptPath}`);
    console.debug(`[Executor]   CWD: ${this.workingDirectory}`);

    return new Promise((resolve) => {
      try {
        // Build environment with optional Databricks profile
        const env: NodeJS.ProcessEnv = { ...process.env };
        if (this.profileName) {
          env.DATABRICKS_CONFIG_PROFILE = this.profileName;
        }

        this.process = cp.spawn(this.pythonPath, [this.kernelScriptPath], {
          cwd: this.workingDirectory,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        // Set up readline for stdout
        if (this.process.stdout) {
          this.readlineInterface = readline.createInterface({
            input: this.process.stdout,
            crlfDelay: Infinity,
          });

          this.readlineInterface.on('line', (line) => {
            this.handleOutput(line);
          });
        }

        // Handle stderr
        this.process.stderr?.on('data', (data) => {
          console.error('[Python Kernel stderr]:', data.toString());
        });

        // Handle process errors
        this.process.on('error', (error) => {
          console.error('[Python Kernel error]:', error);
          this._onDidChangeState.fire('error');
          this.cleanup();
          resolve(false);
        });

        // Handle process exit
        this.process.on('exit', (code, signal) => {
          console.debug(`[Python Kernel] Process exited with code ${code}, signal ${signal}`);
          this._onDidChangeState.fire('stopped');
          this.cleanup();
        });

        // Wait for ready signal with timeout
        const readyTimeout = setTimeout(() => {
          if (!this.isReady) {
            console.error('[Python Kernel] Timeout waiting for ready signal');
            this.stop();
            resolve(false);
          }
        }, 10000);

        // Check for ready signal
        const checkReady = setInterval(() => {
          if (this.isReady) {
            clearTimeout(readyTimeout);
            clearInterval(checkReady);
            resolve(true);
          }
        }, 100);

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
        this.isReady = true;
        this._onDidChangeState.fire('ready');
        // Log Python info (Python protocol uses snake_case)
        // eslint-disable-next-line @typescript-eslint/naming-convention
        if ((response as { python_info?: string }).python_info) {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          console.debug(`[Executor] ${(response as { python_info?: string }).python_info}`);
        }
        // Store and log spark status
        if (response.spark_status) {
          lastSparkStatus = response.spark_status;
          console.debug(`[Executor] ${response.spark_status}`);
          // Show notification for spark status
          if (response.spark_status.startsWith('OK:')) {
            vscode.window.showInformationMessage(`Kernel: ${response.spark_status}`);
          } else if (response.spark_status.startsWith('WARN:')) {
            vscode.window.showWarningMessage(`Kernel: ${response.spark_status}`);
          }
        }
        return;
      }

      if (response.id && this.pendingRequests.has(response.id)) {
        const pending = this.pendingRequests.get(response.id)!;
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(response.id);
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
   * Execute Python code
   *
   * @param code - Python code to execute
   * @param timeout - Execution timeout in milliseconds (default: 60000)
   * @returns ExecutionResult
   */
  async execute(code: string, timeout: number = 60000): Promise<ExecutionResult> {
    if (!this.process || !this.isReady) {
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

    const requestId = `exec-${++this.requestCounter}`;
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
    if (!this.process || !this.isReady) {
      return true; // Nothing to reset
    }

    const requestId = `reset-${++this.requestCounter}`;
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
    if (!this.process || !this.isReady) {
      return {};
    }

    const requestId = `vars-${++this.requestCounter}`;
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
    if (!this.process || !this.isReady) {
      return false;
    }

    const requestId = `ping-${++this.requestCounter}`;
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
      if (!this.process?.stdin) {
        reject(new Error('Process not running'));
        return;
      }

      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error('Execution timeout'));
      }, timeout);

      this.pendingRequests.set(request.id, {
        resolve,
        reject,
        timeout: timeoutHandle,
      });

      const requestLine = JSON.stringify(request) + '\n';
      this.process.stdin.write(requestLine);
    });
  }

  /**
   * Interrupt current execution
   */
  interrupt(): void {
    if (this.process) {
      this.process.kill('SIGINT');
    }
  }

  /**
   * Stop the Python process
   */
  stop(): void {
    this.cleanup();
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
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
    if (this.profileName !== profileName) {
      this.profileName = profileName;
      if (this.isRunning()) {
        await this.restart();
      }
    }
  }

  /**
   * Check if the process is running
   */
  isRunning(): boolean {
    return this.process !== null && this.isReady;
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    this.isReady = false;

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Process terminated'));
      this.pendingRequests.delete(id);
    }

    // Close readline interface
    if (this.readlineInterface) {
      this.readlineInterface.close();
      this.readlineInterface = null;
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
