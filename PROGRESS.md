# Databricks Notebook Viewer - Development Progress

## Overview

This VS Code extension renders Databricks `.py` notebook files as proper notebooks with visual cell separation, rendered Markdown, and syntax-highlighted code cells.

---

## Completed Features

### Phase 1: Core Extension Infrastructure

#### Parser (`src/parser.ts`)
- [x] Detect Databricks notebooks via `# Databricks notebook source` header
- [x] Parse cell delimiters (`# COMMAND ----------`)
- [x] Extract MAGIC commands and map to cell types
- [x] Support all magic commands:
  - `%md`, `%md-sandbox` → Markdown cells
  - `%sql` → SQL cells
  - `%python` → Python cells
  - `%scala` → Scala cells
  - `%r` → R cells
  - `%sh` → Shell cells
  - `%fs` → Filesystem commands
  - `%run` → Notebook execution
  - `%pip` → Package installation
- [x] Parse `DBTITLE` metadata for cell titles
- [x] Serialize cells back to Databricks format (round-trip support)
- [x] Sort magic commands by length to prevent `%r` matching before `%run`

#### Serializer (`src/serializer.ts`)
- [x] Implement `vscode.NotebookSerializer` interface
- [x] Convert Databricks cells to VS Code `NotebookCellData`
- [x] Preserve cell metadata for round-trip editing
- [x] Handle Markup vs Code cell kinds

#### Controller (`src/controller.ts`)
- [x] Implement `vscode.NotebookController` for execution support
- [x] Display informative messages about execution requirements
- [x] Support execution order tracking

#### Extension Entry (`src/extension.ts`)
- [x] Register notebook serializer
- [x] Register notebook controller
- [x] Register "Open as Databricks Notebook" command
- [x] Auto-detect Databricks notebooks on file open
- [x] Configuration options for auto-open behavior

---

### Phase 2: User Experience Improvements

#### Command Icon
- [x] Added `$(notebook)` icon to "Open as Databricks Notebook" command
- [x] Icon appears in editor title bar for `.py` files
- [x] Tooltip shows "Open as Databricks Notebook" on hover
- [x] Hidden when already viewing as notebook (`!notebookEditorFocused`)

#### Seamless Auto-Open
- [x] **Fixed double-tab issue**: Close text editor FIRST, then open notebook
- [x] **Faster detection**: Use synchronous `document.lineAt(0)` instead of async file I/O
- [x] **Preserve view column**: Open notebook in same editor group as closed text file
- [x] **No permanent caching**: Use temporary processing flag (500ms) so files can be reopened

#### Configuration
- [x] `databricks-notebook.autoOpenNotebooks`: Auto-open detected notebooks
- [x] `databricks-notebook.showNotification`: Show prompt for detected notebooks

---

### Phase 3: Toggle View Feature

#### View Source Command (`databricks-notebook.openAsText`)
- [x] **Toggle between notebook and raw text view**: Switch from rendered notebook back to raw `.py` file
- [x] **Session-based tracking**: Closing and reopening still auto-opens as notebook
- [x] **View column preservation**: Opens in same editor position
- [x] **Editor title button**: Shows `$(code)` icon when viewing as notebook
- [x] **Tab close cleanup**: Automatically clears "view as raw" flag when tab is closed

---

### Phase 4: Python Kernel Integration

#### Kernel Manager (`src/kernels/kernelManager.ts`)
- [x] Discovers Python environments via `ms-python.python` extension API
- [x] Creates one `NotebookController` per Python interpreter
- [x] VS Code's native kernel picker shows all available interpreters
- [x] Refreshes controllers when environments change
- [x] Registers kernel commands (restart, interrupt)

#### Persistent Python Executor (`src/kernels/persistentExecutor.ts`)
- [x] Long-running Python subprocess for state persistence
- [x] Variables persist between cell executions (like Jupyter)
- [x] JSON protocol communication via stdin/stdout
- [x] Support for reset, interrupt, and ping commands
- [x] Shows spark initialization status on kernel start

