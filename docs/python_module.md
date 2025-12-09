# Local Python Module Import Support

This document describes the local Python module import feature that enables Databricks-style imports in VS Code notebooks.

## Overview

Databricks notebooks allow importing from local folders without requiring `__init__.py` files. This extension replicates that behavior for local development, enabling seamless code sharing between Databricks and VS Code.

## The Problem

Standard Python requires `__init__.py` files to recognize a folder as a package:

```
# This structure requires __init__.py for imports to work in standard Python:
spend_agent/
  notebook.py
  utils/
    __init__.py          # Required in standard Python!
    langgraph_utils.py
```

However, Databricks treats folders with `.py` files as implicit packages without needing `__init__.py`:

```
# This structure works in Databricks WITHOUT __init__.py:
spend_agent/
  notebook.py
  utils/                 # No __init__.py needed
    langgraph_utils.py
```

## The Solution

The extension implements a custom Python import finder (`DatabricksBackwardsCompatibleFinder`) that mimics Databricks' behavior:

1. **Path Discovery**: When a notebook is opened, the extension discovers relevant import paths
2. **Custom Finder Installation**: A custom import finder is installed into Python's `sys.meta_path`
3. **Implicit Package Recognition**: Folders containing `.py` files are treated as packages even without `__init__.py`

## Supported Import Patterns

| Pattern | Example | Description |
|---------|---------|-------------|
| Sibling .py file | `import helper` | Import `.py` file in same directory as notebook |
| Implicit package | `import utils` | Import folder with `.py` files (no `__init__.py`) |
| Implicit package module | `from utils.langgraph_utils import func` | Import module from implicit package |
| Nested implicit packages | `from pkg.subpkg.module import func` | Import from nested folders without `__init__.py` |
| Regular packages | `from regular_pkg.module import func` | Standard packages with `__init__.py` still work |
| Mixed packages | Both implicit and regular | Can use both types in same project |

## Architecture

### Files Modified

#### `src/python/path_utils.py`

Main module for import path handling:

- **`DatabricksBackwardsCompatibleFinder`** class
  - Custom `MetaPathFinder` that hooks into Python's import system
  - Detects implicit packages (folders with `.py` files but no `__init__.py`)
  - Returns namespace package specs for implicit packages

- **`install_databricks_finder(base_paths)`** function
  - Installs the custom finder into `sys.meta_path`
  - Called automatically by `setup_import_paths()`

- **`setup_import_paths(notebook_path, workspace_root)`** function
  - Discovers all relevant import paths
  - Adds paths to `sys.path`
  - Installs the Databricks-compatible finder

- **`discover_import_paths(notebook_path, workspace_root)`** function
  - Returns list of paths needed for imports
  - Includes notebook directory, workspace root, and package roots

- **`find_package_roots(start_dir, workspace_root)`** function
  - Traverses directory tree to find package roots
  - Respects workspace boundaries

#### `src/kernels/kernel_runner.py`

Entry point that calls `setup_import_paths()` on kernel startup:

```python
# Setup import paths for local modules
notebook_path = os.environ.get('DATABRICKS_NOTEBOOK_PATH', '')
workspace_root = os.environ.get('DATABRICKS_WORKSPACE_ROOT', '')

if notebook_path:
    from path_utils import setup_import_paths
    extra_paths = setup_import_paths(notebook_path, workspace_root)
```

#### `src/kernels/utils.ts`

Builds environment variables passed to the Python kernel:

```typescript
function buildKernelEnvironment(profileName, debugMode, notebookPath, workspaceRoot) {
  // ...
  if (notebookPath) {
    env.DATABRICKS_NOTEBOOK_PATH = notebookPath;
  }
  if (workspaceRoot) {
    env.DATABRICKS_WORKSPACE_ROOT = workspaceRoot;
  }
}
```

#### `src/kernels/pythonKernelController.ts`

Passes notebook path to the executor:

```typescript
this._executor = new PersistentExecutor(
  this._environment.path,
  this._extensionPath,
  this.getWorkingDirectory(notebook),
  profileName,
  notebook.uri.fsPath  // Notebook path for local module imports
);
```

### Data Flow

