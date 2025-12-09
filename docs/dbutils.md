# dbutils Support in Databricks Notebook Extension

This document explains how `dbutils` is implemented and supported in the extension.

## Overview

The extension provides two types of `dbutils` support:

1. **IntelliSense (Type Stubs)** - Code completion and type checking in the editor
2. **Runtime Execution** - Actual `dbutils` functionality when running cells

## Architecture

### IntelliSense Support

Type stubs are defined in `src/intellisense/dbutilsTypeStubs.ts` and provide:

- Code completion for `dbutils.fs`, `dbutils.notebook`, `dbutils.secrets`, `dbutils.widgets`
- Method signatures with parameter types
- Return type information for Pylance/pyright

The type stubs are injected into a virtual document preamble used by the linting system (`src/linting/virtualDocumentGenerator.ts`).

### Runtime Support

Runtime `dbutils` is initialized in `src/python/kernel_runner.py` using the Databricks SDK's `WorkspaceClient`:

```python
from databricks.sdk import WorkspaceClient

w = WorkspaceClient(profile=profile)  # or host/token auth
dbutils = w.dbutils
```

## Authentication Flow

The `initialize_dbutils()` function tries authentication methods in order:

1. **Profile-based auth** - Uses `~/.databrickscfg` profile
2. **Token-based auth** - Uses host URL and OAuth token from cache
3. **Default config** - Falls back to environment variables

## Available Utilities

From local development machines, these `dbutils` modules are available:

| Module | Description | Source |
|--------|-------------|--------|
| `dbutils.fs` | File system operations (ls, cp, mv, rm, mkdirs, head, put) | SDK |
| `dbutils.secrets` | Secret management (get, getBytes, list, listScopes) | SDK |
| `dbutils.widgets` | **Interactive widgets** (text, dropdown, multiselect, combobox, get, remove) | Local |
| `dbutils.jobs` | Job utilities | SDK |

**Not available locally:** `dbutils.notebook.run()` (requires cluster), `dbutils.library`, `dbutils.credentials`

## Interactive Widgets

The extension provides **interactive widget support** that works locally. When you call `dbutils.widgets.get()`, a VS Code input prompt appears at the top of the window, allowing you to enter a value.

### How It Works

1. **Define widgets** using `dbutils.widgets.text()`, `dropdown()`, `multiselect()`, or `combobox()`
2. **Get values** with `dbutils.widgets.get(name)` - shows VS Code input prompt on first call
3. **Values are cached** - subsequent `get()` calls return the cached value without prompting
4. **Reset values** with `dbutils.widgets.remove(name)` or kernel restart

### Widget Types

| Method | VS Code UI | Description |
|--------|------------|-------------|
| `text(name, default, label)` | Input Box | Free text input |
| `dropdown(name, default, choices, label)` | Quick Pick | Single selection from list |
| `multiselect(name, default, choices, label)` | Quick Pick (multi) | Multiple selections, comma-separated |
| `combobox(name, default, choices, label)` | Input Box | Text input with suggestions |

### Example

```python
# Define widgets
dbutils.widgets.text("name", "World", "Enter your name")
dbutils.widgets.dropdown("env", "dev", ["dev", "staging", "prod"], "Select environment")

# Get values (prompts on first call)
name = dbutils.widgets.get("name")      # Shows input box
env = dbutils.widgets.get("env")        # Shows dropdown picker

print(f"Hello {name} from {env}!")

# Second call uses cached value (no prompt)
name_again = dbutils.widgets.get("name")  # Returns cached value

# Clear a widget's cached value
dbutils.widgets.remove("name")           # Next get() will prompt again

# Clear all widgets
dbutils.widgets.removeAll()
```

### Differences from Databricks Runtime

| Feature | Databricks Runtime | Local Extension |
|---------|-------------------|-----------------|
| Widget UI | Notebook header bar | VS Code input prompt |
| Value persistence | Per notebook run | Per kernel session |
| `getAll()` | Returns all values | Returns only set values |
| Cancel behavior | N/A | Returns default value |

## Startup Status

When the kernel starts, the status message shows both Spark and dbutils initialization:

```
OK: Databricks Connect initialized (profile: DEFAULT). dbutils: SDK: OK (profile) | widgets: OK (interactive)
```

The dbutils status now has two parts:
- **SDK status** - Whether SDK-based utilities (fs, secrets, jobs) are available
- **widgets status** - Always shows "OK (interactive)" since local widgets always work

Possible SDK status messages:
- `SDK: OK (profile)` - Initialized using profile auth
- `SDK: OK (token)` - Initialized using token auth
- `SDK: OK (default)` - Initialized using environment variables
- `SDK: not available` - SDK initialization failed (widgets still work)

## Example Usage

```python
# List files in DBFS
files = dbutils.fs.ls("/mnt/data")
for f in files:
    print(f"{f.name} - {f.size} bytes")

# Get a secret
api_key = dbutils.secrets.get(scope="my-scope", key="api-key")

# Use widgets
dbutils.widgets.text("input", "default_value", "Enter value:")
value = dbutils.widgets.get("input")
```

## Troubleshooting

### "NameError: name 'dbutils' is not defined"

**Cause:** dbutils failed to initialize. Check:

1. **databricks-sdk installed:** `pip install databricks-sdk`
2. **Authentication configured:** Run `databricks auth login` or configure `~/.databrickscfg`
3. **Check kernel output:** Look for dbutils status in the kernel startup message

### dbutils methods not working

Some methods require a running cluster. The following are **not supported** in local development:

- `dbutils.notebook.run()` - Use `%run` magic command instead (shows info message)
- `dbutils.library.*` - Library management requires cluster
- `dbutils.credentials.*` - Credential passthrough requires cluster

### IntelliSense working but runtime fails

This indicates type stubs are loaded but runtime initialization failed. Verify:

1. Databricks SDK is installed in the selected Python environment
2. Authentication is properly configured
3. Network connectivity to Databricks workspace

## Dependencies

- **databricks-sdk** - Required for runtime dbutils (`pip install databricks-sdk`)
- **databricks-connect** - Required for Spark session (separate from dbutils)

## References

- [Databricks Utilities with Databricks Connect](https://docs.databricks.com/aws/en/dev-tools/databricks-connect/python/databricks-utilities)
- [Databricks SDK for Python](https://docs.databricks.com/aws/en/dev-tools/sdk-python)
- [dbutils Reference](https://docs.databricks.com/aws/en/dev-tools/databricks-utils)