#### Python Kernel Controller (`src/kernels/pythonKernelController.ts`)
- [x] Implements `vscode.NotebookController` for each Python interpreter
- [x] Executes Python cells with output capture
- [x] **SQL cell execution**: Auto-wraps SQL in `spark.sql()` for execution
- [x] **Shell cell execution**: Auto-wraps shell commands in `subprocess.run()`
- [x] Informational messages for non-executable cells (Scala, R, %run, %fs)
- [x] Execution order tracking

#### Python Kernel Runner (`src/python/kernel_runner.py`)
- [x] Persistent namespace for variable storage
- [x] JSON-based request/response protocol
- [x] Stdout/stderr capture
- [x] Exception handling with traceback
- [x] **Databricks Connect auto-initialization**:
  - Auto-detects profile from `~/.databrickscfg`
  - Reads OAuth tokens from `~/.databricks/token-cache.json` (for `auth_type=databricks-cli`)
  - Supports serverless compute (`.serverless(True)`)

#### Configuration
- [x] `databricks-notebook.pythonExecutionTimeout`: Cell execution timeout

---

### Phase 5: CI/CD Pipeline

#### GitHub Actions Workflow (`.github/workflows/ci.yml`)
- [x] Multi-platform testing: Ubuntu, Windows, macOS
- [x] Multiple Node.js versions: 18.x, 20.x
- [x] Type checking with `tsc --noEmit`
- [x] Linting with ESLint
- [x] Unit tests with Mocha
- [x] Code coverage with nyc/Istanbul
- [x] Extension packaging with webpack
- [x] Automated release on version tags

#### npm Scripts
- [x] `npm run type-check` - TypeScript type checking
- [x] `npm run lint` - ESLint linting
- [x] `npm run lint:fix` - Auto-fix linting issues
- [x] `npm run test:unit` - Run unit tests
- [x] `npm run test:coverage` - Tests with coverage report
- [x] `npm run ci` - Run all checks locally
- [x] `npm run compile` - Build with webpack
- [x] `npm run package` - Production build

---

### Phase 6: Multi-Profile Authentication

#### ProfileManager (`src/databricks/profileManager.ts`)
- [x] Parse `~/.databrickscfg` INI format profiles
- [x] File watcher for config changes
- [x] Profile selection with workspace state persistence
- [x] Event emitters for profile and profiles list changes
- [x] Support for default profile setting

#### Status Bar UI (`src/databricks/statusBar.ts`)
- [x] Visual indicator showing current profile
- [x] Click to open profile selector
- [x] Warning/error states for missing profiles
- [x] Configurable visibility

#### Profile Integration
- [x] Pass profile to Python kernel via environment variable
- [x] Auto-restart kernels on profile change
- [x] Exact token-to-host matching in Python
- [x] Profile provider function for controllers

---

### Phase 7: Round-trip Preservation

#### Parser Improvements (`src/parser.ts`)
- [x] **Bare `# MAGIC` handling**: Lines with `# MAGIC` (no trailing space) correctly render as blank lines in markdown
- [x] **Original lines preservation**: Store original raw lines for each cell during parsing
- [x] **Smart serialization**: Use original lines if cell content unchanged, only re-serialize modified cells
- [x] **Minimal git diffs**: Unchanged cells produce no git changes when file is saved

#### Serializer Improvements (`src/serializer.ts`)
- [x] **Store original content in metadata**: Preserve `originalLines` and `originalContent` through VS Code's notebook API
- [x] **Change detection**: Compare current content with original to detect modifications
- [x] **Format preservation**: Magic commands like `%sql`, `%md` stay on their own line with content below

---

## Test Coverage

### Parser Tests (29 tests, all passing)
- Header detection
- Single and multiple cell parsing
- Markdown cell parsing (including `%md-sandbox`)
- SQL cell parsing
- Scala, R, Shell cell parsing
- Special commands (`%run`, `%pip`, `%fs`)
- DBTITLE metadata
- Mixed content notebooks
- Serialization (Python, Markdown, delimiters, titles)
- Round-trip parsing preservation
- Utility functions (`countCells`, `getCellTypes`)

