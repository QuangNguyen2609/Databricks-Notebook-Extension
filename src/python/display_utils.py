"""
Display utilities for rendering DataFrames and data structures as HTML.
Mimics Databricks display() functionality.
"""

# SVG icons for data types (inline, 14x14 viewBox)
# Covers all Databricks SQL types
TYPE_ICONS = {
    # String/Text
    'string': '''<svg viewBox="0 0 14 14" fill="currentColor"><text x="2" y="11" font-size="10" font-weight="600" font-family="monospace">A</text><text x="7" y="12" font-size="6" font-family="monospace">b</text></svg>''',

    # Integer types (BIGINT, INT, SMALLINT, TINYINT)
    'integer': '''<svg viewBox="0 0 14 14" fill="currentColor"><text x="1" y="11" font-size="9" font-weight="600" font-family="monospace">123</text></svg>''',

    # Floating point (DOUBLE, FLOAT, DECIMAL)
    'decimal': '''<svg viewBox="0 0 14 14" fill="currentColor"><text x="0" y="11" font-size="8" font-weight="600" font-family="monospace">1.2</text></svg>''',

    # Boolean
    'boolean': '''<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="10" height="10" rx="2"/><path d="M4 7l2 2 4-4"/></svg>''',

    # All time-related types use the same neutral calendar icon (no color)
    # Covers: DATE, TIMESTAMP, TIMESTAMP_NTZ, INTERVAL
    'calendar': '''<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="1" y="2" width="12" height="11" rx="1"/><path d="M1 5h12"/><path d="M4 1v2M10 1v2"/></svg>''',

    # Binary
    'binary': '''<svg viewBox="0 0 14 14" fill="currentColor"><text x="0" y="11" font-size="7" font-weight="600" font-family="monospace">0x</text></svg>''',

    # Array
    'array': '''<svg viewBox="0 0 14 14" fill="currentColor"><text x="1" y="11" font-size="11" font-weight="600" font-family="monospace">[]</text></svg>''',

    # Map
    'map': '''<svg viewBox="0 0 14 14" fill="currentColor"><text x="-1" y="11" font-size="8" font-weight="600" font-family="monospace">k:v</text></svg>''',

    # Struct
    'struct': '''<svg viewBox="0 0 14 14" fill="currentColor"><text x="1" y="11" font-size="11" font-weight="600" font-family="monospace">{}</text></svg>''',

    # Variant (semi-structured)
    'variant': '''<svg viewBox="0 0 14 14" fill="currentColor"><text x="1" y="11" font-size="9" font-weight="600" font-family="monospace">&lt;/&gt;</text></svg>''',

    # Object (structured variant)
    'object': '''<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2" y="2" width="10" height="10" rx="1"/><path d="M5 5h4M5 7h4M5 9h2"/></svg>''',

    # Void/Null
    'void': '''<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="5"/><path d="M3 11L11 3"/></svg>''',

    # Geography (globe)
    'geography': '''<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="7" cy="7" r="5.5"/><ellipse cx="7" cy="7" rx="2.5" ry="5.5"/><path d="M1.5 7h11"/></svg>''',

    # Geometry (shapes)
    'geometry': '''<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2"><polygon points="7,1 13,10 1,10"/><circle cx="10" cy="11" r="2"/></svg>''',

    # Unknown/fallback
    'unknown': '''<svg viewBox="0 0 14 14" fill="currentColor"><text x="4" y="11" font-size="11" font-weight="600" font-family="monospace">?</text></svg>'''
}


