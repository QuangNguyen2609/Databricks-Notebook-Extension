<p align="center">
  <img src="assets/banner.png" alt="Databricks" width="600">
</p>

A VS Code extension that transforms Databricks `.py` files into interactive notebooks with SQL execution, rich DataFrame display, and multi-profile authentication.

## Features

### Execute Code with Databricks Connect
- **Run Python & SQL cells** directly against your Databricks cluster
- **Serverless compute support** - no cluster management needed
- **Persistent kernel state** - variables persist across cell executions like Jupyter

### Rich DataFrame Display
- **Interactive tables** for Spark DataFrame results
- **Column sorting and resizing** for easy data exploration
- **Scrollable output** for large query results
- **Formatted display** - automatic `spark.sql()` wrapping for SQL cells

### Multi-Profile Authentication
- **Switch between Databricks profiles** with a single click
- **Status bar indicator** showing current active profile
- **Automatic kernel restart** on profile change
- **Workspace-level persistence** - remembers your selection per project

### SQL IntelliSense
- **Schema & table suggestions** - auto-complete catalog, schema, and table names
- **Column name completion** - type a table alias followed by `.` to get column suggestions (e.g., `a.` suggests columns from the aliased table)
- **Context-aware recommendations** - suggestions adapt based on your query context

### Full Notebook Experience
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
# Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate  # On macOS/Linux
# .venv\Scripts\activate   # On Windows

# Install the correct version
pip install "databricks-connect<=17.2"
```


## Usage

### Opening a Databricks Notebook

1. **Right-click menu**: Right-click on a `.py` file in the Explorer and select "Open as Databricks Notebook"

2. **Command Palette**: Open a `.py` file, then use `Ctrl+Shift+P` and type "Open as Databricks Notebook"

3. **Auto-detection**: When opening a file that starts with `# Databricks notebook source`, you'll be prompted to open it as a notebook

> **Recommended:** Enable automatic rendering in settings for the best experience. Turn on `databricks-notebook.autoOpenNotebooks` in VS Code Settings, or open it directly: `vscode-insiders://settings/databricks-notebook.autoOpenNotebooks`

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

> **Note:** Make sure a `databricks.yml` exists in your project (set up via the Databricks extension tab) that references the corresponding profile. If you want to use a different profile, you can switch it using the status bar or Command Palette but make sure to log into that profile using databricks auth login --profile profile_name to refresh the Access Token.

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

## License

MIT