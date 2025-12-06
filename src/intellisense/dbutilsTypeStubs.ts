/**
 * dbutils Type Stubs for Databricks
 *
 * Provides comprehensive type definitions for dbutils modules
 * to enable IntelliSense and linting support.
 *
 * These type stubs enable:
 * - Full IntelliSense for dbutils.fs, dbutils.notebook, dbutils.secrets, dbutils.widgets
 * - Proper linting support in Databricks notebooks
 * - Type safety for dbutils method calls
 */

export interface FileInfo {
  path: string;
  name: string;
  size: number;
  modificationTime: number;
  isDir: boolean;
  isFile: boolean;
}

export interface SecretMetadata {
  key: string;
}

export interface SecretScope {
  name: string;
}

export interface NotebookExitResult {
  value: string;
}

/**
 * Generate Python type stub content for dbutils
 *
 * Returns a string containing Python type annotations for the DBUtils class
 * and all its submodules (fs, notebook, secrets, widgets).
 *
 * This is used in the virtual document preamble to enable:
 * - Pylance/pyright type checking for dbutils methods
 * - IntelliSense completions for dbutils
 * - Linting without "undefined variable" errors
 *
 * @returns Python type stub string for dbutils
 */
export function generateDbutilsTypeStub(): string {
  return `
# dbutils type stubs for Databricks
from typing import Any, List, Optional, Dict

class FileInfo:
    path: str
    name: str
    size: int
    modificationTime: int
    isDir: bool
    isFile: bool

class SecretMetadata:
    key: str

class SecretScope:
    name: str

class FSUtils:
    def ls(self, path: str) -> List[FileInfo]: ...
    def cp(self, src: str, dst: str, recurse: bool = False) -> bool: ...
    def mv(self, src: str, dst: str, recurse: bool = False) -> bool: ...
    def rm(self, path: str, recurse: bool = False) -> bool: ...
    def mkdirs(self, path: str) -> bool: ...
    def head(self, path: str, maxBytes: int = 65536) -> str: ...
    def put(self, path: str, contents: str, overwrite: bool = False) -> bool: ...

class NotebookUtils:
    def run(self, path: str, timeout_seconds: int = 0, arguments: Dict[str, str] = None) -> str: ...
    def exit(self, value: str) -> None: ...

class SecretsUtils:
    def get(self, scope: str, key: str) -> str: ...
    def getBytes(self, scope: str, key: str) -> bytes: ...
    def list(self, scope: str) -> List[SecretMetadata]: ...
    def listScopes(self) -> List[SecretScope]: ...

class WidgetsUtils:
    def text(self, name: str, defaultValue: str = '', label: str = None) -> None: ...
    def dropdown(self, name: str, defaultValue: str = '', choices: List[str] = None, label: str = None) -> None: ...
    def multiselect(self, name: str, defaultValue: str = '', choices: List[str] = None, label: str = None) -> None: ...
    def combobox(self, name: str, defaultValue: str = '', choices: List[str] = None, label: str = None) -> None: ...
    def get(self, name: str) -> str: ...
    def getAll(self) -> Dict[str, str]: ...
    def remove(self, name: str) -> None: ...
    def removeAll(self) -> None: ...

class DBUtils:
    fs: FSUtils
    notebook: NotebookUtils
    secrets: SecretsUtils
    widgets: WidgetsUtils

dbutils: DBUtils
`;
}
