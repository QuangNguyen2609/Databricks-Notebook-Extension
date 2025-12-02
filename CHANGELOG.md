# Changelog

All notable changes to the Databricks Notebook Viewer extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2025-12-02

### Added
- **Extension Icon**: Added Databricks logo icon for VS Code marketplace visibility
- **Highlight String Code Dependency**: Added `iuyoy.highlight-string-code` extension for SQL syntax highlighting in Python strings

### Fixed
- **Magic Command Cell Conversion**: Cells with magic commands (SQL, Scala, R, Shell) now correctly convert back to Python when user removes the magic prefix (e.g., deletes `%sql`)
- **Kernel Startup Race Condition**: Fixed race condition in Python kernel startup where ready signal could be missed
  - Pause stdout stream before readline setup to prevent data loss
  - Added `resolveOnce` wrapper to prevent multiple promise resolutions
  - Increased ready timeout from 10s to 30s for Databricks Connect initialization
- **OAuth Token Authentication**: Fixed issue where profile's `auth_type=databricks-cli` could override explicit token authentication
  - Clear `DATABRICKS_CONFIG_PROFILE` env var before token-based auth
  - Ensures OAuth tokens from cache are used correctly

## [0.3.0] - 2025-12-01

### Added
- **Rich DataFrame Display with Databricks Minimal Dark Theme**
  - `display()` function for rendering Spark and Pandas DataFrames as HTML tables
  - Databricks-inspired dark theme (#1e1e1e background, #252526 headers)
  - Null value badges with gray pill styling
  - Execution time tracking and display
  - Row count information: "Showing X of Y rows" when limited
  - CSV download button (downloads displayed rows only, not all data)

- **Interactive Table Features**
  - Column sorting with intelligent data type detection
    - Numeric sorting (handles scientific notation)
    - Alphabetical sorting (case-insensitive)
    - Boolean sorting (false < true)
    - Null values always sorted to the end
  - Visual sort indicators: ⇅ (hover), ▲ (ascending), ▼ (descending)
  - Column resizing: Drag right edge of column headers
  - Vertical column delimiters for better readability
  - Hover tooltips showing full cell content
  - Double-click cells to toggle text wrapping

- **SQL Cell Display Integration**
  - SQL cells now use `display()` instead of `.show()` for rich output
  - Automatic DataFrame visualization for SQL query results
  - Consistent styling across Python and SQL outputs

- **Cross-Cell Python Linting**
  - Virtual document generation for pyright analysis across notebook cells
  - Variables defined in previous cells are recognized in subsequent cells
  - Databricks type stubs for `spark`, `dbutils`, and `display` objects
  - Diagnostic mapping from virtual documents back to individual cells
  - Configuration options:
    - `databricks-notebook.linting.enabled`: Enable/disable linting (default: true)
    - `databricks-notebook.linting.includeDatabricksTypes`: Include Databricks type stubs (default: true)
    - `databricks-notebook.linting.debounceMs`: Debounce delay for updates (default: 500ms)

## [0.2.0] - 2025-12-01

### Added
- **Multi-Profile Authentication Management**
  - ProfileManager class for reading and managing `~/.databrickscfg` profiles
  - Status bar indicator showing current Databricks profile (`$(cloud) profile-name`)
  - Quick Pick selector for easy profile switching with host information displayed
  - File watcher for automatic profile list refresh when config changes
  - Auto-restart kernel when profile changes
  - Workspace-level profile persistence
  - New command: `databricks-notebook.selectProfile` - Open profile selector
  - New command: `databricks-notebook.refreshProfiles` - Manually refresh profile list

- **Configuration Options**
  - `databricks-notebook.defaultProfile` - Default profile to use on startup (leave empty to remember last selection)
  - `databricks-notebook.showProfileInStatusBar` - Show/hide profile in status bar (default: true)

### Fixed
- **Exact Token Matching** - Fixed critical issue where wrong OAuth tokens could be used with multiple profiles
  - Implemented exact host URL matching with normalization (handles trailing slashes, case differences)
  - Removed fallback to first available token that caused incorrect authentication
  - Better error messages when token not found for host
  - Prevents cross-workspace authentication issues

## [0.1.1] - 2025-12-01

### Added
- **GitHub Releases**: Automated VSIX uploads to GitHub Releases on version tags

### Fixed
- **%run command corruption**: Fixed bug where `%run` cells were corrupted to `un` when clearing outputs or changing cell language
  - `%r` was incorrectly matching `%run` due to prefix match
  - Now uses exact magic command matching (checks for whitespace/newline after command)
  - Sorted magic commands by length (longest first) for safer matching

### Improved
- **Databricks Connect Initialization**: Simplified and streamlined SparkSession initialization with clearer error messages
  - Better fallback flow: SPARK_REMOTE → profile + serverless → token cache
  - More helpful error message suggesting `databricks auth login` when authentication fails

## [0.1.0] - 2025-11-30

### Added
- **SQL Intellisense for Databricks Catalog**: Auto-complete suggestions for schemas, tables, and columns from Databricks Unity Catalog
  - Suggests schemas when typing `SELECT * FROM ` (uses default catalog)
  - Suggests tables when typing `SELECT * FROM schema.`
  - Suggests columns when typing `table.` in SELECT/WHERE clauses
  - Supports both 2-level (`schema.table`) and 3-level (`catalog.schema.table`) naming
  - Handles ambiguous references (e.g., `name.` could be catalog or schema)
  - Triggered on `.` character for seamless completion flow
- **Default Catalog Detection**: Automatically detects default catalog via `spark.catalog.currentCatalog()`
- **Lazy Loading**: Metadata fetched only on first use, cached until kernel restart (no repeated queries)
- **Manual Refresh Command**: `databricks-notebook.refreshCatalogCache` to clear catalog cache
- **27 new unit tests** for SQL context parser

## [0.0.6] - 2025-11-30

### Added
- **Unified Tab Experience for Notebook Button**: Clicking the notebook icon in editor title bar now replaces the text editor tab instead of opening a new tab
  - Applied the same "close-then-open" pattern used in auto-open and notification flows
  - Prevents duplicate tabs when opening notebooks from the editor title bar

### Improved
- **Python Kernel Discovery**: Enhanced Python environment discovery and refresh mechanism
  - Better detection of available Python interpreters
  - Improved kernel controller management

## [0.0.5] - 2025-11-29

### Added
- **SQL Auto-Detection**: Python cells starting with SQL keywords (SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, WITH, MERGE, TRUNCATE, EXPLAIN, DESCRIBE, SHOW, USE) automatically convert to SQL cells
- **Language Inference**: New cells with SQL, Scala, R, or Shell language IDs are now correctly serialized with appropriate magic commands

### Fixed
- **SQL Cell Serialization**: New SQL cells now correctly format with `# MAGIC %sql` on its own line, followed by SQL content on subsequent lines with `# MAGIC ` prefix
- **Edit Mode Preservation**: After SQL auto-detection triggers, the cursor stays in the cell so you can continue editing

## [0.0.4] - 2025-11-29

### Added
- **Scrollable Output**: Large outputs now properly scrollable via `notebook.output.scrolling: true` default

### Fixed
- **Git Diff Issue**: Prevent multiple tabs from opening when viewing git diffs
  - Skip auto-open for non-file URIs (git:, vscode-diff:, etc.)
  - Skip auto-open when document is part of a diff editor tab

## [0.0.3] - 2025-11-28

### Added
- **Databricks Connect Integration**: Auto-initializes SparkSession on kernel start
  - Reads OAuth tokens from `~/.databricks/token-cache.json`
  - Supports `auth_type=databricks-cli` profiles
  - Uses serverless compute by default
- **SQL Cell Execution**: SQL cells automatically wrapped in `spark.sql()` for execution
- **Shell Cell Execution**: Shell cells wrapped in `subprocess.run()` for local execution

### Fixed
- **Round-trip Preservation**: Unchanged cells remain exactly as original (no git diff noise)
  - Original lines stored in cell metadata
  - Only modified cells are re-serialized
- **Parser Fix**: Bare `# MAGIC` lines (no trailing space) render as blank lines correctly

## [0.0.2] - 2025-11-28

### Added
- **Toggle View Feature**: Switch between notebook and raw text view with "View Source" command
- **Python Kernel Integration**: Execute Python cells with VS Code's kernel picker
- **Persistent Execution State**: Variables persist between cells like Jupyter
- **Python Extension Integration**: Discovers all Python environments automatically
- New commands: `Restart Kernel`, `Interrupt Kernel`

### Changed
- Requires `ms-python.python` extension

## [0.0.1] - 2025-11-27

### Added
- Initial release
- Full parser for Databricks `.py` notebook format
- VS Code Notebook API integration
- Support for all magic commands: `%md`, `%sql`, `%python`, `%scala`, `%r`, `%sh`, `%fs`, `%run`, `%pip`
- Cell title support via `DBTITLE` metadata
- Auto-detection of Databricks notebooks
- Seamless tab replacement (close text editor, open notebook view)
- Configuration options:
  - `autoOpenNotebooks`: Auto-open detected notebooks
  - `showNotification`: Show prompt for detected notebooks
- GitHub Actions CI/CD pipeline
- 29 passing unit tests
