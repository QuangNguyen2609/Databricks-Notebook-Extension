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
import { extractErrorMessage } from '../utils/errorHandler';
import {
  KERNEL_STARTUP_TIMEOUT_MS,
  EXECUTION_TIMEOUT_MS,
  SHORT_OPERATION_TIMEOUT_MS,
  READY_CHECK_INTERVAL_MS,
} from '../constants';
import {
  VenvInfo,
  ReadyResponse,
  buildKernelEnvironment,
  isDebugModeEnabled,
  setupReadlineInterface,
  shouldLogStderr,
  createSingleUseResolver,
  extractKernelStatusInfo,
  showKernelStatusNotifications,
  logKernelStatusDebug,
  createReadyWaiter,
  getKernelStartupTimeout,
} from './utils';

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

// VenvInfo is imported from ./utils

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

/**
 * Widget input request from Python kernel
 * Sent when dbutils.widgets.get() is called and needs user input
 */
interface WidgetInputRequest {
  type: 'input_request';
  id: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  widget_name: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  widget_type: 'text' | 'dropdown' | 'combobox' | 'multiselect';
  // eslint-disable-next-line @typescript-eslint/naming-convention
  default_value: string;
  choices?: string[];
  label: string;
}

/**
 * Widget input response sent to Python kernel
 */
interface WidgetInputResponse {
  type: 'input_response';
  id: string;
  value: string;
  cancelled: boolean;
}

/**
 * Manages a persistent Python process for code execution
 */
