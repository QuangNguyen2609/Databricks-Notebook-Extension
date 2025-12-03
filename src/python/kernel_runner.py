#!/usr/bin/env python3
"""
Persistent Python kernel runner for Databricks Notebook Viewer.
Receives code via stdin (JSON), executes in persistent namespace,
returns results via stdout (JSON).

Protocol:
- Input (JSON line): {"id": "exec-123", "code": "x = 1\nprint(x)"}
- Output (JSON line): {"id": "exec-123", "success": true, "stdout": "1\n", "stderr": ""}
"""
# Standard library imports
import sys
import json
import io
import traceback
import signal
import os

# Display utilities
from display_utils import display_to_html

# Databricks authentication utilities
from databricks_utils import (
    log_debug,
    get_databricks_profile,
    get_token_from_cache,
    get_host_from_profile,
    get_auth_type_from_profile,
)

# Persistent namespace for variable storage across cells
_namespace = {'__name__': '__main__', '__builtins__': __builtins__}

# Storage for display() outputs
_display_outputs = []


def display(*args):
    """
    Display function that mimics Databricks display().
    Converts DataFrames, tables, and other objects to HTML for rich visualization.
    """
    display_to_html(*args, display_outputs=_display_outputs)


def initialize_spark_session():
    """
    Initialize Databricks Connect SparkSession with serverless compute.
    """
    errors = []

    profile = get_databricks_profile()
    log_debug(f"Profile from env: {profile}")
    log_debug(f"Home directory: {os.path.expanduser('~')}")
    log_debug(f"Platform: {os.name}")

    # Read host and auth_type from profile config
    host = os.environ.get('DATABRICKS_HOST')
    auth_type = None

    if profile:
        if not host:
            host = get_host_from_profile(profile)
            log_debug(f"Host from profile: {host}")
        auth_type = get_auth_type_from_profile(profile)
        log_debug(f"Auth type from profile: {auth_type}")

    try:
        from databricks.connect import DatabricksSession

        # Method 1: Profile + serverless (skip if auth_type=databricks-cli, it needs token from cache)
        if profile and auth_type != 'databricks-cli':
            log_debug(f"Attempting profile auth with profile: {profile}")
            try:
                spark = DatabricksSession.builder.profile(profile).serverless(True).getOrCreate()
                _namespace['spark'] = spark
                _namespace['DatabricksSession'] = DatabricksSession
                log_debug("Profile auth succeeded!")
                return f"OK: Databricks Connect initialized (profile: {profile})"
            except Exception as e:
                log_debug(f"Profile auth failed: {e}")
                log_debug(f"Full traceback:\n{traceback.format_exc()}")
                errors.append(f"Profile failed: {e}")
        elif auth_type == 'databricks-cli':
            log_debug("Profile uses databricks-cli auth, will use token cache directly")
        else:
            log_debug("No profile set, skipping profile auth")

        # Method 2: Token from CLI cache + serverless (for databricks-cli auth type)
        log_debug(f"Host for token cache lookup: {host}")
        if host:
            token = get_token_from_cache(host)
            log_debug(f"Token from cache: {'found' if token else 'not found'}")
            if token:
                try:
                    # IMPORTANT: Clear profile env var before token-based auth
                    # The SDK reads DATABRICKS_CONFIG_PROFILE and applies profile's auth_type,
                    # which can override explicit token auth (especially with auth_type=databricks-cli)
                    if 'DATABRICKS_CONFIG_PROFILE' in os.environ:
                        del os.environ['DATABRICKS_CONFIG_PROFILE']

                    spark = DatabricksSession.builder.host(host).token(token).serverless(True).getOrCreate()
                    _namespace['spark'] = spark
                    _namespace['DatabricksSession'] = DatabricksSession
                    return "OK: Databricks Connect initialized (token cache)"
                except Exception as e:
                    errors.append(f"Token cache failed: {e}")
            else:
                errors.append(f"No token found in cache for host: {host}")

    except ImportError as e:
        errors.append(f"Import failed: {e}")
    except Exception as e:
        errors.append(f"Error: {e}")

    error_msg = "; ".join(errors) if errors else "Unknown error"
    return f"WARN: Spark not initialized ({error_msg}). Run 'databricks auth login' to refresh tokens."


def handle_interrupt(signum, frame):
    """Handle SIGINT (Ctrl+C) gracefully."""
    raise KeyboardInterrupt()


