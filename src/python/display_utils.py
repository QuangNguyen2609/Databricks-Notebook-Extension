"""
Display utilities for rendering DataFrames and data structures as HTML.
Mimics Databricks display() functionality.
"""


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
    # Check if it's a Spark DataFrame
    try:
        from pyspark.sql import DataFrame as SparkDataFrame
        if isinstance(obj, SparkDataFrame):
            return spark_dataframe_to_html(obj)
    except ImportError:
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
        html += '<table class="dataframe-table">'

        # Header with sort indicators and resize handles
        html += '<thead><tr>'
        for i, col in enumerate(columns):
            html += f'<th data-col-index="{i}">'
            html += f'<span class="th-content">{col}</span>'
            html += '<span class="sort-indicator"></span>'
            html += '<span class="resize-handle"></span>'
            html += '</th>'
        html += '</tr></thead>'

        # Body
        html += '<tbody>'
        for row in rows:
            html += '<tr>'
            for col in columns:
                value = row[col]
                # Handle None/null values with badge styling
                if value is None:
                    html += '<td><span class="null-badge">null</span></td>'
                else:
                    display_value = str(value)
                    html += f'<td>{display_value}</td>'
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

        # Calculate runtime if not provided
        if execution_time is None:
            execution_time = time.time() - start_time

        # Build HTML manually for consistent styling
        html = _get_html_table_start()
        html += '<div class="dataframe-table-wrapper">'
        html += '<table class="dataframe-table">'

        # Header with sort indicators and resize handles
        html += '<thead><tr>'
        for i, col in enumerate(limited_df.columns):
            html += f'<th data-col-index="{i}">'
            html += f'<span class="th-content">{col}</span>'
            html += '<span class="sort-indicator"></span>'
            html += '<span class="resize-handle"></span>'
            html += '</th>'
        html += '</tr></thead>'

        # Body
        html += '<tbody>'
        for _, row in limited_df.iterrows():
            html += '<tr>'
            for val in row:
                if val is None or (isinstance(val, float) and val != val):  # Check for NaN
                    html += '<td><span class="null-badge">null</span></td>'
                else:
                    html += f'<td>{val}</td>'
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
            width: 100%;
            font-size: 13px;
            background-color: #1e1e1e;
        }
        .dataframe-table th {
            background-color: #252526;
            color: #cccccc;
            font-weight: 500;
            padding: 10px 16px;
            text-align: left;
            position: sticky;
            top: 0;
            z-index: 10;
            border-bottom: 1px solid #3a3a3a;
            border-right: 1px solid #3a3a3a;
            font-size: 12px;
            text-transform: none;
            min-width: 100px;
            overflow: hidden;
            white-space: nowrap;
            cursor: pointer;
            user-select: none;
            position: relative;
        }
        .dataframe-table th:hover {
            background-color: #2d2d2d;
        }
        .dataframe-table th:last-child {
            border-right: none;
        }
        .dataframe-table th .th-content {
            display: inline-block;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: calc(100% - 40px);
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
            padding: 8px 16px;
            color: #d4d4d4;
            background-color: #1e1e1e;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
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

            // Add tooltips and double-click expansion to all cells
            const cells = document.querySelectorAll('.dataframe-table td');
            cells.forEach(cell => {
                // Add tooltip with full content on hover
                cell.title = cell.textContent.trim();

                // Double-click to toggle text wrapping
                cell.addEventListener('dblclick', function() {
                    if (this.style.whiteSpace === 'normal') {
                        this.style.whiteSpace = 'nowrap';
                        this.style.maxWidth = '400px';
                    } else {
                        this.style.whiteSpace = 'normal';
                        this.style.maxWidth = 'none';
                    }
                });
            });

            // Setup column sorting and resizing
            const headers = table.querySelectorAll('thead th');
            const sortStates = new Map(); // Track sort state per column

            headers.forEach((header, index) => {
                sortStates.set(index, 'none');

                // Click on header (but not resize handle) to sort
                header.addEventListener('click', function(e) {
                    // Don't sort if clicking on resize handle
                    if (e.target.classList.contains('resize-handle')) {
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