```
1. User opens notebook in VS Code
   ↓
2. PythonKernelController creates executor with notebook path
   ↓
3. PersistentExecutor spawns Python process with environment variables:
   - DATABRICKS_NOTEBOOK_PATH=/path/to/notebook.py
   - DATABRICKS_WORKSPACE_ROOT=/path/to/workspace
   ↓
4. kernel_runner.py reads environment variables
   ↓
5. setup_import_paths() is called:
   - Discovers import paths (notebook dir, workspace root, package roots)
   - Adds paths to sys.path
   - Installs DatabricksBackwardsCompatibleFinder
   ↓
6. User code can now import:
   - from utils.langgraph_utils import func  # Works!
```

## How the Custom Finder Works

The `DatabricksBackwardsCompatibleFinder` implements `importlib.abc.MetaPathFinder`:

```python
class DatabricksBackwardsCompatibleFinder(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path, target=None):
        parts = fullname.split('.')

        for base_path in self.base_paths:
            candidate = os.path.join(base_path, *parts)

            if os.path.isdir(candidate):
                # Skip if it has __init__.py (let normal finder handle it)
                if os.path.isfile(os.path.join(candidate, '__init__.py')):
                    continue

                # Check if it's a valid implicit package
                contents = os.listdir(candidate)
                has_py_files = any(f.endswith('.py') for f in contents)
                has_subdirs = any(os.path.isdir(os.path.join(candidate, d))
                                  for d in contents)

                if has_py_files or has_subdirs:
                    # Return namespace package spec
                    spec = importlib.machinery.ModuleSpec(
                        fullname, None, origin=candidate, is_package=True
                    )
                    spec.submodule_search_locations = [candidate]
                    return spec

        return None
```

Key points:
1. Finder is installed at the **beginning** of `sys.meta_path`
2. It only handles folders **without** `__init__.py`
3. Regular packages (with `__init__.py`) are handled by Python's default finders
4. Returns a "namespace package" spec that allows submodule imports

## Example Project Structure

```
InsightFactory/
└── apps/
    └── spend_agent/
        ├── ml_agentic_spend.vendor_classification_runs.py  # Notebook
        └── utils/                                           # NO __init__.py
            ├── langgraph_utils.py
            ├── postgres_utils.py
            └── databricks_utils.py
```

With this structure, the notebook can use:
```python
from utils.langgraph_utils import get_langgraph_client_databricks
from utils.postgres_utils import create_postgres_cleanup_guard
```

## Troubleshooting

### Import still fails

1. **Restart the kernel**: The import paths are set up at kernel startup
2. **Check the kernel output**: Enable debug mode to see which paths were added
3. **Verify file exists**: Make sure the module file actually exists at the expected path

### Debug mode

Set environment variable to see detailed import path information:
```
DATABRICKS_KERNEL_DEBUG=true
```

This will log:
- `DATABRICKS_NOTEBOOK_PATH` value
- `DATABRICKS_WORKSPACE_ROOT` value
- Paths added to `sys.path`
- Whether the custom finder was installed

### Common issues

| Issue | Cause | Solution |
|-------|-------|----------|
| `ModuleNotFoundError` | Kernel not restarted after changes | Restart kernel |
| Import works in Databricks but not locally | Missing dependencies | Install missing packages in local environment |
| Wrong module imported | Name collision with installed package | Rename local module or use explicit path |

## Testing

Run the test suite to verify import functionality:

```bash
npm run test:unit
```

Key test file: `src/test/localImports.test.ts`

Test categories:
- Path discovery tests
- Package root detection
- Implicit package support (Databricks-style)
- Edge cases (nested packages, mixed packages, etc.)

## Limitations

1. **Relative imports within implicit packages**: `from .module import func` may not work in implicit packages (use absolute imports instead)
2. **Package-level `__init__.py` code**: Since there's no `__init__.py`, package initialization code won't run
3. **IDE IntelliSense**: Some IDEs may not recognize implicit packages for autocomplete (Pylance works with proper configuration)

## Related Configuration

### VS Code Settings

The extension respects these settings:
- `databricks-notebook.pythonExecutionTimeout`: Cell execution timeout (ms)
- `databricks-notebook.kernelStartupTimeout`: Kernel startup timeout (ms)

### Pylance Configuration

For best IntelliSense support with implicit packages, add to your `pyrightconfig.json` or VS Code settings:

```json
{
  "python.analysis.extraPaths": ["${workspaceFolder}/apps/spend_agent"]
}
```
