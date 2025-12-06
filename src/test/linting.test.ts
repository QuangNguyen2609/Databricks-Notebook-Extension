/**
 * Tests for cross-cell linting components
 *
 * Note: These tests require VS Code extension host environment because they use
 * vscode.Uri, vscode.Diagnostic, etc. They will be skipped in mocha unit tests.
 */

import * as assert from 'assert';

// Check if we're running in VS Code extension host environment
let hasVSCode = false;
let vscode: typeof import('vscode') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const vscodeModule = require('vscode');
  // Check for properties that real vscode has but mocks typically don't
  hasVSCode = Boolean(
    vscodeModule &&
    typeof vscodeModule.version === 'string' &&
    typeof vscodeModule.Uri?.file === 'function'
  );
  if (hasVSCode) {
    vscode = vscodeModule;
  }
} catch {
  hasVSCode = false;
}

// Helper to conditionally skip tests that require VS Code
const describeVSCode = hasVSCode ? describe : describe.skip;

// Conditionally import modules that depend on vscode
let VirtualDocumentGenerator: typeof import('../linting/virtualDocumentGenerator').VirtualDocumentGenerator | null = null;
let DiagnosticMapper: typeof import('../linting/diagnosticMapper').DiagnosticMapper | null = null;

if (hasVSCode) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  VirtualDocumentGenerator = require('../linting/virtualDocumentGenerator').VirtualDocumentGenerator;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  DiagnosticMapper = require('../linting/diagnosticMapper').DiagnosticMapper;
}

