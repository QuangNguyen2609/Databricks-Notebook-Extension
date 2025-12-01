/**
 * Tests for cross-cell linting components
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { VirtualDocumentGenerator } from '../linting/virtualDocumentGenerator';
import { DiagnosticMapper } from '../linting/diagnosticMapper';

describe('Cross-Cell Linting Tests', () => {
  describe('VirtualDocumentGenerator', () => {
    let generator: VirtualDocumentGenerator;
    const workspaceRoot = '/tmp/test-workspace';

    beforeEach(() => {
      generator = new VirtualDocumentGenerator(workspaceRoot);
    });

    it('should generate virtual file path with hash', () => {
      const notebookUri = vscode.Uri.file('/path/to/notebook.py');
      const virtualPath = generator.getVirtualFilePath(notebookUri);

      assert.ok(virtualPath.includes('.databricks-cache'));
      assert.ok(virtualPath.endsWith('.virtual.py'));
      assert.ok(virtualPath.includes('notebook-'));
    });

    it('should include Databricks preamble when enabled', () => {
      // Create a mock notebook with one Python cell
      const notebook = createMockNotebook([
        { kind: vscode.NotebookCellKind.Code, content: 'x = 1', languageId: 'python' },
      ]);

      const virtualDoc = generator.generateDocument(notebook, true);

      assert.ok(virtualDoc.content.includes('spark: SparkSession'));
      assert.ok(virtualDoc.content.includes('dbutils: Any'));
      assert.ok(virtualDoc.content.includes('display: Any'));
    });

    it('should not include preamble when disabled', () => {
      const notebook = createMockNotebook([
        { kind: vscode.NotebookCellKind.Code, content: 'x = 1', languageId: 'python' },
      ]);

      const virtualDoc = generator.generateDocument(notebook, false);

      assert.ok(!virtualDoc.content.includes('spark: SparkSession'));
    });

    it('should generate cell markers for Python cells', () => {
      const notebook = createMockNotebook([
        { kind: vscode.NotebookCellKind.Code, content: 'x = 1', languageId: 'python' },
        { kind: vscode.NotebookCellKind.Code, content: 'y = 2', languageId: 'python' },
      ]);

      const virtualDoc = generator.generateDocument(notebook, false);

      assert.strictEqual(virtualDoc.cellMarkers.length, 2);
      assert.strictEqual(virtualDoc.cellMarkers[0].cellIndex, 0);
      assert.strictEqual(virtualDoc.cellMarkers[1].cellIndex, 1);
    });

    it('should skip markdown cells', () => {
      const notebook = createMockNotebook([
        { kind: vscode.NotebookCellKind.Markup, content: '# Title', languageId: 'markdown' },
        { kind: vscode.NotebookCellKind.Code, content: 'x = 1', languageId: 'python' },
      ]);

      const virtualDoc = generator.generateDocument(notebook, false);

      // Only one cell marker (for Python cell)
      assert.strictEqual(virtualDoc.cellMarkers.length, 1);
      assert.strictEqual(virtualDoc.cellMarkers[0].cellIndex, 1); // Index 1 (second cell)
    });

    it('should replace SQL cells with pass', () => {
      const notebook = createMockNotebook([
        {
          kind: vscode.NotebookCellKind.Code,
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
          kind: vscode.NotebookCellKind.Code,
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
        { kind: vscode.NotebookCellKind.Code, content: 'x = 1', languageId: 'python' },
        { kind: vscode.NotebookCellKind.Code, content: 'y = 2', languageId: 'python' },
      ]);

      const virtualDoc = generator.generateDocument(notebook, false);

      assert.ok(virtualDoc.content.includes('# CELL:0:'));
      assert.ok(virtualDoc.content.includes('# CELL:1:'));
    });

    it('should calculate correct line numbers for cell markers', () => {
      const notebook = createMockNotebook([
        { kind: vscode.NotebookCellKind.Code, content: 'x = 1', languageId: 'python' },
        { kind: vscode.NotebookCellKind.Code, content: 'y = 2\nz = 3', languageId: 'python' },
      ]);

      const virtualDoc = generator.generateDocument(notebook, false);

      assert.strictEqual(virtualDoc.cellMarkers[0].lineStart, 1); // First cell starts at line 1 (after marker)
      assert.ok(virtualDoc.cellMarkers[1].lineStart > virtualDoc.cellMarkers[0].lineEnd);
    });
  });

  describe('DiagnosticMapper', () => {
    let mapper: DiagnosticMapper;

    beforeEach(() => {
      mapper = new DiagnosticMapper();
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

      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(4, 0, 4, 5), // Line 4 (second cell)
        'Undefined variable: x',
        vscode.DiagnosticSeverity.Error
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

      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 5), // Line 0 (preamble)
        'Undefined variable: spark',
        vscode.DiagnosticSeverity.Error
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

      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(3, 0, 3, 1), // Line 3 in virtual doc
        'Error on line 3',
        vscode.DiagnosticSeverity.Error
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

      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(1, 0, 1, 1),
        'Test error',
        vscode.DiagnosticSeverity.Warning
      );
      diagnostic.code = 'test-code';
      diagnostic.source = 'pyright';

      const mappedDiagnostics = mapper.mapDiagnostics(virtualDoc, [diagnostic]);
      const cellDiags = mappedDiagnostics.get(0)!;

      assert.strictEqual(cellDiags[0].message, 'Test error');
      assert.strictEqual(cellDiags[0].severity, vscode.DiagnosticSeverity.Warning);
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
        new vscode.Diagnostic(new vscode.Range(1, 0, 1, 1), 'Error 1'),
        new vscode.Diagnostic(new vscode.Range(2, 0, 2, 1), 'Error 2'),
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
        new vscode.Diagnostic(new vscode.Range(1, 0, 1, 1), 'Error in cell 0'),
        new vscode.Diagnostic(new vscode.Range(4, 0, 4, 1), 'Error in cell 1'),
      ];

      const mappedDiagnostics = mapper.mapDiagnostics(virtualDoc, diagnostics);

      assert.strictEqual(mappedDiagnostics.size, 2);
      assert.ok(mappedDiagnostics.has(0));
      assert.ok(mappedDiagnostics.has(1));
    });
  });

  describe('Integration Tests', () => {
    it('should handle cross-cell variable references', () => {
      const notebook = createMockNotebook([
        { kind: vscode.NotebookCellKind.Code, content: 'df = pd.DataFrame()', languageId: 'python' },
        { kind: vscode.NotebookCellKind.Code, content: 'print(df.head())', languageId: 'python' },
      ]);

      const generator = new VirtualDocumentGenerator('/tmp/test');
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
          kind: vscode.NotebookCellKind.Code,
          content: 'df = spark.sql("SELECT * FROM table")',
          languageId: 'python',
        },
        { kind: vscode.NotebookCellKind.Code, content: 'display(df)', languageId: 'python' },
      ]);

      const generator = new VirtualDocumentGenerator('/tmp/test');
      const virtualDoc = generator.generateDocument(notebook, true);

      // Verify preamble includes spark and display
      assert.ok(virtualDoc.content.includes('spark: SparkSession'));
      assert.ok(virtualDoc.content.includes('display: Any'));

      // Verify cells use spark and display
      assert.ok(virtualDoc.content.includes('spark.sql'));
      assert.ok(virtualDoc.content.includes('display(df)'));
    });

    it('should handle mixed cell types', () => {
      const notebook = createMockNotebook([
        { kind: vscode.NotebookCellKind.Markup, content: '# Title', languageId: 'markdown' },
        { kind: vscode.NotebookCellKind.Code, content: 'x = 1', languageId: 'python' },
        {
          kind: vscode.NotebookCellKind.Code,
          content: 'SELECT * FROM table',
          languageId: 'sql',
          metadata: { databricksType: 'sql' },
        },
        { kind: vscode.NotebookCellKind.Code, content: 'y = x + 1', languageId: 'python' },
      ]);

      const generator = new VirtualDocumentGenerator('/tmp/test');
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
 */
function createMockNotebook(
  cells: Array<{
    kind: vscode.NotebookCellKind;
    content: string;
    languageId: string;
    metadata?: Record<string, unknown>;
  }>
): vscode.NotebookDocument {
  const mockCells = cells.map((cell, index) => {
    const uri = vscode.Uri.parse(`vscode-notebook-cell:test.py#cell${index}`);
    return {
      index,
      kind: cell.kind,
      document: {
        uri,
        getText: () => cell.content,
        lineCount: cell.content.split('\n').length,
      } as Partial<vscode.TextDocument>,
      metadata: cell.metadata || {},
    } as vscode.NotebookCell;
  });

  return {
    uri: vscode.Uri.file('/test/notebook.py'),
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
  } as unknown as vscode.NotebookDocument;
}
