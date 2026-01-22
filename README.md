# Databricks Notebook Studio

<p align="center">
  <img src="assets/databricks-logo-icon.png" alt="Databricks Logo" width="128" height="128">
</p>

A VS Code extension that transforms Databricks `.py` files into interactive notebooks with SQL execution, rich DataFrame display, and multi-profile authentication.

## Features

### 🚀 Execute Code with Databricks Connect
- **Run Python & SQL cells** directly against your Databricks cluster
- **Serverless compute support** - no cluster management needed
- **Persistent kernel state** - variables persist across cell executions like Jupyter

### 📊 Rich DataFrame Display
- **Interactive tables** for Spark DataFrame results
- **Column sorting and resizing** for easy data exploration
- **Scrollable output** for large query results
- **Formatted display** - automatic `spark.sql()` wrapping for SQL cells

### 🔐 Multi-Profile Authentication
- **Switch between Databricks profiles** with a single click
- **Status bar indicator** showing current active profile
- **Automatic kernel restart** on profile change
- **Workspace-level persistence** - remembers your selection per project

### 📝 Full Notebook Experience
- **Visual cell separation** with proper boundaries
- **Rendered Markdown** with full formatting support
- **Syntax highlighting** for Python, SQL, Scala, R, and Shell
- **Magic command support** - `%md`, `%sql`, `%python`, `%pip`, `%sh`, `%run`
- **Cell titles** via `DBTITLE` metadata
- **Round-trip editing** - preserves Databricks format on save

## Supported Cell Types

| Cell Type | Magic Command | Description |
|-----------|--------------|-------------|
| Python | (default) | Default Python code cells |
| Markdown | `%md` | Rendered markdown content |
| SQL | `%sql` | SQL queries with syntax highlighting |
| Shell | `%sh` | Shell/bash commands |
| Run | `%run` | Execute other notebooks |
| Pip | `%pip` | Package installation |

## Installation

### Prerequisites

This extension requires the following VS Code extensions (you'll be prompted to install them):
- **[Python](https://marketplace.visualstudio.com/items?itemName=ms-python.python)** - For Python kernel execution
- **[Databricks](https://marketplace.visualstudio.com/items?itemName=databricks.databricks)** - For workspace configuration and authentication

**Important: Databricks Connect Version Requirement**

For serverless compute support, you must use **Databricks Connect version 17.2 or earlier**. Version 17.3+ does not support serverless compute.

```bash
# Install the correct version in your project's virtual environment
pip install "databricks-connect<=17.2"
```

### Download from GitHub Releases (Recommended)

1. Go to [Latest Release](https://github.com/QuangNguyen2609/Databricks-Notebook-Extension/releases/latest)
2. Download the `.vsix` file
3. In VS Code: `Ctrl+Shift+P` → "Extensions: Install from VSIX..."
4. Select the downloaded `.vsix` file
5. Install the required dependencies when prompted

### Build from Source

1. Clone the repository and build:
   ```bash
   bash build.sh
   ```

2. Install the generated `.vsix` file (see above)

### From Marketplace (Coming Soon)

Search for "Databricks Notebook Studio" in the VS Code Extensions Marketplace.

## Usage

### Opening a Databricks Notebook

1. **Right-click menu**: Right-click on a `.py` file in the Explorer and select "Open as Databricks Notebook"

2. **Command Palette**: Open a `.py` file, then use `Ctrl+Shift+P` and type "Open as Databricks Notebook"

3. **Auto-detection**: When opening a file that starts with `# Databricks notebook source`, you'll be prompted to open it as a notebook

### Managing Databricks Profiles

The extension supports managing multiple Databricks authentication profiles from your `~/.databrickscfg` file.

#### Profile Selection

1. **Status Bar**: Click the cloud icon in the status bar (bottom right) showing your current profile
2. **Command Palette**: Use `Ctrl+Shift+P` and type "Select Databricks Profile"
3. **Quick Pick**: Choose from the list of available profiles with host information

The status bar shows:
- `$(cloud) profile-name` - Profile is selected and active
- `$(cloud) No Profile` - No profile selected (yellow warning)
- `$(cloud) No Config` - No `~/.databrickscfg` file found (red error)

#### Profile Configuration

**Recommended: Use the Databricks Extension (Required Dependency)**

The easiest way to configure profiles is through the official [Databricks extension for VS Code](https://marketplace.visualstudio.com/items?itemName=databricks.databricks):

1. Install the Databricks extension (automatically prompted as a dependency)
2. Open Command Palette (`Ctrl+Shift+P`) → "Databricks: Configure workspace"
3. Follow the authentication flow to log in to your Databricks workspace

For detailed setup instructions, see the [Databricks Extension Quickstart Guide](https://github.com/databricks/databricks-vscode/blob/main/packages/databricks-vscode/DATABRICKS.quickstart.md).

The Databricks extension automatically:
- Creates and manages your `~/.databrickscfg` file with profile configurations
- Generates and refreshes OAuth tokens in `~/.databricks/token-cache.json`
- Enables seamless auto-sync between local files and Databricks workspace

This integration allows the Databricks Notebook Studio to automatically authenticate with your configured profiles without manual token management.

**Alternative: Databricks CLI**

You can also configure profiles using the Databricks CLI:

```bash
# Login to Databricks (creates/updates profile)
databricks auth login --host https://your-workspace.cloud.databricks.com

# Login with a specific profile name
databricks auth login --host https://prod.cloud.databricks.com --profile prod
```

Example `~/.databrickscfg`:
```ini
[DEFAULT]
host = https://dev.cloud.databricks.com
auth_type = databricks-cli

[prod]
host = https://prod.cloud.databricks.com
auth_type = databricks-cli
```

#### Profile Switching

When you switch profiles:
1. The extension updates the environment variable for the Python kernel
2. Any running kernels are automatically restarted with the new profile
3. Your selection is saved per workspace

### Configuration

Configure the extension in VS Code settings (`Cmd+,` or `Ctrl+,`):

| Setting | Default | Description |
|---------|---------|-------------|
| `databricks-notebook.autoOpenNotebooks` | `false` | Automatically open detected Databricks notebooks in notebook view |
| `databricks-notebook.showNotification` | `true` | Show notification prompt when a Databricks notebook is detected |
| `databricks-notebook.defaultProfile` | `""` | Default Databricks profile to use on startup (leave empty to remember last selection) |
| `databricks-notebook.showProfileInStatusBar` | `true` | Show the current Databricks profile in the status bar |
| `databricks-notebook.pythonExecutionTimeout` | `60000` | Timeout for Python cell execution in milliseconds |
| `databricks-notebook.dataDisplayLimit` | `100` | Maximum number of rows to display for DataFrames (Spark and Pandas). Range: 1-100,000 |

> 💡 **Tip:** You can change the data display limit directly in VS Code settings UI:
> - Press `Ctrl+,` (Windows/Linux) or `Cmd+,` (Mac)
> - Search for "Databricks data display"
> - Adjust the numeric value (1-100,000)

**Example settings.json:**
```json
{
  "databricks-notebook.autoOpenNotebooks": true,
  "databricks-notebook.showNotification": true,
  "databricks-notebook.defaultProfile": "prod",
  "databricks-notebook.showProfileInStatusBar": true,
  "databricks-notebook.dataDisplayLimit": 100
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
cd databricks-notebook-studio

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