### ProfileManager Tests (17 tests, all passing)
- Config file parsing (single profile, multiple profiles, comments, whitespace)
- Profile selection and persistence
- Event emission (onDidChangeProfile)
- Profile retrieval (getAllProfiles, hasProfiles)
- Default profile loading from settings
- Workspace state restoration
- Missing profiles handling
- Malformed config handling

---

## Architecture

```
src/
├── extension.ts              # Extension entry point, command registration
├── serializer.ts             # NotebookSerializer for VS Code integration
├── parser.ts                 # Databricks .py format parser
├── types.ts                  # TypeScript interfaces
├── databricks/
│   ├── profileManager.ts     # Databricks profile discovery and management
│   └── statusBar.ts          # Status bar UI for profile display
├── kernels/
│   ├── index.ts              # Kernel module exports
│   ├── kernelManager.ts      # Manages multiple Python kernel controllers
│   ├── pythonKernelController.ts  # NotebookController per interpreter
│   └── persistentExecutor.ts # Persistent Python process manager
├── linting/
│   ├── index.ts              # Linting module exports
│   ├── virtualDocumentGenerator.ts  # Generates shadow .py files
│   ├── diagnosticMapper.ts  # Maps diagnostics to cells
│   └── notebookDiagnosticProvider.ts  # Orchestrates linting
├── utils/
│   ├── pythonExtensionApi.ts # Python extension API wrapper
│   ├── outputHandler.ts      # Execution output conversion
│   └── codeTransform.ts      # Code transformation utilities
├── python/
│   ├── kernel_runner.py      # Python script for persistent execution
│   └── display_utils.py      # DataFrame display and HTML generation
└── test/
    ├── parser.test.ts        # Comprehensive parser tests
    ├── profileManager.test.ts # ProfileManager unit tests
    ├── linting.test.ts       # Linting tests
    ├── runTest.ts            # Test runner
    └── suite/index.ts        # Test suite configuration
```

---

## Configuration Files

| File | Purpose |
|------|---------|
| `package.json` | Extension manifest, commands, menus, configuration |
| `tsconfig.json` | TypeScript compiler options |
| `webpack.config.js` | Bundler configuration |
| `.eslintrc.json` | ESLint rules for TypeScript |
| `.nycrc.json` | Code coverage configuration |
| `.github/workflows/ci.yml` | GitHub Actions CI/CD |

---

## Key Technical Decisions

### 1. Close-Then-Open Pattern
To avoid the jarring two-tab experience, the extension:
1. Finds the current text editor tab and its view column
2. Closes the text editor tab first
3. Opens the notebook in the same view column

### 2. Synchronous Content Check
Uses `document.lineAt(0).text` for instant detection instead of async file I/O, making auto-open feel instantaneous.

### 3. Temporary Processing Flag
Uses a `Set<string>` with 500ms timeout instead of permanent cache, ensuring:
- No duplicate processing during the same open operation
- Files can be reopened after closing

### 4. Magic Command Sorting
Commands are sorted by length (longest first) to prevent `%r` from matching before `%run`.

---

### Phase 8: Rich DataFrame Display and Linting

