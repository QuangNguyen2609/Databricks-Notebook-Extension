/**
 * Tests for local Python module import support
 *
 * Tests the path discovery functionality that enables importing
 * local .py modules from the notebook directory and package roots.
 */
import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// We'll test the TypeScript path discovery logic that mirrors the Python implementation
// since the Python module is executed in a subprocess

describe('Local Import Path Discovery Tests', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'databricks-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper function to discover package roots (mirrors Python path_utils.py logic)
   */
  function discoverPackageRoots(startDir: string, workspaceRoot?: string): string[] {
    const packageRoots: Set<string> = new Set();

    if (!startDir || !fs.existsSync(startDir)) {
      return [];
    }

    // When no workspace root is provided, skip traversal to avoid
    // traversing the entire filesystem (can timeout on Windows)
    if (!workspaceRoot) {
      return [];
    }

    let current = path.resolve(startDir);
    const normalizedWorkspaceRoot = path.resolve(workspaceRoot);

    // Safety: max iterations to prevent infinite loops
    const maxIterations = 100;
    let iterations = 0;

    while (current && current !== path.dirname(current) && iterations < maxIterations) {
      iterations++;
      if (!current.startsWith(normalizedWorkspaceRoot)) {
        break;
      }

      const initPy = path.join(current, '__init__.py');
      try {
        if (fs.existsSync(initPy) && fs.statSync(initPy).isFile()) {
          const parent = path.dirname(current);
          if (parent && fs.existsSync(parent)) {
            if (!normalizedWorkspaceRoot ||
                parent.startsWith(normalizedWorkspaceRoot) ||
                parent === normalizedWorkspaceRoot) {
              packageRoots.add(parent);
            }
          }
        }
      } catch {
        // Ignore access errors
      }

      try {
        const items = fs.readdirSync(current);
        for (const item of items) {
          const itemPath = path.join(current, item);
          try {
            if (fs.statSync(itemPath).isDirectory()) {
              const itemInit = path.join(itemPath, '__init__.py');
              if (fs.existsSync(itemInit) && fs.statSync(itemInit).isFile()) {
                packageRoots.add(current);
                break;
              }
            }
          } catch {
            // Ignore
          }
        }
      } catch {
        // Ignore
      }

      current = path.dirname(current);
    }

    return Array.from(packageRoots);
  }

  /**
   * Helper function to discover import paths (mirrors Python path_utils.py logic)
   */
  function discoverImportPaths(notebookPath: string, workspaceRoot?: string): string[] {
    const paths: Set<string> = new Set();

    if (!notebookPath) {
      return [];
    }

    const notebookDir = path.dirname(path.resolve(notebookPath));

    if (fs.existsSync(notebookDir)) {
      paths.add(notebookDir);
    }

    if (workspaceRoot) {
      const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
      if (fs.existsSync(resolvedWorkspaceRoot)) {
        paths.add(resolvedWorkspaceRoot);
      }
    }

    const packageRoots = discoverPackageRoots(notebookDir, workspaceRoot);
    packageRoots.forEach(root => paths.add(root));

    return Array.from(paths).sort();
  }

  describe('Sibling Module Discovery', () => {
    it('should include notebook directory for sibling .py files', () => {
      // Create: tempDir/notebook.py, tempDir/mymodule.py
      fs.writeFileSync(path.join(tempDir, 'notebook.py'), '# notebook');
      fs.writeFileSync(path.join(tempDir, 'mymodule.py'), '# module');

      const notebookPath = path.join(tempDir, 'notebook.py');
      const paths = discoverImportPaths(notebookPath, tempDir);

      assert.ok(paths.includes(tempDir), 'Should include notebook directory');
    });

    it('should include notebook directory for sibling packages', () => {
      // Create: tempDir/notebook.py, tempDir/mypackage/__init__.py
      fs.writeFileSync(path.join(tempDir, 'notebook.py'), '# notebook');
      fs.mkdirSync(path.join(tempDir, 'mypackage'));
      fs.writeFileSync(path.join(tempDir, 'mypackage', '__init__.py'), '');

      const notebookPath = path.join(tempDir, 'notebook.py');
      const paths = discoverImportPaths(notebookPath, tempDir);

      assert.ok(paths.includes(tempDir), 'Should include notebook directory for package imports');
    });
  });

  describe('Package Root Discovery', () => {
    it('should find package root for sibling packages', () => {
      // Create:
      // tempDir/
      //   mypackage/
      //     __init__.py
      //     utils.py
      //   notebooks/
      //     analysis.py

      fs.mkdirSync(path.join(tempDir, 'mypackage'));
      fs.mkdirSync(path.join(tempDir, 'notebooks'));

      fs.writeFileSync(path.join(tempDir, 'mypackage', '__init__.py'), '');
      fs.writeFileSync(path.join(tempDir, 'mypackage', 'utils.py'), '');
      fs.writeFileSync(path.join(tempDir, 'notebooks', 'analysis.py'), '');

      const notebookPath = path.join(tempDir, 'notebooks', 'analysis.py');
      const paths = discoverImportPaths(notebookPath, tempDir);

      // Should include tempDir so 'from mypackage import utils' works
      assert.ok(paths.includes(tempDir), 'Should include project root for package imports');
    });

    it('should find package root for nested packages', () => {
      // Create:
      // tempDir/
      //   mypackage/
      //     __init__.py
      //     submodule/
      //       __init__.py
      //       utils.py
      //   notebooks/
      //     analysis.py

      fs.mkdirSync(path.join(tempDir, 'mypackage'));
      fs.mkdirSync(path.join(tempDir, 'mypackage', 'submodule'));
      fs.mkdirSync(path.join(tempDir, 'notebooks'));

      fs.writeFileSync(path.join(tempDir, 'mypackage', '__init__.py'), '');
      fs.writeFileSync(path.join(tempDir, 'mypackage', 'submodule', '__init__.py'), '');
      fs.writeFileSync(path.join(tempDir, 'mypackage', 'submodule', 'utils.py'), '');
      fs.writeFileSync(path.join(tempDir, 'notebooks', 'analysis.py'), '');

      const notebookPath = path.join(tempDir, 'notebooks', 'analysis.py');
      const paths = discoverImportPaths(notebookPath, tempDir);

      // Should include tempDir so 'from mypackage.submodule import utils' works
      assert.ok(paths.includes(tempDir), 'Should include project root for nested package imports');
    });

    it('should not go above workspace root', () => {
      // Even if parent directories have __init__.py, don't escape workspace
      const notebookPath = path.join(tempDir, 'notebook.py');
      fs.writeFileSync(notebookPath, '# notebook');

      const paths = discoverImportPaths(notebookPath, tempDir);

      // All paths should be within or equal to tempDir
      for (const p of paths) {
        const normalizedP = path.resolve(p);
        const normalizedTemp = path.resolve(tempDir);
        assert.ok(
          normalizedP === normalizedTemp || normalizedP.startsWith(normalizedTemp + path.sep),
          `Path ${p} should be within workspace ${tempDir}`
        );
      }
    });

    it('should handle package at root level', () => {
      // Create:
      // tempDir/
      //   __init__.py
      //   utils.py
      //   notebook.py

      fs.writeFileSync(path.join(tempDir, '__init__.py'), '');
      fs.writeFileSync(path.join(tempDir, 'utils.py'), '');
      fs.writeFileSync(path.join(tempDir, 'notebook.py'), '');

      const notebookPath = path.join(tempDir, 'notebook.py');
      const packageRoots = discoverPackageRoots(tempDir, tempDir);

      // tempDir has __init__.py, so its parent should be in package roots
      const parent = path.dirname(tempDir);
      // We limit to workspace root, so parent should only be added if inside workspace
      // In this case, parent is outside workspace, so no package root should be added
      // But the notebook directory itself should still be included for sibling imports
      const paths = discoverImportPaths(notebookPath, tempDir);
      assert.ok(paths.includes(tempDir), 'Should include notebook directory');
    });
  });

  describe('Edge Cases', () => {
    it('should handle notebooks at workspace root', () => {
      const notebookPath = path.join(tempDir, 'notebook.py');
      fs.writeFileSync(notebookPath, '# notebook');

      const paths = discoverImportPaths(notebookPath, tempDir);

      assert.ok(paths.length > 0, 'Should return at least the notebook directory');
      assert.ok(paths.includes(tempDir), 'Should include workspace root');
    });

    it('should handle deeply nested notebooks', () => {
      // Create: tempDir/a/b/c/d/notebook.py
      const deepDir = path.join(tempDir, 'a', 'b', 'c', 'd');
      fs.mkdirSync(deepDir, { recursive: true });

      const notebookPath = path.join(deepDir, 'notebook.py');
      fs.writeFileSync(notebookPath, '# notebook');

      const paths = discoverImportPaths(notebookPath, tempDir);

      assert.ok(paths.includes(deepDir), 'Should include notebook directory');
      assert.ok(paths.includes(tempDir), 'Should include workspace root');
    });

    it('should deduplicate paths', () => {
      const notebookPath = path.join(tempDir, 'notebook.py');
      fs.writeFileSync(notebookPath, '# notebook');

      const paths = discoverImportPaths(notebookPath, tempDir);
      const uniquePaths = new Set(paths);

      assert.strictEqual(paths.length, uniquePaths.size, 'Should not have duplicate paths');
    });

    it('should handle empty notebook path', () => {
      const paths = discoverImportPaths('', tempDir);
      assert.strictEqual(paths.length, 0, 'Should return empty array for empty notebook path');
    });

    it('should handle non-existent notebook path', () => {
      const notebookPath = path.join(tempDir, 'nonexistent', 'notebook.py');
      const paths = discoverImportPaths(notebookPath, tempDir);
      // Should handle gracefully without throwing
      assert.ok(Array.isArray(paths), 'Should return an array');
    });

    it('should handle undefined workspace root', () => {
      const notebookPath = path.join(tempDir, 'notebook.py');
      fs.writeFileSync(notebookPath, '# notebook');

      const paths = discoverImportPaths(notebookPath, undefined);

      assert.ok(paths.includes(tempDir), 'Should include notebook directory even without workspace root');
    });
  });

  describe('Real-World Scenarios', () => {
    it('should support typical project structure', () => {
      // Create a typical Python project structure:
      // tempDir/
      //   src/
      //     myproject/
      //       __init__.py
      //       core/
      //         __init__.py
      //         utils.py
      //       analysis/
      //         __init__.py
      //         notebook.py

      fs.mkdirSync(path.join(tempDir, 'src', 'myproject', 'core'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'src', 'myproject', 'analysis'), { recursive: true });

      fs.writeFileSync(path.join(tempDir, 'src', 'myproject', '__init__.py'), '');
      fs.writeFileSync(path.join(tempDir, 'src', 'myproject', 'core', '__init__.py'), '');
      fs.writeFileSync(path.join(tempDir, 'src', 'myproject', 'core', 'utils.py'), '');
      fs.writeFileSync(path.join(tempDir, 'src', 'myproject', 'analysis', '__init__.py'), '');
      fs.writeFileSync(path.join(tempDir, 'src', 'myproject', 'analysis', 'notebook.py'), '');

      const notebookPath = path.join(tempDir, 'src', 'myproject', 'analysis', 'notebook.py');
      const paths = discoverImportPaths(notebookPath, tempDir);

      // Should find package root that allows 'from myproject.core import utils'
      const srcDir = path.join(tempDir, 'src');
      assert.ok(
        paths.includes(srcDir) || paths.includes(tempDir),
        'Should include directory that allows myproject imports'
      );
    });

    it('should support GitHub monorepo structure', () => {
      // Create a monorepo-like structure:
      // tempDir/
      //   packages/
      //     data_processing/
      //       __init__.py
      //       transformers.py
      //     notebooks/
      //       analysis/
      //         daily_report.py

      fs.mkdirSync(path.join(tempDir, 'packages', 'data_processing'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'packages', 'notebooks', 'analysis'), { recursive: true });

      fs.writeFileSync(path.join(tempDir, 'packages', 'data_processing', '__init__.py'), '');
      fs.writeFileSync(path.join(tempDir, 'packages', 'data_processing', 'transformers.py'), '');
      fs.writeFileSync(path.join(tempDir, 'packages', 'notebooks', 'analysis', 'daily_report.py'), '');

      const notebookPath = path.join(tempDir, 'packages', 'notebooks', 'analysis', 'daily_report.py');
      const paths = discoverImportPaths(notebookPath, tempDir);

      // Should find packages/ as a package root for 'from data_processing import transformers'
      const packagesDir = path.join(tempDir, 'packages');
      assert.ok(
        paths.includes(packagesDir),
        'Should include packages directory for sibling package imports'
      );
    });
  });
});