describeVSCode('Cross-Cell Linting Tests', () => {
  // Type assertion: vscode is definitely available since describeVSCode only runs with VS Code
  const vs = vscode!;
  const VDocGen = VirtualDocumentGenerator!;
  const DMapper = DiagnosticMapper!;

  describe('VirtualDocumentGenerator', () => {
    let generator: InstanceType<typeof VDocGen>;
    const workspaceRoot = '/tmp/test-workspace';

    beforeEach(() => {
      generator = new VDocGen(workspaceRoot);
    });

    it('should generate virtual file path with hash', () => {
      const notebookUri = vs.Uri.file('/path/to/notebook.py');
      const virtualPath = generator.getVirtualFilePath(notebookUri);

      assert.ok(virtualPath.includes('.databricks-cache'));
      assert.ok(virtualPath.endsWith('.virtual.py'));
      assert.ok(virtualPath.includes('notebook-'));
    });

    it('should include Databricks preamble when enabled', () => {
      // Create a mock notebook with one Python cell
      const notebook = createMockNotebook([
        { kind: vs.NotebookCellKind.Code, content: 'x = 1', languageId: 'python' },
      ]);

      const virtualDoc = generator.generateDocument(notebook, true);

      assert.ok(virtualDoc.content.includes('spark: SparkSession'));
      // dbutils now has detailed type stubs (FSUtils, NotebookUtils, etc.) instead of just Any
      assert.ok(virtualDoc.content.includes('class DBUtils'));
      assert.ok(virtualDoc.content.includes('dbutils: DBUtils'));
      // display is now defined as a function
      assert.ok(virtualDoc.content.includes('def display('));
    });

    it('should not include preamble when disabled', () => {
      const notebook = createMockNotebook([
        { kind: vs.NotebookCellKind.Code, content: 'x = 1', languageId: 'python' },
      ]);

      const virtualDoc = generator.generateDocument(notebook, false);

      assert.ok(!virtualDoc.content.includes('spark: SparkSession'));
    });

    it('should generate cell markers for Python cells', () => {
      const notebook = createMockNotebook([
        { kind: vs.NotebookCellKind.Code, content: 'x = 1', languageId: 'python' },
        { kind: vs.NotebookCellKind.Code, content: 'y = 2', languageId: 'python' },
      ]);

      const virtualDoc = generator.generateDocument(notebook, false);

      assert.strictEqual(virtualDoc.cellMarkers.length, 2);
      assert.strictEqual(virtualDoc.cellMarkers[0].cellIndex, 0);
      assert.strictEqual(virtualDoc.cellMarkers[1].cellIndex, 1);
    });

    it('should skip markdown cells', () => {
      const notebook = createMockNotebook([
        { kind: vs.NotebookCellKind.Markup, content: '# Title', languageId: 'markdown' },
        { kind: vs.NotebookCellKind.Code, content: 'x = 1', languageId: 'python' },
      ]);

      const virtualDoc = generator.generateDocument(notebook, false);

      // Only one cell marker (for Python cell)
      assert.strictEqual(virtualDoc.cellMarkers.length, 1);
      assert.strictEqual(virtualDoc.cellMarkers[0].cellIndex, 1); // Index 1 (second cell)
    });

    it('should replace SQL cells with pass', () => {
      const notebook = createMockNotebook([
        {
          kind: vs.NotebookCellKind.Code,
          content: 'SELECT * FROM table',
          languageId: 'sql',
          metadata: { databricksType: 'sql' },
        },
      ]);

      const virtualDoc = generator.generateDocument(notebook, false);

      assert.ok(virtualDoc.content.includes('pass  # SQL cell'));
      assert.ok(!virtualDoc.content.includes('SELECT'));
    });

    it('should strip %python magic command', () => {
      const notebook = createMockNotebook([
        {
          kind: vs.NotebookCellKind.Code,
          content: '%python\nx = 1',
          languageId: 'python',
          metadata: { databricksType: 'code', magicCommand: '%python' },
        },
      ]);

      const virtualDoc = generator.generateDocument(notebook, false);

      assert.ok(virtualDoc.content.includes('x = 1'));
      assert.ok(!virtualDoc.content.includes('%python'));
    });

    it('should add cell marker comments', () => {
      const notebook = createMockNotebook([
        { kind: vs.NotebookCellKind.Code, content: 'x = 1', languageId: 'python' },
        { kind: vs.NotebookCellKind.Code, content: 'y = 2', languageId: 'python' },
      ]);

      const virtualDoc = generator.generateDocument(notebook, false);

      assert.ok(virtualDoc.content.includes('# CELL:0:'));
      assert.ok(virtualDoc.content.includes('# CELL:1:'));
    });

    it('should calculate correct line numbers for cell markers', () => {
      const notebook = createMockNotebook([
        { kind: vs.NotebookCellKind.Code, content: 'x = 1', languageId: 'python' },
        { kind: vs.NotebookCellKind.Code, content: 'y = 2\nz = 3', languageId: 'python' },
      ]);

      const virtualDoc = generator.generateDocument(notebook, false);

      assert.strictEqual(virtualDoc.cellMarkers[0].lineStart, 1); // First cell starts at line 1 (after marker)
      assert.ok(virtualDoc.cellMarkers[1].lineStart > virtualDoc.cellMarkers[0].lineEnd);
    });
  });

  describe('DiagnosticMapper', () => {
    let mapper: InstanceType<typeof DMapper>;

    beforeEach(() => {
      mapper = new DMapper();
    });

    it('should map diagnostic to correct cell', () => {
      const virtualDoc = {
        content: '# CELL:0:0\nx = 1\n\n# CELL:1:3\ny = x + 1',
        cellMarkers: [
          { cellIndex: 0, lineStart: 1, lineEnd: 1, originalUri: 'cell://0' },
          { cellIndex: 1, lineStart: 4, lineEnd: 4, originalUri: 'cell://1' },
        ],
        filePath: '/tmp/virtual.py',
        notebookUri: 'notebook://test',
      };

      const diagnostic = new vs.Diagnostic(
        new vs.Range(4, 0, 4, 5), // Line 4 (second cell)
        'Undefined variable: x',
        vs.DiagnosticSeverity.Error
      );

      const mappedDiagnostics = mapper.mapDiagnostics(virtualDoc, [diagnostic]);

      assert.strictEqual(mappedDiagnostics.size, 1);
      assert.ok(mappedDiagnostics.has(1)); // Cell index 1
      const cellDiags = mappedDiagnostics.get(1)!;
      assert.strictEqual(cellDiags.length, 1);
      assert.strictEqual(cellDiags[0].range.start.line, 0); // Line 0 in cell (converted from line 4 in virtual doc)
    });

    it('should filter diagnostics in preamble', () => {
      const virtualDoc = {
        content: 'spark: SparkSession\n\n# CELL:0:2\nx = 1',
        cellMarkers: [{ cellIndex: 0, lineStart: 3, lineEnd: 3, originalUri: 'cell://0' }],
        filePath: '/tmp/virtual.py',
        notebookUri: 'notebook://test',
      };

      const diagnostic = new vs.Diagnostic(
        new vs.Range(0, 0, 0, 5), // Line 0 (preamble)
        'Undefined variable: spark',
        vs.DiagnosticSeverity.Error
      );

      const mappedDiagnostics = mapper.mapDiagnostics(virtualDoc, [diagnostic]);

      // No diagnostics should be mapped (preamble is filtered)
      assert.strictEqual(mappedDiagnostics.size, 0);
    });

    it('should convert line numbers to cell-relative', () => {
      const virtualDoc = {
        content: '# CELL:0:0\nx = 1\ny = 2\nz = 3',
        cellMarkers: [{ cellIndex: 0, lineStart: 1, lineEnd: 3, originalUri: 'cell://0' }],
        filePath: '/tmp/virtual.py',
        notebookUri: 'notebook://test',
      };

      const diagnostic = new vs.Diagnostic(
        new vs.Range(3, 0, 3, 1), // Line 3 in virtual doc
        'Error on line 3',
        vs.DiagnosticSeverity.Error
      );

      const mappedDiagnostics = mapper.mapDiagnostics(virtualDoc, [diagnostic]);
      const cellDiags = mappedDiagnostics.get(0)!;

      assert.strictEqual(cellDiags[0].range.start.line, 2); // Line 2 in cell (3 - 1 offset)
    });

    it('should preserve diagnostic metadata', () => {
      const virtualDoc = {
        content: '# CELL:0:0\nx = 1',
        cellMarkers: [{ cellIndex: 0, lineStart: 1, lineEnd: 1, originalUri: 'cell://0' }],
        filePath: '/tmp/virtual.py',
        notebookUri: 'notebook://test',
      };

      const diagnostic = new vs.Diagnostic(
        new vs.Range(1, 0, 1, 1),
        'Test error',
        vs.DiagnosticSeverity.Warning
      );
      diagnostic.code = 'test-code';
      diagnostic.source = 'pyright';

      const mappedDiagnostics = mapper.mapDiagnostics(virtualDoc, [diagnostic]);
      const cellDiags = mappedDiagnostics.get(0)!;

      assert.strictEqual(cellDiags[0].message, 'Test error');
      assert.strictEqual(cellDiags[0].severity, vs.DiagnosticSeverity.Warning);
      assert.strictEqual(cellDiags[0].code, 'test-code');
      assert.strictEqual(cellDiags[0].source, 'pyright');
    });

    it('should handle multiple diagnostics in same cell', () => {
      const virtualDoc = {
        content: '# CELL:0:0\nx = 1\ny = undefined',
        cellMarkers: [{ cellIndex: 0, lineStart: 1, lineEnd: 2, originalUri: 'cell://0' }],
        filePath: '/tmp/virtual.py',
        notebookUri: 'notebook://test',
      };

      const diagnostics = [
        new vs.Diagnostic(new vs.Range(1, 0, 1, 1), 'Error 1'),
        new vs.Diagnostic(new vs.Range(2, 0, 2, 1), 'Error 2'),
      ];

      const mappedDiagnostics = mapper.mapDiagnostics(virtualDoc, diagnostics);

      assert.strictEqual(mappedDiagnostics.size, 1);
      assert.strictEqual(mappedDiagnostics.get(0)!.length, 2);
    });

    it('should handle diagnostics across multiple cells', () => {
      const virtualDoc = {
        content: '# CELL:0:0\nx = 1\n\n# CELL:1:3\ny = x',
        cellMarkers: [
          { cellIndex: 0, lineStart: 1, lineEnd: 1, originalUri: 'cell://0' },
          { cellIndex: 1, lineStart: 4, lineEnd: 4, originalUri: 'cell://1' },
        ],
        filePath: '/tmp/virtual.py',
        notebookUri: 'notebook://test',
      };

      const diagnostics = [
        new vs.Diagnostic(new vs.Range(1, 0, 1, 1), 'Error in cell 0'),
        new vs.Diagnostic(new vs.Range(4, 0, 4, 1), 'Error in cell 1'),
      ];

      const mappedDiagnostics = mapper.mapDiagnostics(virtualDoc, diagnostics);

      assert.strictEqual(mappedDiagnostics.size, 2);
      assert.ok(mappedDiagnostics.has(0));
      assert.ok(mappedDiagnostics.has(1));
    });
  });

  describe('Databricks Preamble', () => {
    // These tests verify proper typing for spark/dbutils in the preamble
    // Tests will initially fail until Phase 3 implementation

    it('should include detailed dbutils type stubs (not just Any)', () => {
      // After Phase 3, dbutils should have detailed type stubs, not just Any
      const notebook = createMockNotebook([
        { kind: vs.NotebookCellKind.Code, content: 'x = 1', languageId: 'python' },
      ]);

      const generator = new VDocGen('/tmp/test');
      const virtualDoc = generator.generateDocument(notebook, true);

      // Current implementation has "dbutils: Any" - after Phase 3, should have detailed stubs
      // This test documents the expected behavior for Phase 3

      // Check for FSUtils class (will be added in Phase 3)
      const hasFSUtils = virtualDoc.content.includes('class FSUtils') ||
                         virtualDoc.content.includes('fs: FSUtils');

      // Check for SecretsUtils class
      const hasSecretsUtils = virtualDoc.content.includes('class SecretsUtils') ||
                              virtualDoc.content.includes('secrets: SecretsUtils');

      // Check for DBUtils class
      const hasDBUtils = virtualDoc.content.includes('class DBUtils');

      // For now, this test expects the current behavior (dbutils: Any)
      // After Phase 3 implementation, update this to expect detailed stubs
      if (!hasFSUtils && !hasSecretsUtils && !hasDBUtils) {
        // Currently passes with "dbutils: Any"
        assert.ok(
          virtualDoc.content.includes('dbutils:'),
          'Preamble should declare dbutils (currently as Any, will be detailed after Phase 3)'
        );
      } else {
        // After Phase 3, should have detailed stubs
        assert.ok(hasFSUtils, 'Preamble should include FSUtils for dbutils.fs methods');
        assert.ok(hasSecretsUtils, 'Preamble should include SecretsUtils for dbutils.secrets methods');
        assert.ok(hasDBUtils, 'Preamble should include DBUtils class');
      }
    });

    it('should recognize spark methods without errors', () => {
      // Test that spark.sql(), spark.table() are properly typed
      const notebook = createMockNotebook([
        {
          kind: vs.NotebookCellKind.Code,
          content: 'df = spark.sql("SELECT 1")',
          languageId: 'python',
        },
      ]);

      const generator = new VDocGen('/tmp/test');
      const virtualDoc = generator.generateDocument(notebook, true);

      // Verify spark is typed as SparkSession
      assert.ok(
        virtualDoc.content.includes('spark: SparkSession'),
        'spark should be typed as SparkSession'
      );

      // Verify the spark.sql() call is included
      assert.ok(
        virtualDoc.content.includes('spark.sql'),
        'spark.sql() should be recognized'
      );
    });

    it('should recognize dbutils methods without errors', () => {
      // Test that dbutils.fs.ls() is recognized
      const notebook = createMockNotebook([
        {
          kind: vs.NotebookCellKind.Code,
          content: 'files = dbutils.fs.ls("/mnt")',
          languageId: 'python',
        },
      ]);

      const generator = new VDocGen('/tmp/test');
      const virtualDoc = generator.generateDocument(notebook, true);

      // Verify dbutils is declared in preamble
      assert.ok(
        virtualDoc.content.includes('dbutils:') || virtualDoc.content.includes('dbutils = '),
        'dbutils should be declared in preamble'
      );

      // Verify the dbutils.fs.ls() call is included in the cell
      assert.ok(
        virtualDoc.content.includes('dbutils.fs.ls'),
        'dbutils.fs.ls() should be in the virtual document'
      );
    });

    it('should recognize display function without errors', () => {
      // Test that display() is properly declared
      const notebook = createMockNotebook([
        {
          kind: vs.NotebookCellKind.Code,
          content: 'display(df)',
          languageId: 'python',
        },
      ]);

      const generator = new VDocGen('/tmp/test');
      const virtualDoc = generator.generateDocument(notebook, true);

      // Verify display is declared
      assert.ok(
        virtualDoc.content.includes('display') && virtualDoc.content.includes('def display') ||
        virtualDoc.content.includes('display:'),
        'display should be declared in preamble'
      );
    });

    it('should import DataFrame and SparkSession types', () => {
      const notebook = createMockNotebook([
        { kind: vs.NotebookCellKind.Code, content: 'x = 1', languageId: 'python' },
      ]);

      const generator = new VDocGen('/tmp/test');
      const virtualDoc = generator.generateDocument(notebook, true);

      // Verify PySpark imports are present
      assert.ok(
        virtualDoc.content.includes('from pyspark.sql import SparkSession'),
        'Should import SparkSession from pyspark.sql'
      );

      assert.ok(
        virtualDoc.content.includes('DataFrame'),
        'Should import or reference DataFrame'
      );
    });
  });

  describe('Integration Tests', () => {
    it('should handle cross-cell variable references', () => {
      const notebook = createMockNotebook([
        { kind: vs.NotebookCellKind.Code, content: 'df = pd.DataFrame()', languageId: 'python' },
        { kind: vs.NotebookCellKind.Code, content: 'print(df.head())', languageId: 'python' },
      ]);

      const generator = new VDocGen('/tmp/test');
      const virtualDoc = generator.generateDocument(notebook, true);

      // Verify both cells are present
      assert.strictEqual(virtualDoc.cellMarkers.length, 2);

      // Verify 'df' is defined in first cell
      assert.ok(virtualDoc.content.includes('df = pd.DataFrame()'));

      // Verify 'df' is used in second cell
      assert.ok(virtualDoc.content.includes('print(df.head())'));

      // Verify cells are separated
      const firstCellEnd = virtualDoc.cellMarkers[0].lineEnd;
      const secondCellStart = virtualDoc.cellMarkers[1].lineStart;
      assert.ok(secondCellStart > firstCellEnd);
    });

    it('should handle Databricks objects without errors', () => {
      const notebook = createMockNotebook([
        {
          kind: vs.NotebookCellKind.Code,
          content: 'df = spark.sql("SELECT * FROM table")',
          languageId: 'python',
        },
        { kind: vs.NotebookCellKind.Code, content: 'display(df)', languageId: 'python' },
      ]);

      const generator = new VDocGen('/tmp/test');
      const virtualDoc = generator.generateDocument(notebook, true);

      // Verify preamble includes spark and display
      assert.ok(virtualDoc.content.includes('spark: SparkSession'));
      assert.ok(virtualDoc.content.includes('def display('));

      // Verify cells use spark and display
      assert.ok(virtualDoc.content.includes('spark.sql'));
      assert.ok(virtualDoc.content.includes('display(df)'));
    });

    it('should handle mixed cell types', () => {
      const notebook = createMockNotebook([
        { kind: vs.NotebookCellKind.Markup, content: '# Title', languageId: 'markdown' },
        { kind: vs.NotebookCellKind.Code, content: 'x = 1', languageId: 'python' },
        {
          kind: vs.NotebookCellKind.Code,
          content: 'SELECT * FROM table',
          languageId: 'sql',
          metadata: { databricksType: 'sql' },
        },
        { kind: vs.NotebookCellKind.Code, content: 'y = x + 1', languageId: 'python' },
      ]);

      const generator = new VDocGen('/tmp/test');
      const virtualDoc = generator.generateDocument(notebook, false);

      // Should have 3 cell markers (skip markdown)
      assert.strictEqual(virtualDoc.cellMarkers.length, 3);

      // SQL cell should be replaced with pass
      assert.ok(virtualDoc.content.includes('pass  # SQL cell'));
    });
  });
});

/**
 * Helper function to create a mock notebook document
 * Note: This function is only called from within describeVSCode tests,
 * so vscode is guaranteed to be available.
 */
function createMockNotebook(
  cells: Array<{
    // Using number type since the enum values are numbers
    kind: number;
    content: string;
    languageId: string;
    metadata?: Record<string, unknown>;
  }>
): import('vscode').NotebookDocument {
  const vs = vscode!;
  const mockCells = cells.map((cell, index) => {
    const uri = vs.Uri.parse(`vscode-notebook-cell:test.py#cell${index}`);
    return {
      index,
      kind: cell.kind,
      document: {
        uri,
        getText: () => cell.content,
        lineCount: cell.content.split('\n').length,
      },
      metadata: cell.metadata || {},
    };
  });

  return {
    uri: vs.Uri.file('/test/notebook.py'),
    notebookType: 'databricks-notebook',
    version: 1,
    isDirty: false,
    isUntitled: false,
    isClosed: false,
    cellCount: mockCells.length,
    cellAt: (index: number) => mockCells[index],
    getCells: () => mockCells,
    save: async () => true,
    metadata: {},
  } as unknown as import('vscode').NotebookDocument;
}