#### Display Function (`src/python/display_utils.py`)
- [x] **Databricks `display()` function** for rich DataFrame visualization
- [x] **Spark DataFrame support**: Renders Spark DataFrames as HTML tables
- [x] **Pandas DataFrame support**: Renders Pandas DataFrames as HTML tables
- [x] **List and dict support**: Converts Python data structures to HTML tables
- [x] **Databricks minimal dark theme**: Matches Databricks notebook styling
  - Dark background (#1e1e1e)
  - Header background (#252526)
  - Borders (#3a3a3a, #2d2d2d)
- [x] **Null value badges**: Displays null values as gray pills
- [x] **Execution time tracking**: Shows runtime in table footer
- [x] **Row count display**: Shows "Showing X of Y rows" when limited
- [x] **CSV download button**: Downloads displayed data as CSV file

#### Interactive Table Features
- [x] **Column sorting** with intelligent data type detection
  - Automatically detects numbers, strings, booleans, and nulls
  - Numeric sorting (including scientific notation)
  - Alphabetical sorting (case-insensitive)
  - Boolean sorting (false < true)
  - Nulls always sorted to the end
- [x] **Visual sort indicators**: ⇅ (hover), ▲ (ascending), ▼ (descending)
- [x] **Column resizing**: Drag right edge of column headers to adjust width
- [x] **Vertical column delimiters**: Clear borders between columns
- [x] **Hover tooltips**: Show full cell content on hover
- [x] **Double-click expansion**: Toggle text wrapping for long content
- [x] **Sticky headers**: Column headers remain visible when scrolling

#### Cross-Cell Linting (`src/linting/`)
- [x] **Virtual document generation**: Creates shadow .py files for pyright analysis
- [x] **Diagnostic mapping**: Converts line numbers from virtual docs to cells
- [x] **Databricks type stubs**: Provides type hints for spark, dbutils, display
- [x] **Notebook diagnostic provider**: Orchestrates linting across cells
- [x] **Configuration options**:
  - `databricks-notebook.linting.enabled`: Enable/disable linting
  - `databricks-notebook.linting.includeDatabricksTypes`: Include Databricks type stubs
  - `databricks-notebook.linting.debounceMs`: Debounce delay for updates

#### Kernel Improvements
- [x] **Display outputs**: Capture HTML outputs from `display()` function
- [x] **Execution time**: Track and report runtime for each cell
- [x] **Display namespace**: Add `display()` to persistent namespace
- [x] **SQL cell display**: SQL cells use `display()` instead of `.show()`

---

## Known Limitations

1. **Brief flash on auto-open**: The text editor briefly appears before being replaced. This is unavoidable because VS Code's `onDidOpenTextDocument` fires after the editor opens.

2. **Non-Python cells**: Scala and R cells show informational messages but require Databricks runtime for execution.

3. **No syntax validation**: The parser doesn't validate that the content within cells is valid code.

4. **Kernel restart required**: To clear variables, the kernel must be restarted.

5. **Matplotlib plots**: While DataFrames are richly rendered, matplotlib plots are not yet supported (output as text only).

---

## Future Enhancements

- [x] ~~Databricks Connect integration for cell execution~~ Python kernel execution implemented
- [x] ~~%sql magic execution via spark.sql()~~ SQL cells auto-wrap in spark.sql()
- [x] ~~Databricks Connect integration for Spark operations~~ Auto-initializes with serverless
- [x] ~~Git integration for better notebook diffs~~ Round-trip preservation minimizes diffs
- [x] ~~Scrollable output for large errors~~ Enabled via `notebook.output.scrolling` default
- [x] ~~Rich output support for DataFrames~~ Implemented with display() function
- [ ] Matplotlib plot rendering
- [ ] Cluster selection UI
- [ ] Cell folding
- [ ] Table of contents from markdown headers
- [ ] Export to Jupyter `.ipynb`
- [ ] Variable explorer panel

---

## Version History

### v0.3.1 (Current)
- **Extension Icon**: Added Databricks logo for VS Code marketplace
- **SQL Syntax Highlighting**: Added `highlight-string-code` extension dependency for SQL in Python strings
- **Bug Fixes**:
  - Magic-command cells (SQL, Scala, R, Shell) now convert back to Python when user removes the magic prefix
  - Fixed kernel startup race condition where ready signal could be missed
  - Fixed OAuth token auth being overridden by profile's `auth_type=databricks-cli`
  - Fixed Spark Connect DataFrame detection using duck typing instead of isinstance

### v0.3.0
- **Rich DataFrame Display**: Databricks-style `display()` function with minimal dark theme
  - HTML table rendering for Spark and Pandas DataFrames
  - Null value badges, execution time tracking, row count display
  - CSV download button (downloads displayed rows only)
- **Interactive Table Features**: Column sorting, resizing, tooltips, and delimiters
  - Intelligent data type detection for sorting (numbers, strings, booleans, nulls)
  - Visual sort indicators (⇅, ▲, ▼)
  - Drag to resize columns
- **Cross-Cell Linting**: Virtual document generation for pyright analysis across cells
  - Databricks type stubs for spark, dbutils, display
  - Configuration options for enabling/disabling linting

### v0.2.0
- **Multi-Profile Authentication Management**: Full UI for selecting and switching between Databricks profiles
  - ProfileManager class for reading and managing `~/.databrickscfg` profiles
  - Status bar indicator showing current profile (`$(cloud) profile-name`)
  - Quick Pick selector for profile switching with host information
  - File watcher for automatic profile list refresh
  - Auto-restart kernel when profile changes
- **Exact Token Matching**: Fixed token-to-host matching to prevent using wrong tokens for multiple profiles
  - Exact host URL matching with normalization (handles trailing slashes, case differences)
  - Removed fallback to first available token
  - Better error messages when token not found for host
- **Configuration Options**:
  - `databricks-notebook.defaultProfile`: Default profile to use on startup
  - `databricks-notebook.showProfileInStatusBar`: Show/hide profile in status bar
- **New Commands**:
  - `databricks-notebook.selectProfile`: Open profile selector
  - `databricks-notebook.refreshProfiles`: Manually refresh profile list

### v0.0.6
- **Unified Tab Experience for Notebook Button**: Clicking the notebook icon in editor title bar now replaces the text editor tab instead of opening a new tab
- Applied the same "close-then-open" pattern used in auto-open and notification flows
- Enhance the python kernel discovery

### v0.0.5
- **SQL Auto-Detection**: Python cells starting with SQL keywords automatically convert to SQL cells
- **SQL Cell Serialization Fix**: New SQL cells now correctly format with `# MAGIC %sql` on its own line
- **Language Inference**: New cells with SQL, Scala, R, or Shell language IDs correctly serialize
- **Edit Mode Preservation**: Cursor stays in cell after SQL auto-detection

### v0.0.4
- **Scrollable Output Fix**: Large outputs now properly scrollable
  - Sets `notebook.output.scrolling: true` by default via `configurationDefaults`
  - Works around VS Code bug where "View as scrollable element" link was non-functional
  - Outputs use `text/plain` MIME type for better compatibility
- **Git Diff Fix**: Prevent multiple tabs from opening when viewing git diffs
  - Skip auto-open for non-file URIs (git:, vscode-diff:, etc.)
  - Skip auto-open when document is part of a diff editor tab

### v0.0.3
- **Databricks Connect Integration**: Auto-initializes SparkSession on kernel start
  - Reads OAuth tokens from `~/.databricks/token-cache.json`
  - Supports `auth_type=databricks-cli` profiles
  - Uses serverless compute by default
- **SQL Cell Execution**: SQL cells automatically wrapped in `spark.sql()` for execution
- **Shell Cell Execution**: Shell cells wrapped in `subprocess.run()` for local execution
- **Round-trip Preservation**: Unchanged cells remain exactly as original (no git diff noise)
  - Original lines stored in cell metadata
  - Only modified cells are re-serialized
- **Parser Fixes**: Bare `# MAGIC` lines (no trailing space) render as blank lines correctly

### v0.0.2
- **Toggle View Feature**: Switch between notebook and raw text view with "View Source" command
- **Python Kernel Integration**: Execute Python cells with VS Code's kernel picker
- **Persistent Execution State**: Variables persist between cells like Jupyter
- **Python Extension Integration**: Discovers all Python environments automatically
- New commands: `Restart Kernel`, `Interrupt Kernel`
- Requires `ms-python.python` extension

### v0.0.1
- Initial implementation
- Full parser for Databricks .py format
- VS Code Notebook API integration
- Auto-open with seamless tab replacement
- GitHub Actions CI/CD
- 29 passing tests
