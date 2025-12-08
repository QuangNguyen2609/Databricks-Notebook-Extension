"""
Path discovery utilities for local Python module imports.

This module provides functions to discover and configure Python import paths
for local modules in Databricks notebooks. It handles:
- Sibling .py files in the notebook directory
- Python packages (folders with __init__.py)
- Package roots for nested packages

Usage:
    from path_utils import setup_import_paths
    added_paths = setup_import_paths(notebook_path, workspace_root)
"""
import os
import sys
from typing import List, Set, Optional


def find_package_roots(start_dir: str, workspace_root: Optional[str] = None) -> Set[str]:
    """
    Find all package roots by traversing up from start_dir.

    A package root is the parent directory of the topmost directory with __init__.py.
    This allows imports like 'from mypackage.submodule import func' to work.

    Example:
        /project/
          mypackage/
            __init__.py
            submodule/
              __init__.py
              utils.py
          notebooks/
            analysis.py  <- start_dir

        Returns: {'/project'} so 'import mypackage.submodule' works.

    Args:
        start_dir: Starting directory (usually notebook's parent directory)
        workspace_root: Optional workspace root to stop traversal (prevents escaping)

    Returns:
        Set of paths that should be added to sys.path for package imports
    """
    package_roots: Set[str] = set()

    if not start_dir or not os.path.isdir(start_dir):
        return package_roots

    current = os.path.abspath(start_dir)

    # Normalize workspace root for comparison
    if workspace_root:
        workspace_root = os.path.abspath(workspace_root)

    # Walk up the directory tree
    while current and current != os.path.dirname(current):
        # Stop if we've reached or passed the workspace root
        if workspace_root and not current.startswith(workspace_root):
            break

        # Check if current directory is a package (has __init__.py)
        init_py = os.path.join(current, '__init__.py')
        if os.path.isfile(init_py):
            # This directory is a package - its parent should be in path
            parent = os.path.dirname(current)
            if parent and os.path.isdir(parent):
                # Don't add if parent is outside workspace
                if not workspace_root or parent.startswith(workspace_root) or parent == workspace_root:
                    package_roots.add(parent)

        # Check sibling directories for packages
        try:
            for item in os.listdir(current):
                item_path = os.path.join(current, item)
                if os.path.isdir(item_path):
                    item_init = os.path.join(item_path, '__init__.py')
                    if os.path.isfile(item_init):
                        # Found a sibling package, add current as package root
                        package_roots.add(current)
                        break
        except (PermissionError, OSError):
            # Skip directories we can't access
            pass

        current = os.path.dirname(current)

    return package_roots


def discover_import_paths(
    notebook_path: str,
    workspace_root: Optional[str] = None
) -> List[str]:
    """
    Discover all paths needed for local module imports.

    Args:
        notebook_path: Full path to the notebook file
        workspace_root: Optional workspace root for package discovery

    Returns:
        List of paths to add to sys.path (deduplicated, normalized, sorted)
    """
    paths: Set[str] = set()

    if not notebook_path:
        return []

    notebook_dir = os.path.dirname(os.path.abspath(notebook_path))

    # 1. Add notebook directory for sibling imports
    if os.path.isdir(notebook_dir):
        paths.add(notebook_dir)

    # 2. Add workspace root if provided and valid
    if workspace_root:
        workspace_root = os.path.abspath(workspace_root)
        if os.path.isdir(workspace_root):
            paths.add(workspace_root)

    # 3. Find package roots (directories containing packages)
    package_roots = find_package_roots(notebook_dir, workspace_root)
    paths.update(package_roots)

    # 4. Also check from workspace root for additional packages
    if workspace_root and workspace_root != notebook_dir:
        workspace_package_roots = find_package_roots(workspace_root, workspace_root)
        paths.update(workspace_package_roots)

    # Return as sorted list (normalized, deduplicated)
    return sorted(paths)


def setup_import_paths(
    notebook_path: str,
    workspace_root: Optional[str] = None
) -> List[str]:
    """
    Discover and add import paths to sys.path.

    This function is the main entry point called from kernel_runner.py.
    It discovers all relevant paths for local module imports and adds
    them to sys.path if not already present.

    Args:
        notebook_path: Full path to the notebook file
        workspace_root: Optional workspace root for package discovery

    Returns:
        List of paths that were actually added to sys.path
    """
    paths_to_add = discover_import_paths(notebook_path, workspace_root)
    added: List[str] = []

    for path in paths_to_add:
        # Normalize for comparison
        normalized_path = os.path.normpath(path)

        # Check if already in sys.path (compare normalized paths)
        already_present = any(
            os.path.normpath(p) == normalized_path
            for p in sys.path
            if p  # Skip empty strings
        )

        if not already_present:
            # Insert at beginning so local modules take precedence
            sys.path.insert(0, normalized_path)
            added.append(normalized_path)

    return added


def get_import_paths_info(notebook_path: str, workspace_root: Optional[str] = None) -> dict:
    """
    Get detailed information about discovered import paths.

    Useful for debugging and logging.

    Args:
        notebook_path: Full path to the notebook file
        workspace_root: Optional workspace root

    Returns:
        Dictionary with path information
    """
    notebook_dir = os.path.dirname(os.path.abspath(notebook_path)) if notebook_path else None
    discovered_paths = discover_import_paths(notebook_path, workspace_root)
    package_roots = find_package_roots(notebook_dir, workspace_root) if notebook_dir else set()

    return {
        'notebook_path': notebook_path,
        'notebook_dir': notebook_dir,
        'workspace_root': workspace_root,
        'discovered_paths': discovered_paths,
        'package_roots': list(package_roots),
        'current_sys_path': sys.path.copy(),
    }