def get_spark_type_info(data_type):
    """Map Spark/Databricks data types to SVG icons and display names.

    Handles all Databricks SQL types:
    - Integer: BIGINT, INT, SMALLINT, TINYINT
    - Decimal: DECIMAL(p,s), DOUBLE, FLOAT
    - String: STRING
    - Binary: BINARY
    - Boolean: BOOLEAN
    - Date/Time: DATE, TIMESTAMP, TIMESTAMP_NTZ, INTERVAL
    - Complex: ARRAY, MAP, STRUCT, VARIANT, OBJECT
    - Spatial: GEOGRAPHY, GEOMETRY
    - Special: VOID
    """
    type_str = str(data_type).lower()

    # String
    if 'string' in type_str:
        return (TYPE_ICONS['string'], 'string')

    # Integer types (check specific names to avoid false matches)
    if any(t in type_str for t in ['bigint', 'int', 'smallint', 'tinyint', 'long', 'short', 'byte']):
        # Determine specific type name for tooltip
        if 'bigint' in type_str or 'long' in type_str:
            return (TYPE_ICONS['integer'], 'bigint')
        elif 'smallint' in type_str or 'short' in type_str:
            return (TYPE_ICONS['integer'], 'smallint')
        elif 'tinyint' in type_str or 'byte' in type_str:
            return (TYPE_ICONS['integer'], 'tinyint')
        else:
            return (TYPE_ICONS['integer'], 'int')

    # Decimal/Float types
    if 'decimal' in type_str:
        return (TYPE_ICONS['decimal'], 'decimal')
    if 'double' in type_str:
        return (TYPE_ICONS['decimal'], 'double')
    if 'float' in type_str:
        return (TYPE_ICONS['decimal'], 'float')

    # Boolean
    if 'boolean' in type_str or 'bool' in type_str:
        return (TYPE_ICONS['boolean'], 'boolean')

    # Date/Time types - all use the same calendar icon
    if 'timestamp_ntz' in type_str:
        return (TYPE_ICONS['calendar'], 'timestamp_ntz')
    if 'timestamp' in type_str:
        return (TYPE_ICONS['calendar'], 'timestamp')
    if 'date' in type_str:
        return (TYPE_ICONS['calendar'], 'date')
    if 'interval' in type_str:
        return (TYPE_ICONS['calendar'], 'interval')

    # Binary
    if 'binary' in type_str:
        return (TYPE_ICONS['binary'], 'binary')

    # Complex types
    if 'array' in type_str:
        return (TYPE_ICONS['array'], 'array')
    if 'map' in type_str:
        return (TYPE_ICONS['map'], 'map')
    if 'struct' in type_str:
        return (TYPE_ICONS['struct'], 'struct')
    if 'variant' in type_str:
        return (TYPE_ICONS['variant'], 'variant')
    if 'object' in type_str:
        return (TYPE_ICONS['object'], 'object')

    # Spatial types
    if 'geography' in type_str:
        return (TYPE_ICONS['geography'], 'geography')
    if 'geometry' in type_str:
        return (TYPE_ICONS['geometry'], 'geometry')

    # Void/Null
    if 'void' in type_str or 'null' in type_str:
        return (TYPE_ICONS['void'], 'void')

    # Unknown fallback
    return (TYPE_ICONS['unknown'], type_str)


def get_pandas_type_info(dtype):
    """Map Pandas dtypes to SVG icons and display names."""
    dtype_str = str(dtype).lower()

    if 'object' in dtype_str or 'string' in dtype_str:
        return (TYPE_ICONS['string'], 'string')
    elif 'int64' in dtype_str:
        return (TYPE_ICONS['integer'], 'bigint')
    elif 'int32' in dtype_str:
        return (TYPE_ICONS['integer'], 'int')
    elif 'int16' in dtype_str:
        return (TYPE_ICONS['integer'], 'smallint')
    elif 'int8' in dtype_str:
        return (TYPE_ICONS['integer'], 'tinyint')
    elif 'int' in dtype_str:
        return (TYPE_ICONS['integer'], 'int')
    elif 'float' in dtype_str:
        return (TYPE_ICONS['decimal'], 'double')
    elif 'bool' in dtype_str:
        return (TYPE_ICONS['boolean'], 'boolean')
    elif 'datetime' in dtype_str or 'timestamp' in dtype_str:
        return (TYPE_ICONS['calendar'], 'timestamp')
    elif 'timedelta' in dtype_str:
        return (TYPE_ICONS['calendar'], 'interval')
    elif 'category' in dtype_str:
        return (TYPE_ICONS['array'], 'category')
    else:
        return (TYPE_ICONS['unknown'], dtype_str)


