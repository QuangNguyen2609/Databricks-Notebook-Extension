/**
 * Tests for Python IntelliSense (spark/dbutils completions)
 *
 * These tests define the expected behavior for Python code completion
 * in Databricks notebooks, including:
 * - Live completions for spark (SparkSession)
 * - Static completions for dbutils (type stubs)
 * - DataFrame method completions
 *
 * Note: Tests for PythonCompletionProvider require VS Code extension host and
 * will be skipped in mocha unit test environment. Run the full VS Code test
 * suite to execute these tests.
 *
 * DbutilsTypeStubs tests can run in mocha as they don't depend on VS Code.
 */

import * as assert from 'assert';

// Check if we're running in VS Code extension host environment
// We need to check for a real vscode module, not a mock from other tests
// The real vscode module has 'version' property on the module itself
let hasVSCode = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const vscode = require('vscode');
  // Check for properties that real vscode has but mocks typically don't
  // Real vscode module has 'version' and complex nested structures
  hasVSCode = Boolean(
    vscode &&
    typeof vscode.version === 'string' &&
    typeof vscode.languages?.registerCompletionItemProvider === 'function'
  );
} catch {
  hasVSCode = false;
}

// Helper to conditionally skip tests that require VS Code
const describeVSCode = hasVSCode ? describe : describe.skip;

