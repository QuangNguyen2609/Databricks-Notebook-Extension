/**
 * Tests for the Databricks notebook serializer
 */

import * as assert from 'assert';
import * as path from 'path';

// Mock VS Code API before importing serializer
const mockVscode = {
  NotebookCellKind: {
    Markup: 1,
    Code: 2,
  },
  NotebookCellData: class {
    kind: number;
    value: string;
    languageId: string;
    metadata?: Record<string, unknown>;

    constructor(kind: number, value: string, languageId: string) {
      this.kind = kind;
      this.value = value;
      this.languageId = languageId;
    }
  },
  NotebookData: class {
    cells: unknown[];
    metadata?: Record<string, unknown>;

    constructor(cells: unknown[]) {
      this.cells = cells;
    }
  },
  CancellationToken: {},
  workspace: {
    fs: {
      readFile: async (uri: { fsPath: string }) => {
        // This will be overridden in specific tests
        throw new Error('Not implemented');
      },
    },
  },
  Uri: {
    file: (filePath: string) => ({ fsPath: filePath, toString: () => `file://${filePath}` }),
  },
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
import Module from 'module';
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id: string) {
  if (id === 'vscode') {
    return mockVscode;
  }
  return originalRequire.apply(this, [id]);
};

// Now import the serializer
import { DatabricksNotebookSerializer, checkIsDatabricksNotebook, getNotebookStats } from '../serializer';