def execute_code(code: str) -> dict:
    """
    Execute Python code in the persistent namespace.

    Args:
        code: Python code string to execute

    Returns:
        dict with success, stdout, stderr, display outputs, execution time, and optionally error
    """
    import time
    global _display_outputs
    stdout_capture = io.StringIO()
    stderr_capture = io.StringIO()
    old_stdout, old_stderr = sys.stdout, sys.stderr

    # Clear display outputs from previous execution
    _display_outputs = []

    # Track execution time
    start_time = time.time()

    try:
        sys.stdout = stdout_capture
        sys.stderr = stderr_capture

        # Compile the code to check for syntax errors
        compiled = compile(code, '<cell>', 'exec')

        # Execute in persistent namespace
        exec(compiled, _namespace)

        execution_time = time.time() - start_time

        result = {
            'success': True,
            'stdout': stdout_capture.getvalue(),
            'stderr': stderr_capture.getvalue(),
            'executionTime': execution_time,
        }

        # Add display outputs if any
        if _display_outputs:
            result['displayData'] = _display_outputs

        return result
    except SyntaxError as e:
        return {
            'success': False,
            'stdout': stdout_capture.getvalue(),
            'stderr': stderr_capture.getvalue(),
            'error': f"SyntaxError: {e.msg} (line {e.lineno})",
            'errorType': 'SyntaxError',
            'lineNumber': e.lineno,
        }
    except KeyboardInterrupt:
        return {
            'success': False,
            'stdout': stdout_capture.getvalue(),
            'stderr': stderr_capture.getvalue(),
            'error': 'Execution interrupted',
            'errorType': 'KeyboardInterrupt',
        }
    except Exception as e:
        return {
            'success': False,
            'stdout': stdout_capture.getvalue(),
            'stderr': stderr_capture.getvalue(),
            'error': traceback.format_exc(),
            'errorType': type(e).__name__,
        }
    finally:
        sys.stdout, sys.stderr = old_stdout, old_stderr


def reset_namespace():
    """Reset the namespace to initial state and re-initialize spark."""
    global _namespace, _display_outputs
    _namespace = {'__name__': '__main__', '__builtins__': __builtins__}
    _display_outputs = []

    # Add display() function to namespace
    _namespace['display'] = display

    # Re-initialize spark session after reset
    spark_status = initialize_spark_session()
    return {'success': True, 'message': f'Namespace reset. {spark_status}'}


def get_variables():
    """Get list of user-defined variables in namespace."""
    user_vars = {}
    for key, value in _namespace.items():
        if not key.startswith('_') and key not in ('__name__', '__builtins__'):
            try:
                user_vars[key] = {
                    'type': type(value).__name__,
                    'repr': repr(value)[:100]  # Truncate long representations
                }
            except Exception:
                user_vars[key] = {
                    'type': type(value).__name__,
                    'repr': '<unable to represent>'
                }
    return {'success': True, 'variables': user_vars}


def main():
    """Main loop - read JSON commands from stdin, execute, write JSON responses to stdout."""
    import sys as _sys

    # Set up signal handler for interrupts
    signal.signal(signal.SIGINT, handle_interrupt)

    # Log Python info for debugging
    python_info = f"Python {_sys.version_info.major}.{_sys.version_info.minor}.{_sys.version_info.micro} at {_sys.executable}"

    # Add display() function to namespace
    _namespace['display'] = display

    # Initialize Spark session if available
    spark_status = initialize_spark_session()

    # Send ready signal with spark status
    print(json.dumps({
        'type': 'ready',
        'version': '1.0',
        'python_info': python_info,
        'spark_status': spark_status
    }), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
            request_id = request.get('id')
            command = request.get('command', 'execute')

            if command == 'execute':
                code = request.get('code', '')
                result = execute_code(code)
            elif command == 'reset':
                result = reset_namespace()
            elif command == 'variables':
                result = get_variables()
            elif command == 'ping':
                result = {'success': True, 'message': 'pong'}
            else:
                result = {'success': False, 'error': f'Unknown command: {command}'}

            result['id'] = request_id
            result['type'] = 'result'
            print(json.dumps(result), flush=True)

        except json.JSONDecodeError as e:
            error_result = {
                'type': 'error',
                'success': False,
                'error': f'Invalid JSON: {str(e)}'
            }
            print(json.dumps(error_result), flush=True)
        except Exception as e:
            error_result = {
                'type': 'error',
                'success': False,
                'error': f'Internal error: {str(e)}'
            }
            print(json.dumps(error_result), flush=True)


if __name__ == '__main__':
    main()
