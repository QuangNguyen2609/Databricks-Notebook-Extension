/**
 * Process Environment Utility
 *
 * Builds environment variables for kernel process spawning.
 */

/**
 * Options for building kernel environment
 */
export interface KernelEnvironmentOptions {
  /** Databricks profile name */
  profileName?: string;
  /** Enable debug mode */
  debugMode?: boolean;
}

/**
 * Build environment variables for kernel process
 * @param options - Environment configuration options
 * @returns Environment variables for the process
 */
export function buildKernelEnvironment(options: KernelEnvironmentOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  if (options.profileName) {
    env.DATABRICKS_CONFIG_PROFILE = options.profileName;
  }

  if (options.debugMode) {
    env.DATABRICKS_KERNEL_DEBUG = 'true';
  }

  return env;
}
