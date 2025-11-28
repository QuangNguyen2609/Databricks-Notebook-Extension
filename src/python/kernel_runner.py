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
    Get the Databricks profile to use.
    Checks environment variables and config file for profile name.
    """
    import os
    import configparser

    # Check environment variable first
    profile = os.environ.get('DATABRICKS_CONFIG_PROFILE')
    if profile:
        return profile

    # Check if there's a default profile or find the first available
    config_path = os.path.expanduser('~/.databrickscfg')
    if os.path.exists(config_path):
        config = configparser.ConfigParser()
        config.read(config_path)
        sections = config.sections()

        # Prefer DEFAULT if it exists
        if 'DEFAULT' in sections:
            return 'DEFAULT'
        # Otherwise use the first profile
        if sections:
            return sections[0]

    return None


def _get_token_from_cache(host: str) -> str | None:
    """
    Try to get a token from the Databricks CLI token cache.
    This is used when auth_type=databricks-cli is configured.
    """
    import os
    import json

    cache_path = os.path.expanduser('~/.databricks/token-cache.json')
    if not os.path.exists(cache_path):
        return None

    try:
        with open(cache_path, 'r') as f:
            cache = json.load(f)

        tokens = cache.get('tokens', {})
        # Normalize host (remove trailing slash)
        host = host.rstrip('/')

        # Look for token matching our host
        for key, token_data in tokens.items():
            if host in key or key in host:
                token = token_data.get('access_token')
                if token:
                    return token

        # If no exact match, try the first token
        if tokens:
            first_key = next(iter(tokens))
            return tokens[first_key].get('access_token')

    except Exception:
        pass

    return None


def _initialize_spark_session():
    """
    Try to initialize a Databricks Connect SparkSession.
    This makes 'spark' available in the namespace like in Databricks notebooks.
    """
    import os
    import configparser
    errors = []

    # Check for Databricks configuration
    has_databricks_config = (
        os.environ.get('DATABRICKS_HOST') or
        os.environ.get('SPARK_REMOTE') or
        os.path.exists(os.path.expanduser('~/.databrickscfg'))
    )

    # Get profile to use
    profile = _get_databricks_profile()

    # Read host from config if available
    host = os.environ.get('DATABRICKS_HOST')
    if not host and profile:
        config_path = os.path.expanduser('~/.databrickscfg')
        if os.path.exists(config_path):
            config = configparser.ConfigParser()
            config.read(config_path)
            if config.has_option(profile, 'host'):
                host = config.get(profile, 'host')

    # Try Databricks Connect v2 (databricks-connect >= 13.0)
    try:
        from databricks.connect import DatabricksSession

        # Try to get or create session
        builder = DatabricksSession.builder

        # If SPARK_REMOTE is set, use it (this is how Databricks extension configures it)
        spark_remote = os.environ.get('SPARK_REMOTE')
        if spark_remote:
            builder = builder.remote(spark_remote)
        elif profile:
            # First try using the profile directly
            try:
                builder = builder.profile(profile)
                spark = builder.getOrCreate()
                _namespace['spark'] = spark
                _namespace['DatabricksSession'] = DatabricksSession
                return f"OK: Databricks Connect session initialized (profile: {profile})"
            except Exception as profile_error:
                # If profile auth fails (e.g., databricks-cli auth), try token cache
                errors.append(f"Profile auth failed: {type(profile_error).__name__}")

                if host:
                    token = _get_token_from_cache(host)
                    if token:
                        # Use host + token from cache with serverless
                        try:
                            builder = DatabricksSession.builder.host(host).token(token).serverless(True)
                            spark = builder.getOrCreate()
                            _namespace['spark'] = spark
                            _namespace['DatabricksSession'] = DatabricksSession
                            return f"OK: Databricks Connect session initialized (serverless)"
                        except Exception as token_error:
                            errors.append(f"Token auth failed: {type(token_error).__name__}: {token_error}")
                    else:
                        errors.append(f"No token found in cache for host: {host}")
                # Don't re-raise, fall through to error message

        spark = builder.getOrCreate()
        _namespace['spark'] = spark
        _namespace['DatabricksSession'] = DatabricksSession
        return f"OK: Databricks Connect session initialized (profile: {profile or 'default'})"
    except ImportError as e:
        errors.append(f"databricks.connect import failed: {e}")
    except Exception as e:
        errors.append(f"DatabricksSession error: {type(e).__name__}: {e}")

    # Provide helpful message
    error_msg = "; ".join(errors) if errors else "Unknown error"
    return f"WARN: Spark not initialized ({error_msg}). Run spark initialization code manually."


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
