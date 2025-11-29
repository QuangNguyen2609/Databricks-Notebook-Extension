# Changelog

All notable changes to the Databricks Notebook Viewer extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
