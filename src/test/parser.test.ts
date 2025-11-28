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
});
