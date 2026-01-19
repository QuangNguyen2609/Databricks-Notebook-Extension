# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This VS Code extension renders Databricks `.py` notebook files as proper notebooks with visual cell separation, rendered Markdown, and syntax-highlighted code cells. It bridges the gap between Databricks' `.py` export format and VS Code's native notebook interface.

## Development Commands

### Build and Compilation
```bash
npm run compile          # Build with webpack (development)
npm run watch           # Watch mode for development
npm run package         # Production build (creates dist/)
bash build.sh           # Build and package as .vsix
```

### Testing
```bash
npm run test:unit       # Run unit tests with Mocha
npm run test:coverage   # Run tests with coverage report
npm run test           # Run full test suite
```

### Code Quality
```bash
npm run type-check      # TypeScript type checking (no emit)
npm run lint           # Run ESLint
npm run lint:fix       # Auto-fix linting issues
npm run ci             # Run all checks (type-check + lint + test + compile)
```

### Debugging
1. Open project in VS Code
2. Press `F5` to launch Extension Development Host
3. Open a Databricks `.py` file in the dev window to test

## Architecture

### Core Data Flow: .py File ↔ Notebook

The extension operates on a serialization/deserialization cycle:

1. **Deserialization** (File → Notebook):
   - `parser.ts` → Parses Databricks `.py` format into `DatabricksCell[]`
   - `serializer.ts` → Converts cells into VS Code `NotebookData`
   - Cells rendered in notebook UI

2. **Serialization** (Notebook → File):
   - `serializer.ts` → Converts `NotebookData` back to `DatabricksCell[]`
   - `parser.ts` → Serializes cells back to Databricks `.py` format
   - File saved with preserved formatting

### Key Components

**`src/extension.ts`** - Extension lifecycle and coordination
- Registers notebook serializer and controllers
- Handles auto-detection of Databricks notebooks
- Implements "close-then-open" pattern for seamless tab replacement
- Manages session state (`processingDocuments`, `viewingAsRawText`, `autoDetectedCells`)
- SQL auto-detection: Python cells starting with SQL keywords auto-convert to SQL cells

**`src/parser.ts`** - Databricks format parser/serializer
- Parses `# Databricks notebook source` header
- Splits cells on `# COMMAND ----------` delimiters
- Extracts magic commands (`%md`, `%sql`, `%python`, etc.)
- Extracts cell titles from `# DBTITLE` metadata
- **Round-trip preservation**: Stores `originalLines` in metadata, only re-serializes modified cells
- **Magic command sorting**: Commands sorted by length (longest first) to prevent `%r` matching before `%run`

**`src/serializer.ts`** - VS Code NotebookSerializer implementation
- Converts between Databricks cells and VS Code `NotebookCellData`
- Preserves metadata for round-trip editing (`databricksType`, `magicCommand`, `title`, `originalLines`)
- Infers cell types from language IDs (sql, scala, r, shellscript)
- Detects content changes by comparing with `originalContent`

**`src/kernels/kernelManager.ts`** - Python environment discovery
- Discovers Python interpreters via `ms-python.python` extension API
- Creates one `NotebookController` per interpreter
- Refreshes controllers when environments change
- Provides VS Code's native kernel picker UI

**`src/kernels/pythonKernelController.ts`** - Notebook execution
- Implements `NotebookController` for each Python interpreter
- Executes Python cells with persistent state
- **SQL cells**: Auto-wraps in `spark.sql()` for Databricks Connect
- **Shell cells**: Auto-wraps in `subprocess.run()` for local execution
- Shows informational messages for non-executable cells (Scala, R, `%run`, `%fs`)

**`src/kernels/persistentExecutor.ts`** - Long-running Python subprocess
- Manages persistent Python process for state retention
- JSON protocol communication via stdin/stdout
- Supports execute, reset, interrupt, ping commands
- Variables persist between cell executions (like Jupyter)

**`src/python/kernel_runner.py`** - Python execution backend
- Persistent namespace for variable storage
- Captures stdout/stderr and exceptions
- **Databricks Connect auto-initialization**:
  - Reads config from `~/.databrickscfg`
  - Loads OAuth tokens from `~/.databricks/token-cache.json`
  - Enables serverless compute by default

**`src/utils/dotenv.ts`** - Environment variable loader
- Parses `.env` files in standard format (KEY=value, quoted values, comments)
- Searches for `.env` files in workspace root, notebook directory, and custom path
- Merges variables with proper precedence (custom > notebook dir > workspace)

### Unified Tab Experience Pattern

The extension uses a "close-then-open" pattern to avoid duplicate tabs:

1. Find current editor tab and its view column
2. Close the existing tab first
3. Open new view in the same view column

This pattern is used in three places:
- Auto-open when detecting Databricks notebooks
- Notification prompt flow ("Open as Notebook")
- Manual command ("Open as Databricks Notebook" button)