def html_escape(text):
    """Escape HTML special characters."""
    return (str(text)
        .replace('&', '&amp;')
        .replace('<', '&lt;')
        .replace('>', '&gt;')
        .replace('"', '&quot;')
        .replace("'", '&#39;'))


def safe_str(value):
    """Safely convert any value to a clean string for display.

    Handles:
    - None values
    - Special float values (NaN, Infinity)
    - Control characters and null bytes
    - Invalid UTF-8 sequences
    - Very long strings
    """
    try:
        # Handle None
        if value is None:
            return None

        # Handle special float values
        if isinstance(value, float):
            if value != value:  # NaN check
                return 'NaN'
            if value == float('inf'):
                return 'Infinity'
            if value == float('-inf'):
                return '-Infinity'

        # Convert to string
        text = str(value)

        # Remove null bytes and control characters (except newline, tab)
        text = ''.join(c for c in text if c >= ' ' or c in '\n\t')

        # Limit length to prevent buffer overflow
        max_len = 10000
        if len(text) > max_len:
            text = text[:max_len] + '...'

        # Ensure valid UTF-8
        text = text.encode('utf-8', errors='replace').decode('utf-8')

        return text
    except Exception:
        return '<unable to display>'


def render_cell_value(value, is_string_type=False):
    """Render cell value with collapsible support for long strings.

    Collapsing is dynamic based on column width (handled by JS).
    String cells with length > 20 get the collapsible wrapper; JS determines visibility.
    """
    if value is None:
        return '<span class="null-badge">null</span>'

    # Use safe_str() to handle problematic values (control chars, invalid UTF-8, etc.)
    display_value = safe_str(value)
    if display_value is None:
        return '<span class="null-badge">null</span>'

    escaped_value = html_escape(display_value)

    # For string types, wrap in collapsible container (JS handles expand/collapse)
    if is_string_type and len(display_value) > 20:
        return f'''<div class="collapsible-cell collapsed" data-full-length="{len(display_value)}"><span class="collapse-toggle">›</span><span class="cell-content">{escaped_value}</span></div>'''

    return escaped_value


def display_to_html(*args, display_outputs):
    """
    Display function that mimics Databricks display().
    Converts DataFrames, tables, and other objects to HTML for rich visualization.

    Args:
        *args: Objects to display
        display_outputs: List to append HTML outputs to

    Supports:
    - Spark DataFrames
    - Pandas DataFrames
    - Lists, dicts (as JSON tables)
    - HTML strings
    """
    for obj in args:
        html_output = convert_to_html(obj)
        display_outputs.append(html_output)


def convert_to_html(obj):
    """Convert various data types to HTML representation."""
    # Check if it's a Spark DataFrame (works for both classic PySpark and Spark Connect)
    # Use duck typing: if it has schema/collect/count, treat it as a Spark DataFrame
    if hasattr(obj, 'schema') and hasattr(obj, 'collect') and hasattr(obj, 'count'):
        try:
            return spark_dataframe_to_html(obj)
        except Exception:
            pass

    # Check if it's a Pandas DataFrame
    try:
        import pandas as pd
        if isinstance(obj, pd.DataFrame):
            return pandas_dataframe_to_html(obj)
    except ImportError:
        pass

    # Check if it's a list or dict
    if isinstance(obj, (list, dict)):
        return data_to_html_table(obj)

    # Check if it's already HTML
    if isinstance(obj, str) and obj.strip().startswith('<'):
        return obj

    # Fallback: convert to string in a pre tag
    return f'<pre>{str(obj)}</pre>'