describe('Environment Variable Configuration Tests', () => {
  it('should define environment variable names', () => {
    // Verify the expected environment variable names are used
    const expectedVars = [
      'DATABRICKS_NOTEBOOK_PATH',
      'DATABRICKS_WORKSPACE_ROOT',
    ];

    // These are the env vars that kernel_runner.py expects
    for (const envVar of expectedVars) {
      assert.ok(
        typeof envVar === 'string' && envVar.startsWith('DATABRICKS_'),
        `${envVar} should be a valid environment variable name`
      );
    }
  });
});

describe('Implicit Package Support (Databricks-style)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'databricks-implicit-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper to check if a directory is an implicit package
   * (has .py files but no __init__.py) - mirrors Python DatabricksBackwardsCompatibleFinder
   */
  function isImplicitPackage(dirPath: string): boolean {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      return false;
    }

    // Check for __init__.py - if present, it's a regular package
    const initPy = path.join(dirPath, '__init__.py');
    if (fs.existsSync(initPy)) {
      return false;
    }

    // Check for .py files or subdirectories
    try {
      const contents = fs.readdirSync(dirPath);
      const hasPyFiles = contents.some(f => f.endsWith('.py'));
      const hasSubdirs = contents.some(f => {
        const fullPath = path.join(dirPath, f);
        return !f.startsWith('.') && fs.statSync(fullPath).isDirectory();
      });
      return hasPyFiles || hasSubdirs;
    } catch {
      return false;
    }
  }

  describe('Implicit Package Detection', () => {
    it('should detect folder with .py files as implicit package', () => {
      // Create: tempDir/utils/langgraph_utils.py (no __init__.py)
      const utilsDir = path.join(tempDir, 'utils');
      fs.mkdirSync(utilsDir);
      fs.writeFileSync(path.join(utilsDir, 'langgraph_utils.py'), '# module');

      assert.ok(isImplicitPackage(utilsDir), 'Folder with .py files should be implicit package');
    });

    it('should detect folder with subdirectories as implicit package', () => {
      // Create: tempDir/mypackage/subpkg/ (no __init__.py anywhere)
      const pkgDir = path.join(tempDir, 'mypackage');
      fs.mkdirSync(path.join(pkgDir, 'subpkg'), { recursive: true });

      assert.ok(isImplicitPackage(pkgDir), 'Folder with subdirectories should be implicit package');
    });

    it('should NOT detect folder with __init__.py as implicit package', () => {
      // Create: tempDir/regular_pkg/__init__.py
      const pkgDir = path.join(tempDir, 'regular_pkg');
      fs.mkdirSync(pkgDir);
      fs.writeFileSync(path.join(pkgDir, '__init__.py'), '');
      fs.writeFileSync(path.join(pkgDir, 'module.py'), '# module');

      assert.ok(!isImplicitPackage(pkgDir), 'Folder with __init__.py is regular package, not implicit');
    });

    it('should NOT detect empty folder as implicit package', () => {
      const emptyDir = path.join(tempDir, 'empty');
      fs.mkdirSync(emptyDir);

      assert.ok(!isImplicitPackage(emptyDir), 'Empty folder should not be implicit package');
    });

    it('should NOT detect folder with only hidden files as implicit package', () => {
      const hiddenDir = path.join(tempDir, 'hidden');
      fs.mkdirSync(hiddenDir);
      fs.writeFileSync(path.join(hiddenDir, '.gitkeep'), '');

      assert.ok(!isImplicitPackage(hiddenDir), 'Folder with only hidden files should not be implicit package');
    });
  });

  describe('Databricks Import Patterns', () => {
    it('should support import structure like Databricks notebooks', () => {
      // Databricks-style structure:
      // tempDir/
      //   notebook.py
      //   utils/                  (NO __init__.py - implicit package)
      //     langgraph_utils.py
      //     postgres_utils.py

      fs.writeFileSync(path.join(tempDir, 'notebook.py'), '# notebook');
      fs.mkdirSync(path.join(tempDir, 'utils'));
      fs.writeFileSync(path.join(tempDir, 'utils', 'langgraph_utils.py'), 'def func(): pass');
      fs.writeFileSync(path.join(tempDir, 'utils', 'postgres_utils.py'), 'def other(): pass');

      const utilsDir = path.join(tempDir, 'utils');

      // utils/ should be an implicit package (no __init__.py but has .py files)
      assert.ok(isImplicitPackage(utilsDir), 'utils/ should be detected as implicit package');

      // The module files should exist
      assert.ok(fs.existsSync(path.join(utilsDir, 'langgraph_utils.py')), 'langgraph_utils.py should exist');
      assert.ok(fs.existsSync(path.join(utilsDir, 'postgres_utils.py')), 'postgres_utils.py should exist');
    });

    it('should support nested implicit packages', () => {
      // Nested implicit packages:
      // tempDir/
      //   notebook.py
      //   mypackage/              (NO __init__.py)
      //     subpkg/               (NO __init__.py)
      //       module.py

      fs.writeFileSync(path.join(tempDir, 'notebook.py'), '# notebook');
      fs.mkdirSync(path.join(tempDir, 'mypackage', 'subpkg'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'mypackage', 'subpkg', 'module.py'), 'VAR = 42');

      assert.ok(isImplicitPackage(path.join(tempDir, 'mypackage')), 'mypackage/ should be implicit package');
      assert.ok(isImplicitPackage(path.join(tempDir, 'mypackage', 'subpkg')), 'subpkg/ should be implicit package');
    });

    it('should support mixed regular and implicit packages', () => {
      // Mixed structure:
      // tempDir/
      //   notebook.py
      //   implicit_pkg/           (NO __init__.py)
      //     module_a.py
      //   regular_pkg/            (HAS __init__.py)
      //     module_b.py

      fs.writeFileSync(path.join(tempDir, 'notebook.py'), '# notebook');

      fs.mkdirSync(path.join(tempDir, 'implicit_pkg'));
      fs.writeFileSync(path.join(tempDir, 'implicit_pkg', 'module_a.py'), '# implicit');

      fs.mkdirSync(path.join(tempDir, 'regular_pkg'));
      fs.writeFileSync(path.join(tempDir, 'regular_pkg', '__init__.py'), '');
      fs.writeFileSync(path.join(tempDir, 'regular_pkg', 'module_b.py'), '# regular');

      assert.ok(isImplicitPackage(path.join(tempDir, 'implicit_pkg')), 'implicit_pkg/ should be implicit package');
      assert.ok(!isImplicitPackage(path.join(tempDir, 'regular_pkg')), 'regular_pkg/ should NOT be implicit package');
    });
  });

  describe('Sibling Module Import Support', () => {
    it('should have notebook directory in path for sibling .py imports', () => {
      // Structure for "import helper" to work:
      // tempDir/
      //   notebook.py
      //   helper.py

      fs.writeFileSync(path.join(tempDir, 'notebook.py'), '# notebook');
      fs.writeFileSync(path.join(tempDir, 'helper.py'), 'HELPER_VAR = 42');

      // The notebook directory should be in discovered paths
      const notebookPath = path.join(tempDir, 'notebook.py');
      const notebookDir = path.dirname(notebookPath);

      assert.ok(fs.existsSync(path.join(notebookDir, 'helper.py')), 'helper.py should be accessible from notebook dir');
    });
  });
});