### Session State Management

**`processingDocuments`** (Set<string>): Prevents race conditions during auto-open
- Added when processing starts
- Cleared after 500ms timeout
- Allows files to be reopened after closing

**`viewingAsRawText`** (Set<string>): Tracks "View Source" command usage
- Set when user explicitly views as text
- Cleared when text editor tab closes
- Prevents auto-open from re-converting to notebook

**`autoDetectedCells`** (Set<string>): Tracks SQL auto-detection
- Prevents repeated auto-conversion of same cell
- Key format: `{notebookUri}:{cellIndex}`

## Important Technical Details

### Databricks Format Specifics

**Cell delimiter**: `# COMMAND ----------`

**Magic commands**: Prefixed with `# MAGIC ` (note trailing space)
```python
# MAGIC %md
# MAGIC # Heading
# MAGIC Content here
```

**Bare MAGIC lines**: `# MAGIC` (no trailing space) renders as blank line in markdown

**Cell titles**:
```python
# DBTITLE 0,Title Text
# or
# DBTITLE 1,Title Text
```

### Round-trip Preservation

To minimize git diffs, the serializer:
1. Stores `originalLines` and `originalContent` in cell metadata during deserialization
2. Compares current content with `originalContent` during serialization
3. Uses `originalLines` if content unchanged
4. Only re-serializes modified cells

This ensures unchanged cells produce zero git diff noise.

### Auto-Open Safeguards

The extension skips auto-open for:
- Non-file URIs (git:, vscode-diff:, etc.) - prevents git diff issues
- Documents in diff editor tabs - prevents duplicate tab spam
- Documents marked as `viewingAsRawText` - respects user intent
- Documents currently `processingDocuments` - prevents race conditions

### Python Kernel Integration

Requires `ms-python.python` extension. The kernel manager:
1. Initializes Python extension API
2. Discovers all available Python environments
3. Creates one controller per environment
4. VS Code's kernel picker shows all options
5. User selects preferred kernel for execution

Databricks Connect is auto-initialized on kernel start if configured in `~/.databrickscfg`.

## Configuration Options

| Setting | Default | Purpose |
|---------|---------|---------|
| `databricks-notebook.autoOpenNotebooks` | `false` | Auto-open detected notebooks |
| `databricks-notebook.showNotification` | `true` | Show prompt for detected notebooks |
| `databricks-notebook.pythonExecutionTimeout` | `60000` | Cell execution timeout (ms) |
| `databricks-notebook.enableScrollableOutput` | `true` | Enable scrollable output |
| `databricks-notebook.dotenvPath` | `""` | Custom path to .env file for kernel environment |

## Testing Strategy

The test suite (`src/test/parser.test.ts`) has 29 tests covering:
- Header detection
- Single and multiple cell parsing
- All magic command types (md, sql, scala, r, sh, run, pip, fs)
- DBTITLE metadata
- Round-trip serialization preservation
- Edge cases (empty cells, bare MAGIC lines)

Tests use Mocha with TypeScript via ts-node.

## CI/CD Pipeline

GitHub Actions workflow (`.github/workflows/ci.yml`):
- Multi-platform: Ubuntu, Windows, macOS
- Node.js versions: 18.x, 20.x
- Steps: type-check → lint → test → coverage → package
- Automated release on version tags

## Dependencies

**Required Extensions**:
- `ms-python.python` - For Python kernel execution

**Key Runtime Dependencies**:
- VS Code Notebook API (`vscode.NotebookSerializer`, `vscode.NotebookController`)
- Python extension API for environment discovery

## Common Patterns to Follow

### When Adding New Magic Commands

1. Add to `MAGIC_COMMANDS` in `src/parser.ts` (longer commands first)
2. Update language mapping in `src/serializer.ts`
3. Add execution support in `src/kernels/pythonKernelController.ts` if applicable
4. Add tests in `src/test/parser.test.ts`

### When Modifying Serialization

Always preserve round-trip capability:
- Store original content in metadata
- Detect changes before re-serialization
- Test with `npm run test:unit` to verify round-trip preservation

### When Changing Tab Behavior

Use the "close-then-open" pattern:
1. Find current tab with `findTextEditorTab()` or `findNotebookTab()`
2. Get view column before closing
3. Close tab with `vscode.window.tabGroups.close()`
4. Open new view in same view column

## Version History Notes

- v0.3.11: Fixed timestamp overflow error for extreme dates (e.g., year 4712)
- v0.3.10: %pip magic command support for Jupyter-style package management
- v0.0.6: Unified tab experience for notebook button, enhanced Python kernel discovery
- v0.0.5: SQL auto-detection, SQL cell serialization fix
- v0.0.4: Scrollable output, git diff fix
- v0.0.3: Databricks Connect integration, round-trip preservation
- v0.0.2: Toggle view feature, Python kernel integration
- v0.0.1: Initial parser and notebook API integration
