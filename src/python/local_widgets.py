"""
Local implementation of dbutils.widgets for VS Code.

Provides interactive widget support by communicating with VS Code
via bidirectional JSON protocol over stdin/stdout.

Widget values are cached after first user interaction - subsequent
get() calls return the cached value without prompting.
"""

import sys
import json
from typing import Any, Dict, List, Optional


class LocalWidgets:
    """
    Local implementation of dbutils.widgets that communicates with VS Code
    for interactive user input.

    When get() is called:
    1. If widget has cached value (user already interacted), return it
    2. Otherwise, send input_request to VS Code
    3. VS Code shows input prompt to user
    4. User input is sent back as input_response
    5. Value is cached and returned
    """

    def __init__(self, stdin=None, stdout=None):
        """
        Initialize LocalWidgets.

        Args:
            stdin: Input stream for receiving responses (default: sys.stdin)
            stdout: Output stream for sending requests (default: sys.stdout)
        """
        self._stdin = stdin or sys.stdin
        self._stdout = stdout or sys.stdout
        self._widgets: Dict[str, Dict[str, Any]] = {}
        self._values: Dict[str, str] = {}  # Cached widget values
        self._prompted: set = set()  # Track which widgets have been prompted
        self._request_counter = 0

    def _send_input_request(self, widget_name: str, widget_def: Dict[str, Any]) -> str:
        """
        Send input request to VS Code and wait for response.

        Args:
            widget_name: Name of the widget
            widget_def: Widget definition (type, default, choices, label)

        Returns:
            User-provided value or default if cancelled
        """
        self._request_counter += 1
        request_id = f"widget-{self._request_counter}"

        request = {
            'type': 'input_request',
            'id': request_id,
            'widget_name': widget_name,
            'widget_type': widget_def.get('type', 'text'),
            'default_value': widget_def.get('default', ''),
            'choices': widget_def.get('choices', []),
            'label': widget_def.get('label', widget_name),
        }

        # Send request to VS Code
        self._stdout.write(json.dumps(request) + '\n')
        self._stdout.flush()

        # Block waiting for response from VS Code
        while True:
            line = self._stdin.readline()
            if not line:
                # stdin closed, return default
                return widget_def.get('default', '')

            line = line.strip()
            if not line:
                continue

            try:
                response = json.loads(line)
                if response.get('type') == 'input_response' and response.get('id') == request_id:
                    if response.get('cancelled', False):
                        return widget_def.get('default', '')
                    return response.get('value', widget_def.get('default', ''))
            except json.JSONDecodeError:
                # Not a JSON response, might be other kernel communication
                # Continue waiting for our response
                continue

    def text(self, name: str, defaultValue: str = '', label: str = None) -> None:
        """
        Create a text input widget.

        Args:
            name: Widget name (used to retrieve value later)
            defaultValue: Default value if user doesn't provide input
            label: Label shown to user (defaults to name)
        """
        self._widgets[name] = {
            'type': 'text',
            'default': defaultValue,
            'label': label or name,
        }
        # Initialize with default if not already set
        if name not in self._values:
            self._values[name] = defaultValue

    def dropdown(self, name: str, defaultValue: str = '', choices: List[str] = None,
                 label: str = None) -> None:
        """
        Create a dropdown widget.

        Args:
            name: Widget name (used to retrieve value later)
            defaultValue: Default selected value
            choices: List of choices to display
            label: Label shown to user (defaults to name)
        """
        choices = choices or []
        self._widgets[name] = {
            'type': 'dropdown',
            'default': defaultValue,
            'choices': choices,
            'label': label or name,
        }
        if name not in self._values:
            self._values[name] = defaultValue

    def combobox(self, name: str, defaultValue: str = '', choices: List[str] = None,
                 label: str = None) -> None:
        """
        Create a combobox widget (dropdown with text input option).

        Args:
            name: Widget name (used to retrieve value later)
            defaultValue: Default value
            choices: List of suggested choices
            label: Label shown to user (defaults to name)
        """
        choices = choices or []
        self._widgets[name] = {
            'type': 'combobox',
            'default': defaultValue,
            'choices': choices,
            'label': label or name,
        }
        if name not in self._values:
            self._values[name] = defaultValue

    def multiselect(self, name: str, defaultValue: str = '', choices: List[str] = None,
                    label: str = None) -> None:
        """
        Create a multi-select widget.

        Args:
            name: Widget name (used to retrieve value later)
            defaultValue: Default value (comma-separated for multiple)
            choices: List of choices to display
            label: Label shown to user (defaults to name)
        """
        choices = choices or []
        self._widgets[name] = {
            'type': 'multiselect',
            'default': defaultValue,
            'choices': choices,
            'label': label or name,
        }
        if name not in self._values:
            self._values[name] = defaultValue

    def get(self, name: str) -> str:
        """
        Get the value of a widget.

        If the widget has been interacted with (prompted), returns cached value.
        Otherwise, prompts the user for input via VS Code UI.

        Args:
            name: Widget name

        Returns:
            Widget value (string)
        """
        # Check if we have a cached value from previous user interaction
        if name in self._prompted:
            return self._values.get(name, '')

        # Get widget definition (create implicit text widget if not defined)
        widget_def = self._widgets.get(name, {
            'type': 'text',
            'default': '',
            'label': name,
        })

        # Prompt user for value via VS Code
        value = self._send_input_request(name, widget_def)

        # Cache the value and mark as prompted
        self._values[name] = value
        self._prompted.add(name)

        return value

    def getAll(self) -> Dict[str, str]:
        """
        Get all widget values as a dictionary.

        Note: This returns only currently set values, does not prompt for values.

        Returns:
            Dictionary of widget name to value
        """
        return dict(self._values)

    def remove(self, name: str) -> None:
        """
        Remove a widget.

        Removes both the widget definition and its cached value.
        Next get() call will prompt again.

        Args:
            name: Widget name to remove
        """
        self._widgets.pop(name, None)
        self._values.pop(name, None)
        self._prompted.discard(name)

    def removeAll(self) -> None:
        """Remove all widgets and clear all cached values."""
        self._widgets.clear()
        self._values.clear()
        self._prompted.clear()

    def getArgument(self, name: str, defaultValue: str = '') -> str:
        """
        Get widget argument value (compatibility method).

        Deprecated in favor of get(), but provided for compatibility
        with older Databricks notebooks.

        Args:
            name: Widget name
            defaultValue: Default value if widget not defined

        Returns:
            Widget value
        """
        if name not in self._widgets:
            self.text(name, defaultValue)
        return self.get(name)
