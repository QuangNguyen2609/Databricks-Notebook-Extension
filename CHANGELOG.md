# Changelog

All notable changes to the Databricks Notebook Studio extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.2] - 2026-01-22

### Added
- **DataFrame Search Functionality**: Added interactive search toolbar for DataFrames
  - Real-time text search across all cells in the table
  - Case-sensitive toggle button for precise searching
  - Search result counter showing current match and total matches (e.g., "1 of 5")
  - Navigation buttons (Previous/Next) to jump between search matches
  - Clear button to quickly reset search
  - Visual highlighting of all matching cells with distinct styling for current match
  - Search input with icon and placeholder text
  - Keyboard shortcuts: Enter/Shift+Enter for next/previous match
  - Applies to both Spark and Pandas DataFrames
  - Integrated seamlessly with existing DataFrame rendering toolbar

### Changed
- **DataFrame Display Limit Default**: Changed default from 1000 to 100 rows for better performance
  - Enhanced markdown description in VS Code settings UI for better discoverability
  - Added helpful tip in README explaining how to access the setting
  - Lower default improves rendering performance while remaining useful for most use cases
  - Users can easily adjust via VS Code settings UI (search "Databricks data display")

## [0.4.1] - 2026-01-20

### Added
- **Row Index Column in DataFrame Tables**: Added a leftmost column displaying sequential row numbers
  - Visual row numbering starting from 1, 2, 3...
  - Empty header cell with distinct styling (darker background, centered)
  - Fixed width (70px) with sticky positioning for horizontal scroll
  - Automatic re-numbering after sorting (indices reflect current visual order, not original data position)
  - Included in CSV exports with "Row" header
  - Index column excluded from sorting and resizing interactions
  - Applies to both Spark and Pandas DataFrames

## [0.4.0] - 2026-01-20

### Added
- **Configurable DataFrame Display Limit**: New setting to control maximum rows displayed for DataFrames
  - New configuration: `databricks-notebook.dataDisplayLimit` (default: 1000 rows)
  - Applies to both Spark and Pandas DataFrames
  - Configurable range: 1 to 100,000 rows
  - Default increased from hardcoded 100 to 1000 rows (10x improvement)
  - Configuration passed from TypeScript to Python via environment variable
  - Validation ensures values stay within safe memory limits

## [0.3.12] - 2025-01-20

### Fixed
- **Timestamp Timezone Preservation**: Fixed timestamps being converted to local timezone during DataFrame display
  - Root cause: Spark Connect's `collect()` converts timestamps to local system timezone, not session timezone
  - Solution: All timestamp/date columns are now converted to ISO-formatted strings server-side (in Spark) before collection
  - Timestamps now display exactly as stored in Databricks (e.g., UTC timestamps remain UTC, not converted to Adelaide/EST/etc.)
  - Prevents the issue where `2025-01-01T00:00:00+00:00` was incorrectly displayed as `2025-01-01T10:30:00+10:30`
  - Applies to all DataFrames with timestamp columns, not just extreme dates
  - Server-side string conversion using `date_format()` ensures consistent timezone representation

## [0.3.11] - 2025-01-19

### Fixed
- **Timestamp Overflow Error**: Fixed `[Errno 22] Invalid argument` when displaying DataFrames with extreme dates
  - Oracle-style "end of time" dates (e.g., `4712-12-31`) no longer crash DataFrame rendering
  - Added safe collection mechanism that detects timestamp overflow errors
  - Automatically casts timestamp/date columns to ISO-formatted strings when overflow is detected
  - Spark handles string formatting instead of Python datetime conversion for problematic dates
  - Added fallback protection in `safe_str()` for edge cases with extreme dates

## [0.3.10] - 2025-12-13

### Added
- **%pip Magic Command Support**: Jupyter-style package management in notebook cells
  - Full pip command execution (install, uninstall, list, show) with live output
  - Intelligent code wrapping using `sys.executable` for correct environment targeting
  - Focus loss prevention with cell tracking to avoid repeated auto-conversion
  - Packages install directly to current kernel's Python environment
  - Support for complex pip arguments (version specifiers, git URLs, extras, requirements files)

## [0.3.9] - 2025-12-13

### Fixed
- **Async Event Loop**: Fixed "Event loop is closed" error when running `await` statements in cells
  - SDK clients (Databricks SDK, OpenAI, etc.) now work correctly on first execution
  - Implemented persistent event loop that stays open across cell executions
  - Previously `asyncio.run()` was creating and closing a new loop for each cell
