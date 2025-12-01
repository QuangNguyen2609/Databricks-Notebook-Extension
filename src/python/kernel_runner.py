#!/usr/bin/env python3
"""
Persistent Python kernel runner for Databricks Notebook Viewer.
Receives code via stdin (JSON), executes in persistent namespace,
returns results via stdout (JSON).

Protocol:
- Input (JSON line): {"id": "exec-123", "code": "x = 1\nprint(x)"}
- Output (JSON line): {"id": "exec-123", "success": true, "stdout": "1\n", "stderr": ""}
"""
import sys
import json
import io
import traceback
import signal

# Persistent namespace for variable storage across cells
_namespace = {'__name__': '__main__', '__builtins__': __builtins__}


def _get_databricks_profile():
    """
    Get the Databricks profile to use from environment variable only.
    No auto-selection - profile must be explicitly set by the extension.
    """
    import os

    # Only use environment variable - extension sets this based on user selection
    profile = os.environ.get('DATABRICKS_CONFIG_PROFILE')
    return profile


def _get_token_from_cache(host: str) -> str | None:
    """
    Get token from Databricks CLI token cache with EXACT host matching.
    Used as fallback when profile auth fails (e.g., databricks-cli auth type).
    """
    import os

    cache_path = os.path.expanduser('~/.databricks/token-cache.json')
    if not os.path.exists(cache_path):
        return None

    try:
        with open(cache_path, 'r') as f:
            cache = json.load(f)

        tokens = cache.get('tokens', {})

        # Normalize host for comparison
        normalized_host = host.rstrip('/').lower()
        if not normalized_host.startswith('https://'):
            normalized_host = f'https://{normalized_host}'

        # EXACT match only - no substring matching or fallback
        for key, token_data in tokens.items():
            normalized_key = key.rstrip('/').lower()
            if not normalized_key.startswith('https://'):
                normalized_key = f'https://{normalized_key}'

            if normalized_key == normalized_host:
                return token_data.get('access_token')

        # No fallback to first token - return None if no exact match
        return None
    except Exception:
        pass

    return None


def _initialize_spark_session():
    """
    Initialize Databricks Connect SparkSession with serverless compute.
    """
    import os
    import configparser
    errors = []

    profile = _get_databricks_profile()

    # Read host from config
    host = os.environ.get('DATABRICKS_HOST')
    if not host and profile:
        config_path = os.path.expanduser('~/.databrickscfg')
        if os.path.exists(config_path):
            config = configparser.ConfigParser()
            config.read(config_path)
            if config.has_option(profile, 'host'):
                host = config.get(profile, 'host')

    try:
        from databricks.connect import DatabricksSession

        # Method 1: SPARK_REMOTE env var (Databricks extension sets this)
        spark_remote = os.environ.get('SPARK_REMOTE')
        if spark_remote:
            spark = DatabricksSession.builder.remote(spark_remote).getOrCreate()
            _namespace['spark'] = spark
            _namespace['DatabricksSession'] = DatabricksSession
            return "OK: Databricks Connect initialized (SPARK_REMOTE)"

        # Method 2: Profile + serverless
        if profile:
            try:
                spark = DatabricksSession.builder.profile(profile).serverless(True).getOrCreate()
                _namespace['spark'] = spark
                _namespace['DatabricksSession'] = DatabricksSession
                return f"OK: Databricks Connect initialized (profile: {profile})"
            except Exception as e:
                errors.append(f"Profile failed: {e}")

        # Method 3: Token from CLI cache + serverless (fallback for databricks-cli auth)
        if host:
            token = _get_token_from_cache(host)
            if token:
                try:
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
        dict with success, stdout, stderr, and optionally error
    """
    stdout_capture = io.StringIO()
    stderr_capture = io.StringIO()
    old_stdout, old_stderr = sys.stdout, sys.stderr

    try:
        sys.stdout = stdout_capture
        sys.stderr = stderr_capture

        # Compile the code to check for syntax errors
        compiled = compile(code, '<cell>', 'exec')

        # Execute in persistent namespace
        exec(compiled, _namespace)

        return {
            'success': True,
            'stdout': stdout_capture.getvalue(),
            'stderr': stderr_capture.getvalue(),
        }
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
    global _namespace
    _namespace = {'__name__': '__main__', '__builtins__': __builtins__}
    # Re-initialize spark session after reset
    spark_status = _initialize_spark_session()
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

    # Initialize Spark session if available
    spark_status = _initialize_spark_session()

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