def spark_dataframe_to_html(df, limit=100, execution_time=None):
    """Convert Spark DataFrame to HTML table with Databricks-style minimal theme."""
    try:
        import time
        start_time = time.time()

        # Get schema
        schema = df.schema
        columns = [field.name for field in schema.fields]

        # Create type map for efficient lookup
        type_map = {field.name: str(field.dataType).lower() for field in schema.fields}

        # Collect data (limit rows for performance)
        rows = df.limit(limit).collect()
        row_count = df.count()

        # Calculate runtime if not provided
        if execution_time is None:
            execution_time = time.time() - start_time

        # Build HTML with CSS
        html = _get_html_table_start()

        # Add table wrapper
        html += '<div class="dataframe-table-wrapper">'
        html += f'<table class="dataframe-table" data-col-count="{len(columns)}">'

        # Header with type icons, sort indicators and resize handles
        html += '<thead><tr>'
        for i, field in enumerate(schema.fields):
            icon_svg, type_name = get_spark_type_info(field.dataType)
            html += f'<th data-col-index="{i}">'
            html += f'<span class="type-icon" data-type="{type_name}">{icon_svg}</span>'
            html += f'<span class="th-content">{field.name}</span>'
            html += '<span class="sort-indicator"></span>'
            html += '<span class="resize-handle"></span>'
            html += '</th>'
        html += '</tr></thead>'

        # Body
        html += '<tbody>'
        for row in rows:
            html += '<tr>'
            for col in columns:
                try:
                    value = row[col]
                    is_string = 'string' in type_map.get(col, '')
                    cell_html = render_cell_value(value, is_string)
                except Exception:
                    # Gracefully handle any cell access or rendering errors
                    cell_html = '<span class="null-badge">error</span>'
                html += f'<td>{cell_html}</td>'
            html += '</tr>'
        html += '</tbody>'

        html += '</table></div>'

        # Add footer with stats
        html += '<div class="dataframe-footer">'
        html += '<div class="dataframe-footer-left">'
        html += '<button class="dataframe-download-btn" onclick="downloadTable()" title="Download as CSV">↓</button>'

        # Show "Showing X of Y rows" if limited, otherwise just "X rows"
        displayed_count = len(rows)
        if displayed_count < row_count:
            html += f'<span class="dataframe-stats">Showing {displayed_count} of {row_count} rows | {execution_time:.2f}s runtime</span>'
        else:
            html += f'<span class="dataframe-stats">{row_count} rows | {execution_time:.2f}s runtime</span>'

        html += '</div>'
        html += '<div class="dataframe-footer-right">Refreshed now</div>'
        html += '</div>'

        html += '</div>'
        return html

    except Exception as e:
        return f'<pre>Error displaying DataFrame: {str(e)}</pre>'


def pandas_dataframe_to_html(df, limit=100, execution_time=None):
    """Convert Pandas DataFrame to HTML table with Databricks-style minimal theme."""
    try:
        import time
        start_time = time.time()

        limited_df = df.head(limit)
        row_count = len(df)
        columns = list(limited_df.columns)

        # Create type map for efficient lookup
        type_map = {col: str(limited_df[col].dtype).lower() for col in columns}

        # Calculate runtime if not provided
        if execution_time is None:
            execution_time = time.time() - start_time

        # Build HTML manually for consistent styling
        html = _get_html_table_start()
        html += '<div class="dataframe-table-wrapper">'
        html += f'<table class="dataframe-table" data-col-count="{len(columns)}">'

        # Header with type icons, sort indicators and resize handles
        html += '<thead><tr>'
        for i, col in enumerate(columns):
            icon_svg, type_name = get_pandas_type_info(limited_df[col].dtype)
            html += f'<th data-col-index="{i}">'
            html += f'<span class="type-icon" data-type="{type_name}">{icon_svg}</span>'
            html += f'<span class="th-content">{col}</span>'
            html += '<span class="sort-indicator"></span>'
            html += '<span class="resize-handle"></span>'
            html += '</th>'
        html += '</tr></thead>'

        # Body
        html += '<tbody>'
        for _, row in limited_df.iterrows():
            html += '<tr>'
            for col in columns:
                try:
                    val = row[col]
                    # Check for NaN
                    if val is None or (isinstance(val, float) and val != val):
                        html += '<td><span class="null-badge">null</span></td>'
                    else:
                        is_string = 'object' in type_map.get(col, '') or 'string' in type_map.get(col, '')
                        cell_html = render_cell_value(val, is_string)
                        html += f'<td>{cell_html}</td>'
                except Exception:
                    # Gracefully handle any cell access or rendering errors
                    html += '<td><span class="null-badge">error</span></td>'
            html += '</tr>'
        html += '</tbody>'

        html += '</table></div>'

        # Add footer with stats
        html += '<div class="dataframe-footer">'
        html += '<div class="dataframe-footer-left">'
        html += '<button class="dataframe-download-btn" onclick="downloadTable()" title="Download as CSV">↓</button>'

        # Show "Showing X of Y rows" if limited, otherwise just "X rows"
        displayed_count = len(limited_df)
        if displayed_count < row_count:
            html += f'<span class="dataframe-stats">Showing {displayed_count} of {row_count} rows | {execution_time:.2f}s runtime</span>'
        else:
            html += f'<span class="dataframe-stats">{row_count} rows | {execution_time:.2f}s runtime</span>'

        html += '</div>'
        html += '<div class="dataframe-footer-right">Refreshed now</div>'
        html += '</div>'

        html += '</div>'
        return html

    except Exception as e:
        return f'<pre>Error displaying DataFrame: {str(e)}</pre>'