export class PersistentExecutor implements vscode.Disposable {
  private _process: cp.ChildProcess | null = null;
  private _pythonPath: string;
  private _kernelScriptPath: string;
  private _workingDirectory: string;
  private _profileName: string | undefined;
  private _notebookPath: string | undefined;
  private _isReady = false;
  private _debugMode = false;
  private _pendingRequests = new Map<string, {
    resolve: (result: KernelResponse) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private _requestCounter = 0;
  private _readlineInterface: readline.Interface | null = null;

  /** Promise that resolves when the current start operation completes */
  private _startPromise: Promise<boolean> | null = null;

  /** Spark status from kernel initialization (instance-specific) */
  private _sparkStatus: string | undefined;

  /** Virtual environment info from kernel initialization (instance-specific) */
  private _venvInfo: VenvInfo | undefined;

  /** Databricks-connect version from kernel initialization (instance-specific) */
  private _dbConnectVersion: string | undefined;

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
   * @param notebookPath - Path to the notebook file (for local module imports)
   */
  constructor(
    pythonPath: string,
    extensionPath: string,
    workingDirectory?: string,
    profileName?: string,
    notebookPath?: string
  ) {
    this._pythonPath = pythonPath;
    this._kernelScriptPath = path.join(extensionPath, 'dist', 'python', 'kernel_runner.py');
    this._workingDirectory = workingDirectory || process.cwd();
    this._profileName = profileName;
    this._notebookPath = notebookPath;
  }

  /**
   * Start the Python process.
   *
   * This method handles concurrent calls safely:
   * - If already running and ready, returns true immediately
   * - If a start is in progress, waits for it to complete
   * - Otherwise, starts a new process
   */
  async start(): Promise<boolean> {
    // If already running and ready, return immediately
    if (this._process && this._isReady) {
      return true;
    }

    // If a start is already in progress, wait for it
    // This prevents race conditions when restart() and execute() both call start()
    if (this._startPromise) {
      console.debug('[Python Kernel] Start already in progress, waiting...');
      return this._startPromise;
    }

    // Start the kernel and track the promise
    this._startPromise = this.doStart();

    try {
      return await this._startPromise;
    } finally {
      this._startPromise = null;
    }
  }

  /**
   * Internal method that actually starts the Python process
   */
  private doStart(): Promise<boolean> {
    this._onDidChangeState.fire('starting');
    this._debugMode = isDebugModeEnabled();

    if (this._debugMode) {
      this.logStartupInfo();
    }

    return new Promise((resolve) => {
      try {
        const env = buildKernelEnvironment(
          this._profileName,
          this._debugMode,
          this._notebookPath,
          this._workingDirectory
        );
        this._process = this.spawnProcess(env);

        const resolveOnce = createSingleUseResolver(resolve);

        this.setupStdoutHandler();
        this.setupStderrHandler();
        this.setupProcessEventHandlers(resolveOnce);
        this.setupReadyWaiter(resolveOnce);
      } catch (error) {
        console.error('[Python Kernel] Failed to start:', error);
        this._onDidChangeState.fire('error');
        resolve(false);
      }
    });
  }

  /**
   * Log startup information in debug mode
   */
  private logStartupInfo(): void {
    console.debug(`[Executor] Starting Python process:`);
    console.debug(`[Executor]   Python: ${this._pythonPath}`);
    console.debug(`[Executor]   Script: ${this._kernelScriptPath}`);
    console.debug(`[Executor]   CWD: ${this._workingDirectory}`);
  }

  /**
   * Spawn the Python process
   */
  private spawnProcess(env: NodeJS.ProcessEnv): cp.ChildProcess {
    return cp.spawn(this._pythonPath, [this._kernelScriptPath], {
      cwd: this._workingDirectory,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  /**
   * Setup stdout handler with readline interface
   */
  private setupStdoutHandler(): void {
    if (this._process?.stdout) {
      this._readlineInterface = setupReadlineInterface(
        this._process.stdout,
        (line) => this.handleOutput(line)
      );
    }
  }

  /**
   * Setup stderr handler with debug filtering
   */
  private setupStderrHandler(): void {
    this._process?.stderr?.on('data', (data) => {
      const output = data.toString();
      if (shouldLogStderr(output, this._debugMode)) {
        console.error('[Python Kernel stderr]:', output);
      }
    });
  }

  /**
   * Setup process error and exit event handlers
   */
  private setupProcessEventHandlers(resolveOnce: (value: boolean) => void): void {
    this._process?.on('error', (error) => {
      console.error('[Python Kernel error]:', error);
      this._onDidChangeState.fire('error');
      this.cleanup();
      resolveOnce(false);
    });

    this._process?.on('exit', (code, signal) => {
      if (this._debugMode) {
        console.debug(`[Python Kernel] Process exited with code ${code}, signal ${signal}`);
      }
      this._onDidChangeState.fire('stopped');
      this.cleanup();
      if (!this._isReady) {
        resolveOnce(false);
      }
    });
  }

  /**
   * Setup ready signal waiter with timeout
   */
  private setupReadyWaiter(resolveOnce: (value: boolean) => void): void {
    const startupTimeout = getKernelStartupTimeout(KERNEL_STARTUP_TIMEOUT_MS);

    createReadyWaiter(
      () => this._isReady,
      () => resolveOnce(true),
      () => {
        console.error(`[Python Kernel] Timeout waiting for ready signal (${startupTimeout}ms)`);
        this.stop();
        resolveOnce(false);
      },
      startupTimeout,
      READY_CHECK_INTERVAL_MS
    );
  }

  /**
   * Handle output from the Python process
   */
  private handleOutput(line: string): void {
    try {
      // Parse as generic object first to check type
      const message = JSON.parse(line) as { type?: string };

      if (message.type === 'ready') {
        this.handleReadySignal(message as KernelResponse);
        return;
      }

      // Handle widget input requests from Python
      if (message.type === 'input_request') {
        this.handleWidgetInputRequest(message as WidgetInputRequest);
        return;
      }

      this.handlePendingResponse(message as KernelResponse);
    } catch (error) {
      console.error('[Python Kernel] Failed to parse output:', line, error);
    }
  }

  /**
   * Handle ready signal from kernel
   */
  private handleReadySignal(response: KernelResponse): void {
    this._isReady = true;
    this._onDidChangeState.fire('ready');

    // Extract and store status info
    const statusInfo = extractKernelStatusInfo(response as ReadyResponse);
    this._venvInfo = statusInfo.venvInfo;
    this._dbConnectVersion = statusInfo.dbConnectVersion;
    this._sparkStatus = statusInfo.sparkStatus;

    // Log in debug mode
    if (this._debugMode) {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const pythonInfo = (response as { python_info?: string }).python_info;
      logKernelStatusDebug(statusInfo, pythonInfo);
    }

    // Show user notifications
    showKernelStatusNotifications(statusInfo);
  }

  /**
   * Handle pending request response
   */
  private handlePendingResponse(response: KernelResponse): void {
    if (response.id && this._pendingRequests.has(response.id)) {
      const pending = this._pendingRequests.get(response.id)!;
      clearTimeout(pending.timeout);
      this._pendingRequests.delete(response.id);
      pending.resolve(response);
    }
  }

  /**
   * Handle widget input request from Python kernel.
   * Shows VS Code input dialog and sends response back to Python.
   */
  private async handleWidgetInputRequest(request: WidgetInputRequest): Promise<void> {
    let value: string | undefined;

    try {
      switch (request.widget_type) {
        case 'text':
        case 'combobox':
          // For text and combobox, show input box
          // Combobox could show quick pick with custom input, but input box is simpler
          value = await vscode.window.showInputBox({
            prompt: request.label,
            value: request.default_value,
            placeHolder: `Enter value for widget "${request.widget_name}"`,
            title: `Widget: ${request.widget_name}`,
          });
          break;

        case 'dropdown':
          // For dropdown, show quick pick with choices
          if (request.choices && request.choices.length > 0) {
            value = await vscode.window.showQuickPick(request.choices, {
              placeHolder: request.label,
              title: `Widget: ${request.widget_name}`,
            });
          } else {
            // No choices, fall back to input box
            value = await vscode.window.showInputBox({
              prompt: request.label,
              value: request.default_value,
              placeHolder: `Enter value for widget "${request.widget_name}"`,
            });
          }
          break;

        case 'multiselect':
          // For multiselect, show quick pick with multiple selection
          if (request.choices && request.choices.length > 0) {
            const selected = await vscode.window.showQuickPick(request.choices, {
              placeHolder: request.label,
              title: `Widget: ${request.widget_name}`,
              canPickMany: true,
            });
            // Join selected values with comma (Databricks multiselect convention)
            value = selected ? selected.join(',') : undefined;
          } else {
            value = await vscode.window.showInputBox({
              prompt: request.label,
              value: request.default_value,
              placeHolder: `Enter comma-separated values for widget "${request.widget_name}"`,
            });
          }
          break;

        default:
          // Unknown widget type, fall back to input box
          value = await vscode.window.showInputBox({
            prompt: request.label,
            value: request.default_value,
          });
      }
    } catch (error) {
      console.error('[Python Kernel] Error showing widget input prompt:', error);
      // On error, use default value
      value = undefined;
    }

    // Send response back to Python
    this.sendWidgetInputResponse({
      type: 'input_response',
      id: request.id,
      value: value ?? request.default_value,
      cancelled: value === undefined,
    });
  }

  /**
   * Send widget input response to Python kernel via stdin.
   */
  private sendWidgetInputResponse(response: WidgetInputResponse): void {
    if (!this._process?.stdin) {
      console.error('[Python Kernel] Cannot send input response - process not running');
      return;
    }

    const responseLine = JSON.stringify(response) + '\n';
    this._process.stdin.write(responseLine);

    if (this._debugMode) {
      console.debug('[Python Kernel] Sent widget input response:', response.id, response.cancelled ? '(cancelled)' : response.value);
    }
  }

  /**
   * Get the spark status from this executor's kernel initialization
   */
  getSparkStatus(): string | undefined {
    return this._sparkStatus;
  }

  /**
   * Get the venv info from this executor's kernel initialization
   */
  getVenvInfo(): VenvInfo | undefined {
    return this._venvInfo;
  }

  /**
   * Get the databricks-connect version from this executor's kernel initialization
   */
  getDbConnectVersion(): string | undefined {
    return this._dbConnectVersion;
  }

  /**
   * Execute Python code
   *
   * @param code - Python code to execute
   * @param timeout - Execution timeout in milliseconds (default: EXECUTION_TIMEOUT_MS)
   * @returns ExecutionResult
   */
  async execute(code: string, timeout: number = EXECUTION_TIMEOUT_MS): Promise<ExecutionResult> {
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
        error: extractErrorMessage(error),
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
      const response = await this.sendRequest(request, SHORT_OPERATION_TIMEOUT_MS);
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
      const response = await this.sendRequest(request, SHORT_OPERATION_TIMEOUT_MS);
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
      const response = await this.sendRequest(request, SHORT_OPERATION_TIMEOUT_MS);
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
   * Interrupt current execution.
   * Sends SIGINT to the Python process AND immediately resolves any pending
   * execution requests with a KeyboardInterrupt error to ensure the UI updates
   * without waiting for the Python process to respond.
   */
  interrupt(): void {
    if (this._process) {
      // Send SIGINT to Python process
      this._process.kill('SIGINT');

      // Immediately resolve all pending execution requests with KeyboardInterrupt
      // This ensures the UI updates immediately without waiting for Python to respond
      for (const [id, pending] of this._pendingRequests) {
        if (id.startsWith('exec-')) {
          clearTimeout(pending.timeout);
          this._pendingRequests.delete(id);
          // Resolve (not reject) with KeyboardInterrupt so the cell shows "interrupted"
          pending.resolve({
            type: 'result',
            success: false,
            stdout: '',
            stderr: '',
            error: 'Execution interrupted',
            errorType: 'KeyboardInterrupt',
          });
        }
      }
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
    this._startPromise = null;

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