describe('Python IntelliSense Tests', () => {
  describe('DbutilsTypeStubs', () => {
    // These tests verify the dbutils type stub generator exists and produces correct output

    it('should export generateDbutilsTypeStub function', async () => {
      try {
        // Attempt to import - this will fail until Phase 3 implementation
        const { generateDbutilsTypeStub } = await import('../intellisense/dbutilsTypeStubs');
        assert.ok(
          typeof generateDbutilsTypeStub === 'function',
          'generateDbutilsTypeStub should be a function'
        );
      } catch (error) {
        // Expected to fail until Phase 3
        assert.fail(
          'dbutilsTypeStubs module not yet implemented - expected failure for TDD'
        );
      }
    });

    it('should define FileInfo type in generated stubs', async () => {
      try {
        const { generateDbutilsTypeStub } = await import('../intellisense/dbutilsTypeStubs');
        const stubs = generateDbutilsTypeStub();

        assert.ok(stubs.includes('class FileInfo'), 'Stubs should define FileInfo class');
        assert.ok(stubs.includes('path: str'), 'FileInfo should have path field');
        assert.ok(stubs.includes('name: str'), 'FileInfo should have name field');
        assert.ok(stubs.includes('size: int'), 'FileInfo should have size field');
        assert.ok(stubs.includes('isDir: bool'), 'FileInfo should have isDir field');
        assert.ok(stubs.includes('isFile: bool'), 'FileInfo should have isFile field');
      } catch (error) {
        assert.fail('dbutilsTypeStubs module not yet implemented');
      }
    });

    it('should define SecretMetadata type in generated stubs', async () => {
      try {
        const { generateDbutilsTypeStub } = await import('../intellisense/dbutilsTypeStubs');
        const stubs = generateDbutilsTypeStub();

        assert.ok(stubs.includes('class SecretMetadata'), 'Stubs should define SecretMetadata class');
        assert.ok(stubs.includes('key: str'), 'SecretMetadata should have key field');
      } catch (error) {
        assert.fail('dbutilsTypeStubs module not yet implemented');
      }
    });

    it('should define FSUtils class with all methods', async () => {
      try {
        const { generateDbutilsTypeStub } = await import('../intellisense/dbutilsTypeStubs');
        const stubs = generateDbutilsTypeStub();

        assert.ok(stubs.includes('class FSUtils'), 'Stubs should define FSUtils class');
        assert.ok(stubs.includes('def ls('), 'FSUtils should have ls method');
        assert.ok(stubs.includes('def cp('), 'FSUtils should have cp method');
        assert.ok(stubs.includes('def mv('), 'FSUtils should have mv method');
        assert.ok(stubs.includes('def rm('), 'FSUtils should have rm method');
        assert.ok(stubs.includes('def mkdirs('), 'FSUtils should have mkdirs method');
        assert.ok(stubs.includes('def head('), 'FSUtils should have head method');
        assert.ok(stubs.includes('def put('), 'FSUtils should have put method');
      } catch (error) {
        assert.fail('dbutilsTypeStubs module not yet implemented');
      }
    });

    it('should define NotebookUtils class with run and exit', async () => {
      try {
        const { generateDbutilsTypeStub } = await import('../intellisense/dbutilsTypeStubs');
        const stubs = generateDbutilsTypeStub();

        assert.ok(stubs.includes('class NotebookUtils'), 'Stubs should define NotebookUtils class');
        assert.ok(stubs.includes('def run('), 'NotebookUtils should have run method');
        assert.ok(stubs.includes('def exit('), 'NotebookUtils should have exit method');
      } catch (error) {
        assert.fail('dbutilsTypeStubs module not yet implemented');
      }
    });

    it('should define SecretsUtils class with all methods', async () => {
      try {
        const { generateDbutilsTypeStub } = await import('../intellisense/dbutilsTypeStubs');
        const stubs = generateDbutilsTypeStub();

        assert.ok(stubs.includes('class SecretsUtils'), 'Stubs should define SecretsUtils class');
        assert.ok(stubs.includes('def get('), 'SecretsUtils should have get method');
        assert.ok(stubs.includes('def getBytes('), 'SecretsUtils should have getBytes method');
        assert.ok(stubs.includes('def list('), 'SecretsUtils should have list method');
        assert.ok(stubs.includes('def listScopes('), 'SecretsUtils should have listScopes method');
      } catch (error) {
        assert.fail('dbutilsTypeStubs module not yet implemented');
      }
    });

    it('should define WidgetsUtils class with all methods', async () => {
      try {
        const { generateDbutilsTypeStub } = await import('../intellisense/dbutilsTypeStubs');
        const stubs = generateDbutilsTypeStub();

        assert.ok(stubs.includes('class WidgetsUtils'), 'Stubs should define WidgetsUtils class');
        assert.ok(stubs.includes('def text('), 'WidgetsUtils should have text method');
        assert.ok(stubs.includes('def dropdown('), 'WidgetsUtils should have dropdown method');
        assert.ok(stubs.includes('def multiselect('), 'WidgetsUtils should have multiselect method');
        assert.ok(stubs.includes('def combobox('), 'WidgetsUtils should have combobox method');
        assert.ok(stubs.includes('def getAll('), 'WidgetsUtils should have getAll method');
        assert.ok(stubs.includes('def remove('), 'WidgetsUtils should have remove method');
        assert.ok(stubs.includes('def removeAll('), 'WidgetsUtils should have removeAll method');
      } catch (error) {
        assert.fail('dbutilsTypeStubs module not yet implemented');
      }
    });

    it('should define DBUtils class as main entry point', async () => {
      try {
        const { generateDbutilsTypeStub } = await import('../intellisense/dbutilsTypeStubs');
        const stubs = generateDbutilsTypeStub();

        assert.ok(stubs.includes('class DBUtils'), 'Stubs should define DBUtils class');
        assert.ok(stubs.includes('fs: FSUtils'), 'DBUtils should have fs module');
        assert.ok(stubs.includes('notebook: NotebookUtils'), 'DBUtils should have notebook module');
        assert.ok(stubs.includes('secrets: SecretsUtils'), 'DBUtils should have secrets module');
        assert.ok(stubs.includes('widgets: WidgetsUtils'), 'DBUtils should have widgets module');
        assert.ok(stubs.includes('dbutils: DBUtils'), 'Should declare dbutils variable');
      } catch (error) {
        assert.fail('dbutilsTypeStubs module not yet implemented');
      }
    });
  });

  describeVSCode('PythonCompletionProvider', () => {
    // These tests verify the Python completion provider exists and works correctly
    // Requires VS Code extension host environment

    it('should export PythonCompletionProvider class', async () => {
      try {
        const { PythonCompletionProvider } = await import('../intellisense/pythonCompletionProvider');
        assert.ok(
          typeof PythonCompletionProvider === 'function',
          'PythonCompletionProvider should be a class/constructor'
        );
      } catch (error) {
        assert.fail('pythonCompletionProvider module not yet implemented');
      }
    });

    it('should implement CompletionItemProvider interface', async () => {
      try {
        const { PythonCompletionProvider } = await import('../intellisense/pythonCompletionProvider');
        const provider = new PythonCompletionProvider(() => null);

        assert.ok(
          typeof provider.provideCompletionItems === 'function',
          'Provider should have provideCompletionItems method'
        );
      } catch (error) {
        assert.fail('pythonCompletionProvider module not yet implemented');
      }
    });

    it('should have clearCache method for kernel restart', async () => {
      try {
        const { PythonCompletionProvider } = await import('../intellisense/pythonCompletionProvider');
        const provider = new PythonCompletionProvider(() => null);

        assert.ok(
          typeof provider.clearCache === 'function',
          'Provider should have clearCache method'
        );
      } catch (error) {
        assert.fail('pythonCompletionProvider module not yet implemented');
      }
    });
  });

  describeVSCode('SparkCompletionProvider (within PythonCompletionProvider)', () => {
    // Requires VS Code extension host environment
    it('should return empty array for spark. when kernel not available', async () => {
      try {
        const { PythonCompletionProvider } = await import('../intellisense/pythonCompletionProvider');
        const provider = new PythonCompletionProvider(() => null);

        // Create mock document and position
        const mockDocument = {
          languageId: 'python',
          lineAt: () => ({ text: 'spark.' }),
          getText: () => 'spark.',
        };
        const mockPosition = { line: 0, character: 6 };
        const mockToken = { isCancellationRequested: false };
        const mockContext = { triggerKind: 1 };

        const completions = await provider.provideCompletionItems(
          mockDocument as never,
          mockPosition as never,
          mockToken as never,
          mockContext as never
        );

        // Without kernel, spark completions should return empty array
        assert.ok(Array.isArray(completions), 'Should return array of completions');
        assert.strictEqual(completions!.length, 0, 'Should have no completions without kernel');
      } catch (error) {
        assert.fail('pythonCompletionProvider module not yet implemented');
      }
    });

    it('should provide live completions for any variable with kernel', async () => {
      // Now all variable completions are live (require kernel)
      try {
        const { PythonCompletionProvider } = await import('../intellisense/pythonCompletionProvider');

        // Mock executor that returns variable members
        const mockExecutor = {
          isRunning: () => true,
          execute: async () => ({
            success: true,
            stdout: JSON.stringify({
              type: 'list',
              members: [
                { name: 'append', isMethod: true },
                { name: 'extend', isMethod: true },
              ]
            }),
            stderr: '',
          }),
        };

        const provider = new PythonCompletionProvider(() => mockExecutor as never);

        const mockDocument = {
          languageId: 'python',
          lineAt: () => ({ text: 'my_list.' }),
        };
        const mockPosition = { line: 0, character: 8 };

        const completions = await provider.provideCompletionItems(
          mockDocument as never,
          mockPosition as never,
          { isCancellationRequested: false } as never,
          { triggerKind: 1 } as never
        );

        assert.ok(completions, 'Should return completions from kernel');
        assert.ok(completions!.length > 0, 'Should have completions');
      } catch (error) {
        assert.fail('pythonCompletionProvider module not yet implemented');
      }
    });

    it('should query kernel for live completions when executor available', async () => {
      try {
        const { PythonCompletionProvider } = await import('../intellisense/pythonCompletionProvider');

        // Mock executor that returns spark methods with new format
        const mockExecutor = {
          isRunning: () => true,
          execute: async () => ({
            success: true,
            stdout: JSON.stringify({
              type: 'pyspark.sql.session.SparkSession',
              members: [
                { name: 'sql', isMethod: true },
                { name: 'table', isMethod: true },
                { name: 'read', isMethod: false },
                { name: 'createDataFrame', isMethod: true },
                { name: 'catalog', isMethod: false },
              ]
            }),
            stderr: '',
          }),
        };

        const provider = new PythonCompletionProvider(() => mockExecutor as never);

        const mockDocument = {
          languageId: 'python',
          lineAt: () => ({ text: 'spark.' }),
        };
        const mockPosition = { line: 0, character: 6 };

        const completions = await provider.provideCompletionItems(
          mockDocument as never,
          mockPosition as never,
          { isCancellationRequested: false } as never,
          { triggerKind: 1 } as never
        );

        assert.ok(completions, 'Should return completions from kernel');
        assert.ok(completions!.length > 0, 'Should have completions from kernel');

        const labels = completions!.map((c) => typeof c.label === 'string' ? c.label : c.label.label);
        assert.ok(labels.includes('sql'), 'Should have sql method from kernel');
        assert.ok(labels.includes('catalog'), 'Should have catalog from kernel');
      } catch (error) {
        assert.fail('pythonCompletionProvider module not yet implemented');
      }
    });
  });

  describeVSCode('DbutilsCompletionProvider (within PythonCompletionProvider)', () => {
    // Requires VS Code extension host environment
    it('should provide completions for dbutils.', async () => {
      try {
        const { PythonCompletionProvider } = await import('../intellisense/pythonCompletionProvider');
        const provider = new PythonCompletionProvider(() => null);

        const mockDocument = {
          languageId: 'python',
          lineAt: () => ({ text: 'dbutils.' }),
        };
        const mockPosition = { line: 0, character: 8 };

        const completions = await provider.provideCompletionItems(
          mockDocument as never,
          mockPosition as never,
          { isCancellationRequested: false } as never,
          { triggerKind: 1 } as never
        );

        assert.ok(Array.isArray(completions), 'Should return array of completions');
        assert.ok(completions!.length > 0, 'Should have completions for dbutils.');

        const labels = completions!.map((c) => typeof c.label === 'string' ? c.label : c.label.label);
        assert.ok(labels.includes('fs'), 'Should have fs module');
        assert.ok(labels.includes('notebook'), 'Should have notebook module');
        assert.ok(labels.includes('secrets'), 'Should have secrets module');
        assert.ok(labels.includes('widgets'), 'Should have widgets module');
      } catch (error) {
        assert.fail('pythonCompletionProvider module not yet implemented');
      }
    });

    it('should provide completions for dbutils.fs.', async () => {
      try {
        const { PythonCompletionProvider } = await import('../intellisense/pythonCompletionProvider');
        const provider = new PythonCompletionProvider(() => null);

        const mockDocument = {
          languageId: 'python',
          lineAt: () => ({ text: 'dbutils.fs.' }),
        };
        const mockPosition = { line: 0, character: 11 };

        const completions = await provider.provideCompletionItems(
          mockDocument as never,
          mockPosition as never,
          { isCancellationRequested: false } as never,
          { triggerKind: 1 } as never
        );

        assert.ok(Array.isArray(completions), 'Should return array of completions');

        const labels = completions!.map((c) => typeof c.label === 'string' ? c.label : c.label.label);
        assert.ok(labels.includes('ls'), 'Should have ls method');
        assert.ok(labels.includes('cp'), 'Should have cp method');
        assert.ok(labels.includes('mv'), 'Should have mv method');
        assert.ok(labels.includes('rm'), 'Should have rm method');
        assert.ok(labels.includes('mkdirs'), 'Should have mkdirs method');
        assert.ok(labels.includes('head'), 'Should have head method');
        assert.ok(labels.includes('put'), 'Should have put method');
      } catch (error) {
        assert.fail('pythonCompletionProvider module not yet implemented');
      }
    });

    it('should provide completions for dbutils.notebook.', async () => {
      try {
        const { PythonCompletionProvider } = await import('../intellisense/pythonCompletionProvider');
        const provider = new PythonCompletionProvider(() => null);

        const mockDocument = {
          languageId: 'python',
          lineAt: () => ({ text: 'dbutils.notebook.' }),
        };
        const mockPosition = { line: 0, character: 17 };

        const completions = await provider.provideCompletionItems(
          mockDocument as never,
          mockPosition as never,
          { isCancellationRequested: false } as never,
          { triggerKind: 1 } as never
        );

        assert.ok(Array.isArray(completions), 'Should return array of completions');

        const labels = completions!.map((c) => typeof c.label === 'string' ? c.label : c.label.label);
        assert.ok(labels.includes('run'), 'Should have run method');
        assert.ok(labels.includes('exit'), 'Should have exit method');
      } catch (error) {
        assert.fail('pythonCompletionProvider module not yet implemented');
      }
    });

    it('should provide completions for dbutils.secrets.', async () => {
      try {
        const { PythonCompletionProvider } = await import('../intellisense/pythonCompletionProvider');
        const provider = new PythonCompletionProvider(() => null);

        const mockDocument = {
          languageId: 'python',
          lineAt: () => ({ text: 'dbutils.secrets.' }),
        };
        const mockPosition = { line: 0, character: 16 };

        const completions = await provider.provideCompletionItems(
          mockDocument as never,
          mockPosition as never,
          { isCancellationRequested: false } as never,
          { triggerKind: 1 } as never
        );

        assert.ok(Array.isArray(completions), 'Should return array of completions');

        const labels = completions!.map((c) => typeof c.label === 'string' ? c.label : c.label.label);
        assert.ok(labels.includes('get'), 'Should have get method');
        assert.ok(labels.includes('getBytes'), 'Should have getBytes method');
        assert.ok(labels.includes('list'), 'Should have list method');
        assert.ok(labels.includes('listScopes'), 'Should have listScopes method');
      } catch (error) {
        assert.fail('pythonCompletionProvider module not yet implemented');
      }
    });

    it('should provide completions for dbutils.widgets.', async () => {
      try {
        const { PythonCompletionProvider } = await import('../intellisense/pythonCompletionProvider');
        const provider = new PythonCompletionProvider(() => null);

        const mockDocument = {
          languageId: 'python',
          lineAt: () => ({ text: 'dbutils.widgets.' }),
        };
        const mockPosition = { line: 0, character: 16 };

        const completions = await provider.provideCompletionItems(
          mockDocument as never,
          mockPosition as never,
          { isCancellationRequested: false } as never,
          { triggerKind: 1 } as never
        );

        assert.ok(Array.isArray(completions), 'Should return array of completions');

        const labels = completions!.map((c) => typeof c.label === 'string' ? c.label : c.label.label);
        assert.ok(labels.includes('text'), 'Should have text method');
        assert.ok(labels.includes('dropdown'), 'Should have dropdown method');
        assert.ok(labels.includes('multiselect'), 'Should have multiselect method');
        assert.ok(labels.includes('combobox'), 'Should have combobox method');
        assert.ok(labels.includes('get'), 'Should have get method');
        assert.ok(labels.includes('getAll'), 'Should have getAll method');
        assert.ok(labels.includes('remove'), 'Should have remove method');
        assert.ok(labels.includes('removeAll'), 'Should have removeAll method');
      } catch (error) {
        assert.fail('pythonCompletionProvider module not yet implemented');
      }
    });
  });

  describeVSCode('Edge Cases', () => {
    // Requires VS Code extension host environment
    it('should not provide completions for non-Python cells', async () => {
      try {
        const { PythonCompletionProvider } = await import('../intellisense/pythonCompletionProvider');
        const provider = new PythonCompletionProvider(() => null);

        const mockDocument = {
          languageId: 'sql', // Not Python
          lineAt: () => ({ text: 'spark.' }),
        };
        const mockPosition = { line: 0, character: 6 };

        const completions = await provider.provideCompletionItems(
          mockDocument as never,
          mockPosition as never,
          { isCancellationRequested: false } as never,
          { triggerKind: 1 } as never
        );

        assert.ok(
          completions === undefined || completions.length === 0,
          'Should not provide completions for non-Python cells'
        );
      } catch (error) {
        assert.fail('pythonCompletionProvider module not yet implemented');
      }
    });

    it('should handle executor not available gracefully', async () => {
      try {
        const { PythonCompletionProvider } = await import('../intellisense/pythonCompletionProvider');
        const provider = new PythonCompletionProvider(() => null); // No executor

        const mockDocument = {
          languageId: 'python',
          lineAt: () => ({ text: 'spark.' }),
        };
        const mockPosition = { line: 0, character: 6 };

        // Should not throw, should return empty array when executor not available
        const completions = await provider.provideCompletionItems(
          mockDocument as never,
          mockPosition as never,
          { isCancellationRequested: false } as never,
          { triggerKind: 1 } as never
        );

        assert.ok(
          Array.isArray(completions),
          'Should return array when executor not available'
        );
      } catch (error) {
        assert.fail('pythonCompletionProvider module not yet implemented');
      }
    });

    it('should handle kernel timeout gracefully', async () => {
      try {
        const { PythonCompletionProvider } = await import('../intellisense/pythonCompletionProvider');

        // Mock executor that takes too long (simulates timeout by rejecting)
        const mockExecutor = {
          isRunning: () => true,
          execute: async () => {
            // Simulate a timeout scenario
            throw new Error('Timeout');
          },
        };

        const provider = new PythonCompletionProvider(() => mockExecutor as never);

        const mockDocument = {
          languageId: 'python',
          lineAt: () => ({ text: 'spark.' }),
        };
        const mockPosition = { line: 0, character: 6 };

        // Should not throw, should return empty array
        const completions = await provider.provideCompletionItems(
          mockDocument as never,
          mockPosition as never,
          { isCancellationRequested: false } as never,
          { triggerKind: 1 } as never
        );

        assert.ok(
          Array.isArray(completions),
          'Should return array even when kernel times out'
        );
      } catch (error) {
        assert.fail('pythonCompletionProvider module not yet implemented');
      }
    });

    it('should return empty array for variables when kernel not available', async () => {
      try {
        const { PythonCompletionProvider } = await import('../intellisense/pythonCompletionProvider');
        const provider = new PythonCompletionProvider(() => null);

        const mockDocument = {
          languageId: 'python',
          lineAt: () => ({ text: 'foo.' }), // Any variable name
        };
        const mockPosition = { line: 0, character: 4 };

        const completions = await provider.provideCompletionItems(
          mockDocument as never,
          mockPosition as never,
          { isCancellationRequested: false } as never,
          { triggerKind: 1 } as never
        );

        // Without kernel, should return empty array (not undefined)
        assert.ok(
          Array.isArray(completions) && completions.length === 0,
          'Should return empty array when kernel not available'
        );
      } catch (error) {
        assert.fail('pythonCompletionProvider module not yet implemented');
      }
    });
  });

  describeVSCode('Live Variable Completions', () => {
    // Requires VS Code extension host environment
    // These tests verify that variable completions query the kernel

    it('should query kernel for any variable completions', async () => {
      try {
        const { PythonCompletionProvider } = await import('../intellisense/pythonCompletionProvider');

        // Mock executor that returns DataFrame methods
        const mockExecutor = {
          isRunning: () => true,
          execute: async () => ({
            success: true,
            stdout: JSON.stringify({
              type: 'pyspark.sql.dataframe.DataFrame',
              members: [
                { name: 'select', isMethod: true },
                { name: 'filter', isMethod: true },
                { name: 'groupBy', isMethod: true },
                { name: 'show', isMethod: true },
                { name: 'columns', isMethod: false },
              ]
            }),
            stderr: '',
          }),
        };

        const provider = new PythonCompletionProvider(() => mockExecutor as never);

        const mockDocument = {
          languageId: 'python',
          lineAt: () => ({ text: 'df.' }),
        };
        const mockPosition = { line: 0, character: 3 };

        const completions = await provider.provideCompletionItems(
          mockDocument as never,
          mockPosition as never,
          { isCancellationRequested: false } as never,
          { triggerKind: 1 } as never
        );

        assert.ok(Array.isArray(completions), 'Should return array of completions');
        assert.ok(completions!.length > 0, 'Should have completions from kernel');

        const labels = completions!.map((c) => typeof c.label === 'string' ? c.label : c.label.label);
        assert.ok(labels.includes('select'), 'Should have select method from kernel');
        assert.ok(labels.includes('filter'), 'Should have filter method from kernel');
        assert.ok(labels.includes('columns'), 'Should have columns property from kernel');
      } catch (error) {
        assert.fail('pythonCompletionProvider module not yet implemented');
      }
    });

    it('should return empty array when variable is not defined', async () => {
      try {
        const { PythonCompletionProvider } = await import('../intellisense/pythonCompletionProvider');

        // Mock executor that returns "not_defined" error
        const mockExecutor = {
          isRunning: () => true,
          execute: async () => ({
            success: true,
            stdout: JSON.stringify({ error: 'not_defined' }),
            stderr: '',
          }),
        };

        const provider = new PythonCompletionProvider(() => mockExecutor as never);

        const mockDocument = {
          languageId: 'python',
          lineAt: () => ({ text: 'undefined_var.' }),
        };
        const mockPosition = { line: 0, character: 14 };

        const completions = await provider.provideCompletionItems(
          mockDocument as never,
          mockPosition as never,
          { isCancellationRequested: false } as never,
          { triggerKind: 1 } as never
        );

        assert.ok(Array.isArray(completions), 'Should return array');
        assert.strictEqual(completions!.length, 0, 'Should return empty array for undefined variable');
      } catch (error) {
        assert.fail('pythonCompletionProvider module not yet implemented');
      }
    });

    it('should return empty array when kernel is not available', async () => {
      try {
        const { PythonCompletionProvider } = await import('../intellisense/pythonCompletionProvider');
        const provider = new PythonCompletionProvider(() => null);

        const mockDocument = {
          languageId: 'python',
          lineAt: () => ({ text: 'my_var.' }),
        };
        const mockPosition = { line: 0, character: 7 };

        const completions = await provider.provideCompletionItems(
          mockDocument as never,
          mockPosition as never,
          { isCancellationRequested: false } as never,
          { triggerKind: 1 } as never
        );

        assert.ok(Array.isArray(completions), 'Should return array');
        assert.strictEqual(completions!.length, 0, 'Should return empty array when kernel not available');
      } catch (error) {
        assert.fail('pythonCompletionProvider module not yet implemented');
      }
    });

    it('should show type info in completion detail', async () => {
      try {
        const { PythonCompletionProvider } = await import('../intellisense/pythonCompletionProvider');

        // Mock executor that returns type info
        const mockExecutor = {
          isRunning: () => true,
          execute: async () => ({
            success: true,
            stdout: JSON.stringify({
              type: 'pandas.core.frame.DataFrame',
              members: [
                { name: 'head', isMethod: true },
                { name: 'shape', isMethod: false },
              ]
            }),
            stderr: '',
          }),
        };

        const provider = new PythonCompletionProvider(() => mockExecutor as never);

        const mockDocument = {
          languageId: 'python',
          lineAt: () => ({ text: 'pdf.' }),
        };
        const mockPosition = { line: 0, character: 4 };

        const completions = await provider.provideCompletionItems(
          mockDocument as never,
          mockPosition as never,
          { isCancellationRequested: false } as never,
          { triggerKind: 1 } as never
        );

        assert.ok(completions && completions.length > 0, 'Should have completions');

        // Check that type info is in the detail
        const headItem = completions!.find((c) =>
          (typeof c.label === 'string' ? c.label : c.label.label) === 'head'
        );
        assert.ok(headItem, 'Should have head method');
        assert.ok(
          headItem!.detail?.includes('pandas.core.frame.DataFrame'),
          'Detail should include type name'
        );
      } catch (error) {
        assert.fail('pythonCompletionProvider module not yet implemented');
      }
    });

    it('should skip reserved Python keywords', async () => {
      try {
        const { PythonCompletionProvider } = await import('../intellisense/pythonCompletionProvider');
        const provider = new PythonCompletionProvider(() => null);

        // Test with reserved keywords that shouldn't trigger completions
        const reservedWords = ['if', 'for', 'while', 'class', 'def', 'True', 'False', 'None'];

        for (const word of reservedWords) {
          const mockDocument = {
            languageId: 'python',
            lineAt: () => ({ text: `${word}.` }),
          };
          const mockPosition = { line: 0, character: word.length + 1 };

          const completions = await provider.provideCompletionItems(
            mockDocument as never,
            mockPosition as never,
            { isCancellationRequested: false } as never,
            { triggerKind: 1 } as never
          );

          assert.ok(
            completions === undefined,
            `Should not provide completions for reserved word: ${word}`
          );
        }
      } catch (error) {
        assert.fail('pythonCompletionProvider module not yet implemented');
      }
    });
  });
});