def data_to_html_table(data):
    """Convert list or dict to HTML table."""
    try:
        html = _get_html_table_start(include_style=False)
        html += '<table class="dataframe-table">'

        if isinstance(data, dict):
            # Dict as key-value table
            html += '<thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>'
            for key, value in data.items():
                html += f'<tr><td>{key}</td><td>{value}</td></tr>'
        elif isinstance(data, list) and len(data) > 0:
            # List of dicts as table
            if isinstance(data[0], dict):
                keys = data[0].keys()
                html += '<thead><tr>'
                for key in keys:
                    html += f'<th>{key}</th>'
                html += '</tr></thead><tbody>'

                for item in data:
                    html += '<tr>'
                    for key in keys:
                        html += f'<td>{item.get(key, "")}</td>'
                    html += '</tr>'
            else:
                # Simple list
                html += '<thead><tr><th>Value</th></tr></thead><tbody>'
                for item in data:
                    html += f'<tr><td>{item}</td></tr>'

        html += '</tbody></table></div>'
        return html
    except Exception as e:
        return f'<pre>Error displaying data: {str(e)}</pre>'


def _get_html_table_start(include_style=True):
    """Get HTML table wrapper with Databricks-style minimal dark theme."""
    html = '<div class="databricks-display-container" style="font-family: monospace; font-size: 13px; border: 1px solid #3a3a3a; border-radius: 4px; overflow: hidden;">'

    if include_style:
        html += '<style>'
        html += '''
        .databricks-display-container {
            background-color: #1e1e1e;
            color: #d4d4d4;
        }
        .dataframe-table-wrapper {
            max-height: 400px;
            overflow: auto;
            background-color: #1e1e1e;
        }
        .dataframe-table {
            border-collapse: collapse;
            table-layout: fixed;
            width: 100%;
            font-size: 13px;
            background-color: #1e1e1e;
        }
        .dataframe-table th {
            background-color: #252526;
            color: #cccccc;
            font-weight: 500;
            padding: 10px 12px;
            text-align: left;
            position: sticky;
            top: 0;
            z-index: 10;
            border-bottom: 1px solid #3a3a3a;
            border-right: 1px solid #3a3a3a;
            font-size: 12px;
            text-transform: none;
            width: var(--col-width, 150px);
            min-width: 100px;
            max-width: var(--col-width, 150px);
            overflow: visible;
            white-space: nowrap;
            cursor: pointer;
            user-select: none;
        }
        .dataframe-table th:hover {
            background-color: #2d2d2d;
        }
        .dataframe-table th:last-child {
            border-right: none;
        }
        /* Type icon styling */
        .dataframe-table th .type-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 16px;
            height: 16px;
            margin-right: 6px;
            color: #808080;
            flex-shrink: 0;
            cursor: help;
            vertical-align: middle;
            position: relative;
        }
        .dataframe-table th .type-icon svg {
            width: 14px;
            height: 14px;
            pointer-events: none;
        }
        .dataframe-table th .type-icon:hover {
            color: #cccccc;
        }
        /* Custom tooltip for type icon - appears below */
        .dataframe-table th .type-icon::after {
            content: attr(data-type);
            position: absolute;
            top: 100%;
            left: 50%;
            transform: translateX(-50%);
            background-color: #3a3a3a;
            color: #e0e0e0;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 11px;
            white-space: nowrap;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.15s ease;
            z-index: 1000;
            pointer-events: none;
            margin-top: 4px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }
        .dataframe-table th .type-icon:hover::after {
            opacity: 1;
            visibility: visible;
        }
        .dataframe-table th .th-content {
            display: inline-block;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: calc(100% - 60px);
            vertical-align: middle;
        }
        .dataframe-table th .sort-indicator {
            display: inline-block;
            margin-left: 4px;
            font-size: 11px;
            color: #808080;
            width: 12px;
            text-align: center;
        }
        .dataframe-table th.sort-asc .sort-indicator::after {
            content: '▲';
            color: #cccccc;
        }
        .dataframe-table th.sort-desc .sort-indicator::after {
            content: '▼';
            color: #cccccc;
        }
        .dataframe-table th:hover .sort-indicator::after {
            content: '⇅';
            color: #cccccc;
        }
        .dataframe-table th.sort-asc:hover .sort-indicator::after,
        .dataframe-table th.sort-desc:hover .sort-indicator::after {
            content: '⇅';
        }
        .dataframe-table th .resize-handle {
            position: absolute;
            right: 0;
            top: 0;
            bottom: 0;
            width: 8px;
            cursor: col-resize;
            z-index: 20;
            background: transparent;
        }
        .dataframe-table th .resize-handle:hover {
            background: rgba(100, 150, 255, 0.3);
        }
        .dataframe-table td {
            border-bottom: 1px solid #2d2d2d;
            border-right: 1px solid #2d2d2d;
            padding: 8px 12px;
            color: #d4d4d4;
            background-color: #1e1e1e;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            text-align: left;
            width: var(--col-width, 150px);
            min-width: 100px;
            max-width: var(--col-width, 150px);
        }
        .dataframe-table td:last-child {
            border-right: none;
        }
        .dataframe-table tr:hover td {
            background-color: #2a2a2a;
        }
        .dataframe-table td .null-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
            background-color: #3a3a3a;
            color: #808080;
            font-size: 11px;
            font-weight: 500;
        }
        /* Collapsible cell styling */
        .collapsible-cell {
            display: flex;
            align-items: flex-start;
            text-align: left;
            width: 100%;
        }
        .collapsible-cell .collapse-toggle {
            display: none;
            align-items: center;
            justify-content: center;
            width: 14px;
            height: 14px;
            margin-right: 4px;
            cursor: pointer;
            color: #808080;
            font-size: 12px;
            flex-shrink: 0;
            transition: transform 0.15s ease;
            user-select: none;
        }
        .collapsible-cell.needs-collapse .collapse-toggle {
            display: inline-flex;
        }
        .collapsible-cell .collapse-toggle:hover {
            color: #cccccc;
        }
        .collapsible-cell .cell-content {
            flex: 1;
            min-width: 0;
        }
        .collapsible-cell.collapsed .cell-content {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .collapsible-cell.expanded .collapse-toggle {
            transform: rotate(90deg);
        }
        .collapsible-cell.expanded .cell-content {
            white-space: pre-wrap;
            word-break: break-word;
        }
        .dataframe-table td:has(.collapsible-cell.expanded) {
            white-space: normal;
            overflow: visible;
        }
        .dataframe-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 16px;
            background-color: #252526;
            border-top: 1px solid #3a3a3a;
            font-size: 12px;
            color: #cccccc;
        }
        .dataframe-footer-left {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .dataframe-footer-right {
            color: #808080;
            font-size: 11px;
        }
        .dataframe-download-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            background-color: #2d2d2d;
            border: 1px solid #3a3a3a;
            border-radius: 4px;
            cursor: pointer;
            transition: background-color 0.2s;
        }
        .dataframe-download-btn:hover {
            background-color: #3a3a3a;
        }
        .dataframe-stats {
            color: #cccccc;
        }
        '''
        html += '</style>'

        # Add download script and cell interaction
        html += '''
        <script>
        function downloadTable() {
            const table = document.querySelector('.dataframe-table');
            if (!table) return;

            let csv = [];

            // Get headers
            const headers = Array.from(table.querySelectorAll('thead th'))
                .map(th => th.textContent.trim());
            csv.push(headers.join(','));

            // Get data rows (only from tbody)
            const rows = table.querySelectorAll('tbody tr');
            rows.forEach(row => {
                const cells = Array.from(row.querySelectorAll('td')).map(td => {
                    // Handle null badges
                    const nullBadge = td.querySelector('.null-badge');
                    if (nullBadge) {
                        return '';
                    }
                    let text = td.textContent.trim();
                    // Escape quotes and wrap in quotes if contains comma
                    if (text.includes(',') || text.includes('"') || text.includes('\\n')) {
                        text = '"' + text.replace(/"/g, '""') + '"';
                    }
                    return text;
                });
                csv.push(cells.join(','));
            });

            // Create download
            const csvContent = csv.join('\\n');
            const blob = new Blob([csvContent], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'data.csv';
            a.click();
            window.URL.revokeObjectURL(url);
        }

        // Detect data type of a cell value
        function detectDataType(value) {
            // Check for null/empty
            if (!value || value === '' || value === 'null') {
                return { type: 'null', value: null };
            }

            // Check for boolean
            if (value.toLowerCase() === 'true' || value.toLowerCase() === 'false') {
                return { type: 'boolean', value: value.toLowerCase() === 'true' };
            }

            // Check for number (including scientific notation)
            const numValue = Number(value);
            if (!isNaN(numValue) && value.trim() !== '') {
                return { type: 'number', value: numValue };
            }

            // Default to string
            return { type: 'string', value: value };
        }

        // Compare two values based on their detected types
        function compareValues(a, b, ascending = true) {
            const aData = detectDataType(a);
            const bData = detectDataType(b);

            // Nulls always go to the end
            if (aData.type === 'null' && bData.type === 'null') return 0;
            if (aData.type === 'null') return 1;
            if (bData.type === 'null') return -1;

            // Compare booleans (false < true)
            if (aData.type === 'boolean' && bData.type === 'boolean') {
                const result = aData.value === bData.value ? 0 : (aData.value ? 1 : -1);
                return ascending ? result : -result;
            }

            // Compare numbers
            if (aData.type === 'number' && bData.type === 'number') {
                const result = aData.value - bData.value;
                return ascending ? result : -result;
            }

            // Compare strings (case-insensitive)
            const aStr = String(aData.value).toLowerCase();
            const bStr = String(bData.value).toLowerCase();
            const result = aStr.localeCompare(bStr);
            return ascending ? result : -result;
        }

        // Sort table by column
        function sortTable(table, columnIndex, ascending) {
            const tbody = table.querySelector('tbody');
            const rows = Array.from(tbody.querySelectorAll('tr'));

            rows.sort((rowA, rowB) => {
                const cellA = rowA.cells[columnIndex];
                const cellB = rowB.cells[columnIndex];

                // Get text content, handling null badges
                const aText = cellA.querySelector('.null-badge') ?
                    '' : cellA.textContent.trim();
                const bText = cellB.querySelector('.null-badge') ?
                    '' : cellB.textContent.trim();

                return compareValues(aText, bText, ascending);
            });

            // Re-append rows in sorted order
            rows.forEach(row => tbody.appendChild(row));
        }

        // Initialize table immediately
        (function() {
            const table = document.querySelector('.dataframe-table');
            if (!table) return;

            const wrapper = table.closest('.dataframe-table-wrapper');
            const headers = table.querySelectorAll('thead th');
            const colCount = headers.length;

            // Calculate equal width based on container (equal distribution)
            const containerWidth = wrapper ? wrapper.offsetWidth : 800;
            const colWidth = Math.max(120, Math.floor(containerWidth / colCount));

            // Set CSS variable for column width
            table.style.setProperty('--col-width', colWidth + 'px');

            // Detect which cells need collapse toggle based on actual rendered width
            function updateCollapsibleCells() {
                const collapsibleCells = table.querySelectorAll('.collapsible-cell');
                collapsibleCells.forEach(cell => {
                    const content = cell.querySelector('.cell-content');
                    const td = cell.closest('td');
                    if (!td || !content) return;
                    const availableWidth = td.offsetWidth - 30;

                    // Check if content overflows
                    if (content.scrollWidth > availableWidth) {
                        cell.classList.add('needs-collapse');
                    } else {
                        cell.classList.remove('needs-collapse');
                    }
                });
            }

            // Initial check after render
            setTimeout(updateCollapsibleCells, 50);

            // Setup collapsible toggle click handlers
            table.addEventListener('click', function(e) {
                const toggle = e.target.closest('.collapse-toggle');
                if (toggle) {
                    e.stopPropagation();
                    const cell = toggle.closest('.collapsible-cell');
                    if (cell) {
                        cell.classList.toggle('collapsed');
                        cell.classList.toggle('expanded');
                    }
                }
            });

            // Add tooltips to all cells
            const cells = document.querySelectorAll('.dataframe-table td');
            cells.forEach(cell => {
                // Add tooltip with full content on hover
                const content = cell.querySelector('.cell-content');
                cell.title = content ? content.textContent.trim() : cell.textContent.trim();
            });

            // Setup column sorting and resizing
            const sortStates = new Map(); // Track sort state per column

            headers.forEach((header, index) => {
                sortStates.set(index, 'none');

                // Click on header (but not resize handle or type icon) to sort
                header.addEventListener('click', function(e) {
                    // Don't sort if clicking on resize handle or type icon
                    if (e.target.classList.contains('resize-handle') ||
                        e.target.closest('.type-icon')) {
                        return;
                    }

                    // Update sort state
                    const currentState = sortStates.get(index);
                    const newState = (currentState === 'none' || currentState === 'desc') ? 'asc' : 'desc';
                    sortStates.set(index, newState);

                    // Sort the table
                    sortTable(table, index, newState === 'asc');

                    // Update header classes
                    headers.forEach((h, i) => {
                        h.classList.remove('sort-asc', 'sort-desc');
                        if (i !== index) {
                            sortStates.set(i, 'none');
                        }
                    });
                    this.classList.add('sort-' + newState);
                });

                // Setup column resizing
                const resizeHandle = header.querySelector('.resize-handle');
                if (resizeHandle) {
                    let startX, startWidth;

                    resizeHandle.addEventListener('mousedown', function(e) {
                        e.preventDefault();
                        e.stopPropagation(); // Prevent sorting when clicking resize handle

                        startX = e.pageX;
                        startWidth = header.offsetWidth;

                        const onMouseMove = function(e) {
                            const diff = e.pageX - startX;
                            const newWidth = Math.max(50, startWidth + diff);
                            header.style.width = newWidth + 'px';
                            header.style.minWidth = newWidth + 'px';
                            header.style.maxWidth = newWidth + 'px';

                            // Apply same width to all cells in this column
                            const tbody = table.querySelector('tbody');
                            const rows = tbody.querySelectorAll('tr');
                            rows.forEach(row => {
                                const cell = row.cells[index];
                                if (cell) {
                                    cell.style.width = newWidth + 'px';
                                    cell.style.minWidth = newWidth + 'px';
                                    cell.style.maxWidth = newWidth + 'px';
                                }
                            });
                        };

                        const onMouseUp = function() {
                            document.removeEventListener('mousemove', onMouseMove);
                            document.removeEventListener('mouseup', onMouseUp);
                            // Update collapsible cells after resize
                            updateCollapsibleCells();
                        };

                        document.addEventListener('mousemove', onMouseMove);
                        document.addEventListener('mouseup', onMouseUp);
                    });
                }
            });
        })();
        </script>
        '''

    return html
