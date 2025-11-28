# Databricks Notebook Viewer

A VS Code extension that renders Databricks `.py` notebook files as proper notebooks with visual cell separation, rendered Markdown, and syntax-highlighted code cells.

## Features

- **Visual Cell Separation**: Clearly separated cells with proper boundaries
- **Rendered Markdown**: Markdown cells are rendered with full formatting support
- **Syntax Highlighting**: Support for Python, SQL, Scala, R, and shell code cells
- **Magic Command Interpretation**: Automatic detection of `%md`, `%sql`, `%python`, `%run`, `%sh`, `%fs`, `%pip` commands
- **Cell Titles**: Support for `DBTITLE` metadata
- **Round-trip Editing**: Edit and save notebooks while preserving Databricks format

## Supported Cell Types

| Cell Type | Magic Command | Description |
|-----------|--------------|-------------|
| Python | (default) | Default Python code cells |
| Markdown | `%md`, `%md-sandbox` | Rendered markdown content |
| SQL | `%sql` | SQL queries with syntax highlighting |
| Scala | `%scala` | Scala code cells |
| R | `%r` | R code cells |
| Shell | `%sh` | Shell/bash commands |
| Filesystem | `%fs` | Databricks filesystem commands |
| Run | `%run` | Execute other notebooks |
| Pip | `%pip` | Package installation |

## Installation

### From VSIX (Local Installation)

1. Build the extension:
   ```bash
   npm install
   npm run package
   ```

2. Install the VSIX:
   - Open VS Code
   - Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
   - Type "Extensions: Install from VSIX"
   - Select the generated `.vsix` file

### From Marketplace (Coming Soon)

Search for "Databricks Notebook Viewer" in the VS Code Extensions Marketplace.

## Usage

### Opening a Databricks Notebook

1. **Right-click menu**: Right-click on a `.py` file in the Explorer and select "Open as Databricks Notebook"

2. **Command Palette**: Open a `.py` file, then use `Ctrl+Shift+P` and type "Open as Databricks Notebook"

3. **Auto-detection**: When opening a file that starts with `# Databricks notebook source`, you'll be prompted to open it as a notebook

### Configuration

Configure the extension in VS Code settings (`Cmd+,` or `Ctrl+,`):

| Setting | Default | Description |
|---------|---------|-------------|
| `databricks-notebook.autoOpenNotebooks` | `false` | Automatically open detected Databricks notebooks in notebook view |
| `databricks-notebook.showNotification` | `true` | Show notification prompt when a Databricks notebook is detected |

**Example settings.json:**
```json
{
  "databricks-notebook.autoOpenNotebooks": true,
  "databricks-notebook.showNotification": true
}
```

**Recommended configurations:**

- **Manual mode** (default): `autoOpenNotebooks: false`, `showNotification: true`
  - You'll see a prompt asking if you want to open as notebook

- **Auto mode**: `autoOpenNotebooks: true`
  - Databricks `.py` files automatically open as notebooks

- **Silent mode**: `autoOpenNotebooks: false`, `showNotification: false`
  - No automatic behavior; use right-click or Command Palette to open as notebook

> **Note:** After changing these settings, you may need to reload VS Code (`Cmd+Shift+P` → "Developer: Reload Window") for the changes to take effect on already-opened files.

## Databricks .py Format

Databricks notebooks exported as `.py` files follow this format:

```python
# Databricks notebook source

print("Python cell")

# COMMAND ----------

# MAGIC %md
# MAGIC # Markdown Heading
# MAGIC Some markdown content

# COMMAND ----------

# MAGIC %sql
# MAGIC SELECT * FROM table
```

## Development

### Prerequisites

- Node.js 18+
- npm or yarn

### Setup

```bash
# Clone the repository
git clone <repository-url>
cd databricks-notebook-viewer

# Install dependencies
npm install

# Compile
npm run compile

# Watch mode (for development)
npm run watch
```

### Running the Extension

1. Open the project in VS Code
2. Press `F5` to start debugging
3. A new VS Code window (Extension Development Host) will open
4. Open a Databricks `.py` file to test

### Running Tests

```bash
npm run test:unit
```

### Building for Production

```bash
npm run package
```

This creates a production-ready build in the `dist/` folder.

## Architecture

```
src/
├── extension.ts     # Extension entry point
├── serializer.ts    # NotebookSerializer implementation
├── parser.ts        # Databricks .py file parser
├── controller.ts    # NotebookController (optional execution)
└── types.ts         # TypeScript interfaces
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm run test:unit`
5. Submit a pull request

## License

MIT

## Acknowledgments

- Inspired by Databricks' notebook format and VS Code's Notebook API
- Built with VS Code Extension API
