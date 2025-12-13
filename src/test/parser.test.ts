/**
 * Tests for the Databricks notebook parser
 */

import * as assert from 'assert';
import {
  parseNotebook,
  isDatabricksNotebook,
  serializeNotebook,
  countCells,
  getCellTypes,
} from '../parser';

describe('Databricks Parser Tests', () => {
  describe('isDatabricksNotebook', () => {
    it('should detect Databricks notebook header', () => {
      const content = '# Databricks notebook source\n\nprint("hello")';
      assert.strictEqual(isDatabricksNotebook(content), true);
    });

    it('should not detect regular Python file', () => {
      const content = 'print("hello")';
      assert.strictEqual(isDatabricksNotebook(content), false);
    });

    it('should not detect file with similar but incorrect header', () => {
      const content = '# Databricks notebook\n\nprint("hello")';
      assert.strictEqual(isDatabricksNotebook(content), false);
    });

    it('should handle empty file', () => {
      assert.strictEqual(isDatabricksNotebook(''), false);
    });
  });

  describe('parseNotebook - Basic Parsing', () => {
    it('should parse single Python cell', () => {
      const content = `# Databricks notebook source

print("hello world")`;

      const notebook = parseNotebook(content);
      assert.strictEqual(notebook?.cells.length, 1);
      assert.strictEqual(notebook?.cells[0].type, 'code');
      assert.strictEqual(notebook?.cells[0].language, 'python');
      assert.strictEqual(notebook?.cells[0].content, 'print("hello world")');
    });

    it('should parse multiple Python cells', () => {
      const content = `# Databricks notebook source

print("cell 1")

# COMMAND ----------

print("cell 2")

# COMMAND ----------

print("cell 3")`;

      const notebook = parseNotebook(content);
      assert.strictEqual(notebook?.cells.length, 3);
      assert.strictEqual(notebook?.cells[0].content, 'print("cell 1")');
      assert.strictEqual(notebook?.cells[1].content, 'print("cell 2")');
      assert.strictEqual(notebook?.cells[2].content, 'print("cell 3")');
    });

    it('should return null for non-Databricks content', () => {
      const content = 'print("hello")';
      const notebook = parseNotebook(content);
      assert.strictEqual(notebook, null);
    });
  });

  describe('parseNotebook - Markdown Cells', () => {
    it('should parse markdown cell', () => {
      const content = `# Databricks notebook source

# MAGIC %md
# MAGIC # Title
# MAGIC Some content`;

      const notebook = parseNotebook(content);
      assert.strictEqual(notebook?.cells.length, 1);
      assert.strictEqual(notebook?.cells[0].type, 'markdown');
      assert.strictEqual(notebook?.cells[0].language, 'markdown');
      assert.ok(notebook?.cells[0].content.includes('# Title'));
      assert.ok(notebook?.cells[0].content.includes('Some content'));
    });

    it('should handle markdown with multiple paragraphs', () => {
      const content = `# Databricks notebook source

# MAGIC %md
# MAGIC # Header
# MAGIC
# MAGIC Paragraph 1
# MAGIC
# MAGIC Paragraph 2`;

      const notebook = parseNotebook(content);
      assert.strictEqual(notebook?.cells.length, 1);
      assert.ok(notebook?.cells[0].content.includes('Paragraph 1'));
      assert.ok(notebook?.cells[0].content.includes('Paragraph 2'));
    });

    it('should parse %md-sandbox as markdown', () => {
      const content = `# Databricks notebook source

# MAGIC %md-sandbox
# MAGIC # Title with sandbox`;

      const notebook = parseNotebook(content);
      assert.strictEqual(notebook?.cells.length, 1);
      assert.strictEqual(notebook?.cells[0].type, 'markdown');
    });
  });

  describe('parseNotebook - SQL Cells', () => {
    it('should parse SQL cell', () => {
      const content = `# Databricks notebook source

# MAGIC %sql
# MAGIC SELECT * FROM table
# MAGIC WHERE id = 1`;

      const notebook = parseNotebook(content);
      assert.strictEqual(notebook?.cells.length, 1);
      assert.strictEqual(notebook?.cells[0].type, 'sql');
      assert.strictEqual(notebook?.cells[0].language, 'sql');
      assert.ok(notebook?.cells[0].content.includes('SELECT * FROM table'));
    });

    it('should parse SQL cell with blank line before MAGIC command', () => {
      const content = `# Databricks notebook source

# COMMAND ----------

# MAGIC %sql
# MAGIC select COUNT(*), COUNT(distinct preference_id) from santas_reporting.preference`;

      const notebook = parseNotebook(content);
      assert.strictEqual(notebook?.cells.length, 1);
      assert.strictEqual(notebook?.cells[0].type, 'sql');
      assert.strictEqual(notebook?.cells[0].language, 'sql');
      assert.ok(notebook?.cells[0].content.includes('select COUNT(*)'));
    });

    it('should handle complex SQL queries', () => {
      const content = `# Databricks notebook source

# MAGIC %sql
# MAGIC SELECT
# MAGIC   a.column1,
# MAGIC   b.column2
# MAGIC FROM table_a a
# MAGIC JOIN table_b b ON a.id = b.id
# MAGIC WHERE a.status = 'active'`;

      const notebook = parseNotebook(content);
      assert.strictEqual(notebook?.cells[0].type, 'sql');
      assert.ok(notebook?.cells[0].content.includes('JOIN'));
    });
  });

  describe('parseNotebook - Other Languages', () => {
    it('should parse Scala cell', () => {
      const content = `# Databricks notebook source

# MAGIC %scala
# MAGIC val x = 1
# MAGIC println(x)`;

      const notebook = parseNotebook(content);
      assert.strictEqual(notebook?.cells[0].type, 'scala');
      assert.strictEqual(notebook?.cells[0].language, 'scala');
    });

    it('should parse R cell', () => {
      const content = `# Databricks notebook source

# MAGIC %r
# MAGIC x <- c(1, 2, 3)
# MAGIC print(x)`;

      const notebook = parseNotebook(content);
      assert.strictEqual(notebook?.cells[0].type, 'r');
      assert.strictEqual(notebook?.cells[0].language, 'r');
    });

    it('should parse shell cell', () => {
      const content = `# Databricks notebook source

# MAGIC %sh
# MAGIC ls -la
# MAGIC pwd`;

      const notebook = parseNotebook(content);
      assert.strictEqual(notebook?.cells[0].type, 'shell');
      assert.strictEqual(notebook?.cells[0].language, 'shellscript');
    });
  });

  describe('parseNotebook - Special Commands', () => {
    it('should parse %run command', () => {
      const content = `# Databricks notebook source

# MAGIC %run ./other_notebook`;

      const notebook = parseNotebook(content);
      assert.strictEqual(notebook?.cells[0].type, 'run');
    });

    it('should parse %pip command', () => {
      const content = `# Databricks notebook source

# MAGIC %pip install pandas numpy`;

      const notebook = parseNotebook(content);
      assert.strictEqual(notebook?.cells[0].type, 'pip');
    });

    it('should parse %fs command', () => {
      const content = `# Databricks notebook source

# MAGIC %fs ls /mnt/data`;

      const notebook = parseNotebook(content);
      assert.strictEqual(notebook?.cells[0].type, 'fs');
    });
  });

  describe('parseNotebook - Cell Titles', () => {
    it('should parse DBTITLE', () => {
      const content = `# Databricks notebook source

# DBTITLE 0,My Cell Title
print("hello")`;

      const notebook = parseNotebook(content);
      assert.strictEqual(notebook?.cells[0].title, 'My Cell Title');
      assert.strictEqual(notebook?.cells[0].content, 'print("hello")');
    });

    it('should handle DBTITLE with value 1', () => {
      const content = `# Databricks notebook source

# DBTITLE 1,Another Title
print("world")`;

      const notebook = parseNotebook(content);
      assert.strictEqual(notebook?.cells[0].title, 'Another Title');
    });
  });

  describe('parseNotebook - Mixed Content', () => {
    it('should parse notebook with mixed cell types', () => {
      const content = `# Databricks notebook source

# MAGIC %md
# MAGIC # Introduction

# COMMAND ----------

print("Python code")

# COMMAND ----------

# MAGIC %sql
# MAGIC SELECT 1

# COMMAND ----------

# MAGIC %sh
# MAGIC echo "hello"`;

      const notebook = parseNotebook(content);
      assert.strictEqual(notebook?.cells.length, 4);
      assert.strictEqual(notebook?.cells[0].type, 'markdown');
      assert.strictEqual(notebook?.cells[1].type, 'code');
      assert.strictEqual(notebook?.cells[2].type, 'sql');
      assert.strictEqual(notebook?.cells[3].type, 'shell');
    });
  });

  describe('serializeNotebook', () => {
    it('should serialize Python cell', () => {
      const cells = [
        {
          type: 'code' as const,
          content: 'print("hello")',
          language: 'python',
          originalLines: [],
        },
      ];

      const result = serializeNotebook(cells);
      assert.ok(result.includes('# Databricks notebook source'));
      assert.ok(result.includes('print("hello")'));
    });

    it('should serialize markdown cell with MAGIC prefix', () => {
      const cells = [
        {
          type: 'markdown' as const,
          content: '# Title\nSome content',
          language: 'markdown',
          originalLines: [],
        },
      ];

      const result = serializeNotebook(cells);
      assert.ok(result.includes('# MAGIC %md'));
      assert.ok(result.includes('# MAGIC # Title'));
      assert.ok(result.includes('# MAGIC Some content'));
    });

    it('should add cell delimiter between cells', () => {
      const cells = [
        {
          type: 'code' as const,
          content: 'cell1',
          language: 'python',
          originalLines: [],
        },
        {
          type: 'code' as const,
          content: 'cell2',
          language: 'python',
          originalLines: [],
        },
      ];

      const result = serializeNotebook(cells);
      assert.ok(result.includes('# COMMAND ----------'));
    });

    it('should include cell title', () => {
      const cells = [
        {
          type: 'code' as const,
          content: 'print("hello")',
          title: 'My Title',
          language: 'python',
          originalLines: [],
        },
      ];

      const result = serializeNotebook(cells);
      assert.ok(result.includes('# DBTITLE 0,My Title'));
    });

    it('should serialize SQL cell with %sql prefix when content does not include it', () => {
      const cells = [
        {
          type: 'sql' as const,
          content: 'SELECT * FROM table',
          language: 'sql',
          originalLines: [],
        },
      ];

      const result = serializeNotebook(cells);
      assert.ok(result.includes('# MAGIC %sql'));
      assert.ok(result.includes('# MAGIC SELECT * FROM table'));
      // Verify %sql appears on its own line before the SQL content
      const lines = result.split('\n');
      const sqlMagicIndex = lines.findIndex(l => l === '# MAGIC %sql');
      const selectIndex = lines.findIndex(l => l === '# MAGIC SELECT * FROM table');
      assert.ok(sqlMagicIndex >= 0, 'Should have # MAGIC %sql line');
      assert.ok(selectIndex > sqlMagicIndex, 'SELECT should appear after %sql');
    });

    it('should not duplicate %sql when content already includes it', () => {
      const cells = [
        {
          type: 'sql' as const,
          content: '%sql\nSELECT * FROM table',
          language: 'sql',
          originalLines: [],
        },
      ];

      const result = serializeNotebook(cells);
      // Count occurrences of %sql
      const sqlCount = (result.match(/# MAGIC %sql/g) || []).length;
      assert.strictEqual(sqlCount, 1, 'Should have exactly one # MAGIC %sql');
    });

    it('should serialize shell cell with %sh prefix when content does not include it', () => {
      const cells = [
        {
          type: 'shell' as const,
          content: 'ls -la',
          language: 'shellscript',
          originalLines: [],
        },
      ];

      const result = serializeNotebook(cells);
      assert.ok(result.includes('# MAGIC %sh'));
      assert.ok(result.includes('# MAGIC ls -la'));
    });
  });

  describe('Round-trip Parsing', () => {
    it('should preserve content through parse and serialize', () => {
      const original = `# Databricks notebook source

# MAGIC %md
# MAGIC # Title

# COMMAND ----------

print("hello")

# COMMAND ----------

# MAGIC %sql
# MAGIC SELECT 1`;

      const notebook = parseNotebook(original);
      assert.ok(notebook);

      const serialized = serializeNotebook(notebook.cells);
      const reparsed = parseNotebook(serialized);

      assert.strictEqual(reparsed?.cells.length, notebook.cells.length);
      assert.strictEqual(reparsed?.cells[0].type, notebook.cells[0].type);
      assert.strictEqual(reparsed?.cells[1].type, notebook.cells[1].type);
      assert.strictEqual(reparsed?.cells[2].type, notebook.cells[2].type);
    });
  });

  describe('Utility Functions', () => {
    it('countCells should return correct count', () => {
      const content = `# Databricks notebook source

cell1

# COMMAND ----------

cell2

# COMMAND ----------

cell3`;

      assert.strictEqual(countCells(content), 3);
    });

    it('countCells should return 0 for non-notebook', () => {
      assert.strictEqual(countCells('regular python'), 0);
    });

    it('getCellTypes should return array of types', () => {
      const content = `# Databricks notebook source

# MAGIC %md
# MAGIC Title

# COMMAND ----------

print("hello")

# COMMAND ----------

# MAGIC %sql
# MAGIC SELECT 1`;

      const types = getCellTypes(content);
      assert.deepStrictEqual(types, ['markdown', 'code', 'sql']);
    });
  });

  describe('Edge Cases - Empty and Whitespace', () => {
    it('should handle notebook with only header', () => {
      const content = '# Databricks notebook source';
      const notebook = parseNotebook(content);
      assert.ok(notebook);
      assert.strictEqual(notebook?.cells.length, 0);
    });

    it('should handle notebook with empty cells', () => {
      const content = `# Databricks notebook source

# COMMAND ----------

# COMMAND ----------

print("hello")`;

      const notebook = parseNotebook(content);
      assert.ok(notebook);
      // Empty cells are filtered out, only the cell with content remains
      assert.strictEqual(notebook?.cells.length, 1);
      assert.strictEqual(notebook?.cells[0].content, 'print("hello")');
    });

    it('should handle cells with only whitespace', () => {
      const content = `# Databricks notebook source



# COMMAND ----------

print("hello")`;

      const notebook = parseNotebook(content);
      assert.ok(notebook);
      assert.strictEqual(notebook?.cells.length, 1);
    });

    it('should handle multiple blank lines between cells', () => {
      const content = `# Databricks notebook source

print("cell1")



# COMMAND ----------



print("cell2")`;

      const notebook = parseNotebook(content);
      assert.strictEqual(notebook?.cells.length, 2);
      assert.strictEqual(notebook?.cells[0].content, 'print("cell1")');
      assert.strictEqual(notebook?.cells[1].content, 'print("cell2")');
    });
  });

  describe('Edge Cases - Magic Command Priority', () => {
    it('should match %run before %r', () => {
      const content = `# Databricks notebook source

# MAGIC %run ./notebook`;

      const notebook = parseNotebook(content);
      assert.strictEqual(notebook?.cells[0].type, 'run');
      assert.ok(notebook?.cells[0].content.includes('%run'));
    });

    it('should match %r correctly when not %run', () => {
      const content = `# Databricks notebook source

# MAGIC %r
# MAGIC x <- 1`;

      const notebook = parseNotebook(content);
      assert.strictEqual(notebook?.cells[0].type, 'r');
      assert.strictEqual(notebook?.cells[0].language, 'r');
    });

    it('should match %md-sandbox before %md', () => {
      const content = `# Databricks notebook source

# MAGIC %md-sandbox
# MAGIC <style>custom</style>
# MAGIC # Title`;

      const notebook = parseNotebook(content);
      assert.strictEqual(notebook?.cells[0].type, 'markdown');
      // Content should not include %md-sandbox
      assert.ok(!notebook?.cells[0].content.includes('%md-sandbox'));
    });
  });

  describe('Edge Cases - Special Characters', () => {
    it('should preserve backslashes in Python code', () => {
      const content = `# Databricks notebook source

import re
pattern = r'[a-z\\d]+'`;

      const notebook = parseNotebook(content);
      assert.ok(notebook?.cells[0].content.includes('\\d'));
    });

    it('should preserve backslashes in SQL cells', () => {
      const content = `# Databricks notebook source

# MAGIC %sql
# MAGIC SELECT * FROM t WHERE col RLIKE '[\\d]+'`;

      const notebook = parseNotebook(content);
      assert.ok(notebook?.cells[0].content.includes('[\\d]'));
    });

    it('should preserve regex patterns in SQL', () => {
      const content = `# Databricks notebook source

# MAGIC %sql
# MAGIC SELECT * FROM t WHERE col RLIKE '[^ A-Za-z0-9&\\'(),\\-./\\[\\]_:#]'`;

      const notebook = parseNotebook(content);
      assert.ok(notebook?.cells[0].content.includes('RLIKE'));
      assert.ok(notebook?.cells[0].content.includes('[^'));
    });

    it('should preserve triple quotes in Python', () => {
      const content = `# Databricks notebook source

text = """
multiline
string
"""`;

      const notebook = parseNotebook(content);
      assert.ok(notebook?.cells[0].content.includes('"""'));
    });

    it('should handle SQL with single quotes', () => {
      const content = `# Databricks notebook source

# MAGIC %sql
# MAGIC SELECT * FROM t WHERE name = 'O\\'Brien'`;

      const notebook = parseNotebook(content);
      assert.ok(notebook?.cells[0].content.includes("O\\'Brien"));
    });

    it('should preserve unicode characters', () => {
      const content = `# Databricks notebook source

# MAGIC %md
# MAGIC # Hello World \u4e16\u754c
# MAGIC Emoji: \ud83d\ude00`;

      const notebook = parseNotebook(content);
      assert.ok(notebook?.cells[0].content.includes('\u4e16\u754c'));
    });
  });

  describe('Edge Cases - DBTITLE Variations', () => {
    it('should handle DBTITLE with special characters', () => {
      const content = `# Databricks notebook source

# DBTITLE 0,My "Special" Title: Test & More!
print("hello")`;

      const notebook = parseNotebook(content);
      assert.strictEqual(notebook?.cells[0].title, 'My "Special" Title: Test & More!');
    });

    it('should handle DBTITLE with empty content after', () => {
      const content = `# Databricks notebook source

# DBTITLE 0,Empty Cell Title`;

      const notebook = parseNotebook(content);
      // Cell with only title, treated as empty Python cell
      assert.strictEqual(notebook?.cells[0].title, 'Empty Cell Title');
      assert.strictEqual(notebook?.cells[0].type, 'code');
    });

    it('should handle DBTITLE followed by MAGIC command', () => {
      const content = `# Databricks notebook source

# DBTITLE 0,SQL Query
# MAGIC %sql
# MAGIC SELECT 1`;

      const notebook = parseNotebook(content);
      assert.strictEqual(notebook?.cells[0].title, 'SQL Query');
      assert.strictEqual(notebook?.cells[0].type, 'sql');
    });
  });

  describe('Edge Cases - Bare MAGIC Lines', () => {
    it('should handle bare # MAGIC (no trailing space) as blank line', () => {
      const content = `# Databricks notebook source

# MAGIC %md
# MAGIC # Title
# MAGIC
# MAGIC Content after blank`;

      const notebook = parseNotebook(content);
      const lines = notebook?.cells[0].content.split('\n') || [];
      // Should have an empty line between Title and Content
      assert.ok(lines.some(line => line === ''));
      assert.ok(lines.some(line => line.includes('Title')));
      assert.ok(lines.some(line => line.includes('Content after blank')));
    });

    it('should handle bare # MAGIC with Windows line endings (CRLF)', () => {
      // Windows CRLF line endings - the bare # MAGIC becomes # MAGIC\r when split by \n
      // This was causing # MAGIC to be rendered as "MAGIC" header in markdown
      const content = '# Databricks notebook source\r\n\r\n# MAGIC %md\r\n# MAGIC # Title\r\n# MAGIC\r\n# MAGIC Content after blank';

      const notebook = parseNotebook(content);
      assert.ok(notebook);
      assert.strictEqual(notebook?.cells.length, 1);
      assert.strictEqual(notebook?.cells[0].type, 'markdown');

      const lines = notebook?.cells[0].content.split('\n') || [];
      // Should have an empty line between Title and Content (not "MAGIC" text)
      assert.ok(lines.some(line => line === ''), 'Should have empty line for blank # MAGIC');
      assert.ok(lines.some(line => line.includes('# Title')));
      assert.ok(lines.some(line => line.includes('Content after blank')));
      // Make sure # MAGIC didn't leak through as text
      assert.ok(!lines.some(line => line.includes('MAGIC') && !line.includes('#')),
        'Should not have bare "MAGIC" text in content');
    });
  });

  describe('Serialization Edge Cases', () => {
    it('should serialize SQL cell with special characters', () => {
      const cells = [
        {
          type: 'sql' as const,
          content: "%sql\nSELECT * FROM t WHERE col RLIKE '[\\\\d]+'",
          language: 'sql',
          originalLines: [],
        },
      ];

      const result = serializeNotebook(cells);
      assert.ok(result.includes('# MAGIC %sql'));
      assert.ok(result.includes('RLIKE'));
    });

    it('should serialize cell with unicode', () => {
      const cells = [
        {
          type: 'markdown' as const,
          content: '# Hello \u4e16\u754c',
          language: 'markdown',
          originalLines: [],
        },
      ];

      const result = serializeNotebook(cells);
      assert.ok(result.includes('\u4e16\u754c'));
    });

    it('should preserve original lines for unmodified cells', () => {
      const originalLines = [
        '# COMMAND ----------',
        '',
        '# DBTITLE 0,My Title',
        'print("original")',
      ];

      const cells = [
        {
          type: 'code' as const,
          content: 'print("original")',
          title: 'My Title',
          language: 'python',
          originalLines: originalLines,
        },
      ];

      const result = serializeNotebook(cells);
      // Should contain the exact original lines
      assert.ok(result.includes('# DBTITLE 0,My Title'));
      assert.ok(result.includes('print("original")'));
    });

    it('should handle empty cells array', () => {
      const result = serializeNotebook([]);
      assert.strictEqual(result, '# Databricks notebook source');
    });
  });

  describe('Complex Notebooks', () => {
    it('should parse notebook with all cell types', () => {
      const content = `# Databricks notebook source

# MAGIC %md
# MAGIC # Documentation

# COMMAND ----------

print("python")

# COMMAND ----------

# MAGIC %sql
# MAGIC SELECT 1

# COMMAND ----------

# MAGIC %scala
# MAGIC val x = 1

# COMMAND ----------

# MAGIC %r
# MAGIC x <- 1

# COMMAND ----------

# MAGIC %sh
# MAGIC ls -la

# COMMAND ----------

# MAGIC %fs
# MAGIC ls /mnt

# COMMAND ----------

# MAGIC %run
# MAGIC ./setup

# COMMAND ----------

# MAGIC %pip
# MAGIC install pandas`;

      const notebook = parseNotebook(content);
      assert.strictEqual(notebook?.cells.length, 9);

      const types = notebook?.cells.map(c => c.type);
      assert.deepStrictEqual(types, [
        'markdown', 'code', 'sql', 'scala', 'r', 'shell', 'fs', 'run', 'pip'
      ]);
    });

    it('should handle notebook with Windows line endings', () => {
      const content = '# Databricks notebook source\r\n\r\nprint("hello")\r\n\r\n# COMMAND ----------\r\n\r\nprint("world")';

      const notebook = parseNotebook(content);
      assert.strictEqual(notebook?.cells.length, 2);
    });
  });

  describe('Error Handling', () => {
    it('should return null for null input', () => {
      // @ts-expect-error Testing invalid input
      const notebook = parseNotebook(null);
      assert.strictEqual(notebook, null);
    });

    it('should return null for undefined input', () => {
      // @ts-expect-error Testing invalid input
      const notebook = parseNotebook(undefined);
      assert.strictEqual(notebook, null);
    });

    it('should handle malformed DBTITLE', () => {
      const content = `# Databricks notebook source

# DBTITLE invalid format
print("hello")`;

      const notebook = parseNotebook(content);
      // Should still parse but without title
      assert.ok(notebook);
      assert.strictEqual(notebook?.cells[0].title, undefined);
    });
  });
});