- **Kernel Startup Race Condition**: Added promise-based locking to prevent concurrent start() calls
  - Fixes race conditions when restart() and execute() call start() simultaneously
  - Prevents duplicate kernel initialization attempts
- **Windows CRLF Parsing**: Normalized line endings to handle Windows CRLF files correctly
  - Fixes bare `# MAGIC\r` lines being rendered as "MAGIC" headers in markdown cells
  - All line endings now normalized to `\n` before parsing

## [0.3.8] - 2025-12-09
### Added
- **Local Python Module Imports**: Enable importing local `.py` modules from the notebook directory and workspace
- **Pylance IntelliSense for Local Modules**: Automatic Pylance configuration for local imports
- **Top-Level Await**: Execute async code with `await` directly in notebook cells without wrapping in async functions
- **dbutils widget**: Local implementation for interactive input prompts
- **dotenv auto-load***: Automatically load dotenv file in notebook directory or workspace root
 
## [0.3.7] - 2025-12-06

### Added
- **Kernel Controls**: Restart and interrupt buttons in notebook toolbar with proper VS Code integration

- **spark/dbutils IntelliSense**: Comprehensive code completion for Databricks objects
  - **spark completions**: Live completions queried from kernel (sql, table, read, createDataFrame, etc.) with static fallback
  - **dbutils completions**: Full type stubs for all modules (fs, notebook, secrets, widgets) with method signatures
  - **DataFrame completions**: 45+ common DataFrame methods (select, filter, groupBy, join, show, collect, etc.)
  - Method documentation shows signatures on hover
  - Caching for performance with auto-clear on kernel restart

- **Linting Improvements**: Enhanced type stubs in virtual document preamble

## [0.3.6] - 2025-12-05

### Refactor
- **Centralized Constants**: Consolidated magic
commands, delimiters, and timing constants into
`src/constants/index.ts`
- **Extracted Utilities**: New reusable modules for
  tab management (`tabManager.ts`), cell editing
(`cellEditor.ts`, `cellOperations.ts`), and request
  caching (`requestCache.ts`)
- **Standardized Naming**: Consistent `_` prefix
for private fields, `is` prefix for boolean getters
- **Enhanced Test Suite**: Added unit tests for
kernelManager, persistentExecutor,
pythonKernelController, serializer, and constants


## [0.3.5] - 2025-12-05

### Fixed
- **Async/Await Optimizations**: Eliminated UI-blocking operations as well as API/IO function calls and improved reliability
- **SQL Auto-Detect Loop**: Fixed annoying issue where deleting `%sql` from a cell would cause it to immediately reappear when typing any character
- **Concurrent API/Function Calls**: Parallelized sequential operations for better performance with notebook operations
- **JSON serialization for display()**: Apply safe serialization with fallback for robust rendering and doesn't fail the process if one value is corrupted

## [0.3.4] - 2025-12-04

### Fixed
- **SQL IntelliSense Reliability**: Fixed critical issues causing IntelliSense to work inconsistently
  - **Executor Auto-Start**: Kernel executor now automatically starts when a kernel is selected, enabling IntelliSense to work immediately without requiring manual cell execution first
  - **Caching Bug Fix**: Failed metadata queries (when executor wasn't ready) are no longer cached, allowing automatic retry once the executor becomes available
  - Previously, if IntelliSense was triggered before the kernel was ready, empty results would be cached permanently until kernel restart

## [0.3.3] - 2025-12-03

### Added
- **Column Type Icons**: SVG icons displayed in DataFrame table headers indicating data types
  - Covers all Databricks SQL types: string, integer (bigint/int/smallint/tinyint), decimal/double/float, boolean, date/timestamp/timestamp_ntz/interval, binary, array, map, struct, variant, object, geography, geometry, void
  - Tooltip shows the specific type name on hover
  - Support for both Spark and Pandas DataFrames

### Fixed
- **OAuth Token Auto-Refresh**: Automatically refreshes expired OAuth tokens before they expire
  - Checks token expiry with 5-minute buffer to prevent mid-session failures
  - Updates token cache after successful refresh
  - Windows timezone fix for correct local time comparison
- **Configurable Kernel Startup Timeout**: New `kernelStartupTimeout` setting (default: 15000ms)
  - Databricks Connect initialization can take 15-25 seconds on first run
  - Prevents false timeout errors during initial Spark session creation
- **Magic Command Cursor Position**: After SQL/Scala/R/Shell auto-detection, cursor now correctly positions on a new line after the magic command for immediate editing

## [0.3.2] - 2025-12-02

### Fix
- Removed `iuyoy.highlight-string-code` from extension dependencies for cursor's compatibility

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