describe('Serializer Tests', () => {
  describe('DatabricksNotebookSerializer', () => {
    let serializer: DatabricksNotebookSerializer;

    beforeEach(() => {
      serializer = new DatabricksNotebookSerializer();
    });

    describe('deserializeNotebook', () => {
      it('should deserialize a simple notebook', async () => {
        const content = `# Databricks notebook source

print("hello world")`;

        const bytes = new TextEncoder().encode(content);
        const token = {} as never;

        const notebook = await serializer.deserializeNotebook(bytes, token);

        assert.strictEqual(notebook.cells.length, 1);
        assert.strictEqual(notebook.cells[0].value, 'print("hello world")');
        assert.strictEqual(notebook.cells[0].languageId, 'python');
      });

      it('should deserialize notebook with multiple cells', async () => {
        const content = `# Databricks notebook source

print("cell 1")

# COMMAND ----------

print("cell 2")`;

        const bytes = new TextEncoder().encode(content);
        const token = {} as never;

        const notebook = await serializer.deserializeNotebook(bytes, token);

        assert.strictEqual(notebook.cells.length, 2);
        assert.strictEqual(notebook.cells[0].value, 'print("cell 1")');
        assert.strictEqual(notebook.cells[1].value, 'print("cell 2")');
      });

      it('should deserialize markdown cells as markup kind', async () => {
        const content = `# Databricks notebook source

# MAGIC %md
# MAGIC # Title`;

        const bytes = new TextEncoder().encode(content);
        const token = {} as never;

        const notebook = await serializer.deserializeNotebook(bytes, token);

        assert.strictEqual(notebook.cells.length, 1);
        assert.strictEqual(notebook.cells[0].kind, mockVscode.NotebookCellKind.Markup);
        assert.strictEqual(notebook.cells[0].languageId, 'markdown');
      });

      it('should deserialize SQL cells as code kind', async () => {
        const content = `# Databricks notebook source

# MAGIC %sql
# MAGIC SELECT * FROM table`;

        const bytes = new TextEncoder().encode(content);
        const token = {} as never;

        const notebook = await serializer.deserializeNotebook(bytes, token);

        assert.strictEqual(notebook.cells.length, 1);
        assert.strictEqual(notebook.cells[0].kind, mockVscode.NotebookCellKind.Code);
        assert.strictEqual(notebook.cells[0].languageId, 'sql');
      });

      it('should return empty notebook for non-Databricks content', async () => {
        const content = `print("regular python file")`;

        const bytes = new TextEncoder().encode(content);
        const token = {} as never;

        const notebook = await serializer.deserializeNotebook(bytes, token);

        assert.strictEqual(notebook.cells.length, 0);
      });

      it('should preserve metadata for round-trip', async () => {
        const content = `# Databricks notebook source

print("test")`;

        const bytes = new TextEncoder().encode(content);
        const token = {} as never;

        const notebook = await serializer.deserializeNotebook(bytes, token);

        assert.ok(notebook.cells[0].metadata);
        assert.strictEqual(notebook.cells[0].metadata.databricksType, 'code');
        assert.strictEqual(notebook.cells[0].metadata.originalContent, 'print("test")');
      });

      it('should set default language in notebook metadata', async () => {
        const content = `# Databricks notebook source

print("test")`;

        const bytes = new TextEncoder().encode(content);
        const token = {} as never;

        const notebook = await serializer.deserializeNotebook(bytes, token);

        assert.strictEqual(notebook.metadata?.defaultLanguage, 'python');
      });
    });

    describe('serializeNotebook', () => {
      it('should serialize a simple notebook', async () => {
        const cellData = new mockVscode.NotebookCellData(
          mockVscode.NotebookCellKind.Code,
          'print("hello")',
          'python'
        );
        cellData.metadata = { databricksType: 'code' };

        const notebookData = new mockVscode.NotebookData([cellData]);
        const token = {} as never;

        const bytes = await serializer.serializeNotebook(notebookData as never, token);
        const content = new TextDecoder().decode(bytes);

        assert.ok(content.includes('# Databricks notebook source'));
        assert.ok(content.includes('print("hello")'));
      });

      it('should serialize multiple cells with delimiters', async () => {
        const cell1 = new mockVscode.NotebookCellData(
          mockVscode.NotebookCellKind.Code,
          'print("cell 1")',
          'python'
        );
        cell1.metadata = { databricksType: 'code' };

        const cell2 = new mockVscode.NotebookCellData(
          mockVscode.NotebookCellKind.Code,
          'print("cell 2")',
          'python'
        );
        cell2.metadata = { databricksType: 'code' };

        const notebookData = new mockVscode.NotebookData([cell1, cell2]);
        const token = {} as never;

        const bytes = await serializer.serializeNotebook(notebookData as never, token);
        const content = new TextDecoder().decode(bytes);

        assert.ok(content.includes('# COMMAND ----------'));
      });

      it('should serialize markdown cells with MAGIC prefix', async () => {
        const cellData = new mockVscode.NotebookCellData(
          mockVscode.NotebookCellKind.Markup,
          '# Title\n\nContent',
          'markdown'
        );
        cellData.metadata = { databricksType: 'markdown' };

        const notebookData = new mockVscode.NotebookData([cellData]);
        const token = {} as never;

        const bytes = await serializer.serializeNotebook(notebookData as never, token);
        const content = new TextDecoder().decode(bytes);

        assert.ok(content.includes('# MAGIC %md'));
        assert.ok(content.includes('# MAGIC # Title'));
      });

      it('should serialize SQL cells with MAGIC prefix', async () => {
        const cellData = new mockVscode.NotebookCellData(
          mockVscode.NotebookCellKind.Code,
          '%sql\nSELECT * FROM table',
          'sql'
        );
        cellData.metadata = { databricksType: 'sql' };

        const notebookData = new mockVscode.NotebookData([cellData]);
        const token = {} as never;

        const bytes = await serializer.serializeNotebook(notebookData as never, token);
        const content = new TextDecoder().decode(bytes);

        assert.ok(content.includes('# MAGIC %sql'));
        assert.ok(content.includes('SELECT * FROM table'));
      });

      it('should preserve original lines for unmodified cells', async () => {
        const originalLines = [
          '# COMMAND ----------',
          '',
          'print("original")',
          ''
        ];

        const cellData = new mockVscode.NotebookCellData(
          mockVscode.NotebookCellKind.Code,
          'print("original")',
          'python'
        );
        cellData.metadata = {
          databricksType: 'code',
          originalLines: originalLines,
          originalContent: 'print("original")'
        };

        const notebookData = new mockVscode.NotebookData([cellData]);
        const token = {} as never;

        const bytes = await serializer.serializeNotebook(notebookData as never, token);
        const content = new TextDecoder().decode(bytes);

        // Should use original lines exactly
        for (const line of originalLines) {
          assert.ok(content.includes(line), `Should include original line: "${line}"`);
        }
      });
    });
  });

  describe('checkIsDatabricksNotebook', () => {
    it('should return true for valid Databricks notebook', async () => {
      const content = '# Databricks notebook source\n\nprint("hello")';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockVscode.workspace.fs as any).readFile = async () => new TextEncoder().encode(content);

      const result = await checkIsDatabricksNotebook(mockVscode.Uri.file('/test/notebook.py') as never);

      assert.strictEqual(result, true);
    });

    it('should return false for regular Python file', async () => {
      const content = 'print("hello")';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockVscode.workspace.fs as any).readFile = async () => new TextEncoder().encode(content);

      const result = await checkIsDatabricksNotebook(mockVscode.Uri.file('/test/script.py') as never);

      assert.strictEqual(result, false);
    });

    it('should return false on read error', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockVscode.workspace.fs as any).readFile = async () => {
        throw new Error('File not found');
      };

      const result = await checkIsDatabricksNotebook(mockVscode.Uri.file('/test/nonexistent.py') as never);

      assert.strictEqual(result, false);
    });
  });

  describe('getNotebookStats', () => {
    it('should return correct cell count and types', async () => {
      const content = `# Databricks notebook source

print("python cell")

# COMMAND ----------

# MAGIC %sql
# MAGIC SELECT * FROM table

# COMMAND ----------

# MAGIC %md
# MAGIC # Title`;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockVscode.workspace.fs as any).readFile = async () => new TextEncoder().encode(content);

      const stats = await getNotebookStats(mockVscode.Uri.file('/test/notebook.py') as never);

      assert.ok(stats);
      assert.strictEqual(stats.cellCount, 3);
      assert.strictEqual(stats.types['code'], 1);
      assert.strictEqual(stats.types['sql'], 1);
      assert.strictEqual(stats.types['markdown'], 1);
    });

    it('should return null for non-Databricks file', async () => {
      const content = 'print("hello")';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockVscode.workspace.fs as any).readFile = async () => new TextEncoder().encode(content);

      const stats = await getNotebookStats(mockVscode.Uri.file('/test/script.py') as never);

      assert.strictEqual(stats, null);
    });

    it('should return null on read error', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockVscode.workspace.fs as any).readFile = async () => {
        throw new Error('File not found');
      };

      const stats = await getNotebookStats(mockVscode.Uri.file('/test/nonexistent.py') as never);

      assert.strictEqual(stats, null);
    });
  });

  describe('Cell Type Inference', () => {
    let serializer: DatabricksNotebookSerializer;

    beforeEach(() => {
      serializer = new DatabricksNotebookSerializer();
    });

    it('should infer sql type from sql language', async () => {
      const content = `# Databricks notebook source

# MAGIC %sql
# MAGIC SELECT * FROM table`;

      const bytes = new TextEncoder().encode(content);
      const token = {} as never;

      const notebook = await serializer.deserializeNotebook(bytes, token);
      // The metadata should contain sql type
      assert.strictEqual(notebook.cells[0].metadata?.databricksType, 'sql');
    });

    it('should infer markdown type from markup cells', async () => {
      const content = `# Databricks notebook source

# MAGIC %md
# MAGIC # Heading`;

      const bytes = new TextEncoder().encode(content);
      const token = {} as never;

      const notebook = await serializer.deserializeNotebook(bytes, token);
      assert.strictEqual(notebook.cells[0].metadata?.databricksType, 'markdown');
    });
  });
});
