/**
 * Tests for the shared constants module
 */

import * as assert from 'assert';
import {
  DATABRICKS_NOTEBOOK_HEADER,
  CELL_DELIMITER,
  MAGIC_PREFIX,
  MAGIC_PREFIX_BARE,
  TITLE_PREFIX,
  MAGIC_COMMANDS,
  SORTED_MAGIC_COMMANDS,
  LANGUAGE_TO_MAGIC,
  MAGIC_TO_CELL_TYPE,
  CELL_TYPE_TO_MAGIC,
  SQL_KEYWORDS_REGEX,
  contentStartsWithMagic,
  findMagicCommand,
  getMagicCommandForType,
} from '../constants';

describe('Constants Module Tests', () => {
  describe('Notebook Format Constants', () => {
    it('should have correct notebook header', () => {
      assert.strictEqual(DATABRICKS_NOTEBOOK_HEADER, '# Databricks notebook source');
    });

    it('should have correct cell delimiter', () => {
      assert.strictEqual(CELL_DELIMITER, '# COMMAND ----------');
    });

    it('should have correct magic prefix with trailing space', () => {
      assert.strictEqual(MAGIC_PREFIX, '# MAGIC ');
    });

    it('should have correct bare magic prefix without trailing space', () => {
      assert.strictEqual(MAGIC_PREFIX_BARE, '# MAGIC');
    });

    it('should have correct title prefix', () => {
      assert.strictEqual(TITLE_PREFIX, '# DBTITLE ');
    });
  });

  describe('MAGIC_COMMANDS', () => {
    it('should contain all magic commands', () => {
      const expectedCommands = [
        '%md-sandbox', '%md', '%sql', '%scala', '%python',
        '%sh', '%fs', '%run', '%pip', '%r'
      ];

      for (const cmd of expectedCommands) {
        assert.ok(MAGIC_COMMANDS[cmd], `Missing magic command: ${cmd}`);
      }
    });

    it('should map %md to markdown type', () => {
      assert.strictEqual(MAGIC_COMMANDS['%md'].type, 'markdown');
      assert.strictEqual(MAGIC_COMMANDS['%md'].language, 'markdown');
    });

    it('should map %md-sandbox to markdown type', () => {
      assert.strictEqual(MAGIC_COMMANDS['%md-sandbox'].type, 'markdown');
      assert.strictEqual(MAGIC_COMMANDS['%md-sandbox'].language, 'markdown');
    });

    it('should map %sql to sql type', () => {
      assert.strictEqual(MAGIC_COMMANDS['%sql'].type, 'sql');
      assert.strictEqual(MAGIC_COMMANDS['%sql'].language, 'sql');
    });

    it('should map %python to code type', () => {
      assert.strictEqual(MAGIC_COMMANDS['%python'].type, 'code');
      assert.strictEqual(MAGIC_COMMANDS['%python'].language, 'python');
    });

    it('should map %sh to shell type', () => {
      assert.strictEqual(MAGIC_COMMANDS['%sh'].type, 'shell');
      assert.strictEqual(MAGIC_COMMANDS['%sh'].language, 'shellscript');
    });

    it('should map %r to r type', () => {
      assert.strictEqual(MAGIC_COMMANDS['%r'].type, 'r');
      assert.strictEqual(MAGIC_COMMANDS['%r'].language, 'r');
    });
  });

  describe('SORTED_MAGIC_COMMANDS', () => {
    it('should be sorted by length (longest first)', () => {
      for (let i = 0; i < SORTED_MAGIC_COMMANDS.length - 1; i++) {
        assert.ok(
          SORTED_MAGIC_COMMANDS[i].length >= SORTED_MAGIC_COMMANDS[i + 1].length,
          `${SORTED_MAGIC_COMMANDS[i]} should come before ${SORTED_MAGIC_COMMANDS[i + 1]}`
        );
      }
    });

    it('should have %md-sandbox before %md', () => {
      const mdSandboxIndex = SORTED_MAGIC_COMMANDS.indexOf('%md-sandbox');
      const mdIndex = SORTED_MAGIC_COMMANDS.indexOf('%md');
      assert.ok(mdSandboxIndex < mdIndex, '%md-sandbox should come before %md');
    });

    it('should have %run before %r', () => {
      const runIndex = SORTED_MAGIC_COMMANDS.indexOf('%run');
      const rIndex = SORTED_MAGIC_COMMANDS.indexOf('%r');
      assert.ok(runIndex < rIndex, '%run should come before %r');
    });
  });

  describe('LANGUAGE_TO_MAGIC', () => {
    it('should map sql to %sql', () => {
      assert.strictEqual(LANGUAGE_TO_MAGIC['sql'], '%sql');
    });

    it('should map scala to %scala', () => {
      assert.strictEqual(LANGUAGE_TO_MAGIC['scala'], '%scala');
    });

    it('should map r to %r', () => {
      assert.strictEqual(LANGUAGE_TO_MAGIC['r'], '%r');
    });

    it('should map shellscript to %sh', () => {
      assert.strictEqual(LANGUAGE_TO_MAGIC['shellscript'], '%sh');
    });
  });

  describe('MAGIC_TO_CELL_TYPE', () => {
    it('should map %sql to sql', () => {
      assert.strictEqual(MAGIC_TO_CELL_TYPE['%sql'], 'sql');
    });

    it('should map %scala to scala', () => {
      assert.strictEqual(MAGIC_TO_CELL_TYPE['%scala'], 'scala');
    });

    it('should map %md to markdown', () => {
      assert.strictEqual(MAGIC_TO_CELL_TYPE['%md'], 'markdown');
    });

    it('should map %sh to shell', () => {
      assert.strictEqual(MAGIC_TO_CELL_TYPE['%sh'], 'shell');
    });
  });

  describe('CELL_TYPE_TO_MAGIC', () => {
    it('should map code to %python', () => {
      assert.strictEqual(CELL_TYPE_TO_MAGIC['code'], '%python');
    });

    it('should map markdown to %md', () => {
      assert.strictEqual(CELL_TYPE_TO_MAGIC['markdown'], '%md');
    });

    it('should map sql to %sql', () => {
      assert.strictEqual(CELL_TYPE_TO_MAGIC['sql'], '%sql');
    });

    it('should map shell to %sh', () => {
      assert.strictEqual(CELL_TYPE_TO_MAGIC['shell'], '%sh');
    });

    it('should map all cell types', () => {
      const cellTypes = ['code', 'markdown', 'sql', 'scala', 'r', 'shell', 'fs', 'run', 'pip'] as const;
      for (const type of cellTypes) {
        assert.ok(CELL_TYPE_TO_MAGIC[type], `Missing mapping for cell type: ${type}`);
      }
    });
  });

  describe('SQL_KEYWORDS_REGEX', () => {
    it('should match SELECT at start', () => {
      assert.ok(SQL_KEYWORDS_REGEX.test('SELECT * FROM table'));
    });

    it('should match INSERT at start', () => {
      assert.ok(SQL_KEYWORDS_REGEX.test('INSERT INTO table VALUES (1)'));
    });

    it('should match UPDATE at start', () => {
      assert.ok(SQL_KEYWORDS_REGEX.test('UPDATE table SET col = 1'));
    });

    it('should match DELETE at start', () => {
      assert.ok(SQL_KEYWORDS_REGEX.test('DELETE FROM table WHERE id = 1'));
    });

    it('should match CREATE at start', () => {
      assert.ok(SQL_KEYWORDS_REGEX.test('CREATE TABLE test (id INT)'));
    });

    it('should match WITH at start', () => {
      assert.ok(SQL_KEYWORDS_REGEX.test('WITH cte AS (SELECT 1) SELECT * FROM cte'));
    });

    it('should match DESCRIBE at start', () => {
      assert.ok(SQL_KEYWORDS_REGEX.test('DESCRIBE TABLE test'));
    });

    it('should match SHOW at start', () => {
      assert.ok(SQL_KEYWORDS_REGEX.test('SHOW TABLES'));
    });

    it('should match case-insensitively', () => {
      assert.ok(SQL_KEYWORDS_REGEX.test('select * from table'));
      assert.ok(SQL_KEYWORDS_REGEX.test('Select * From table'));
    });

    it('should not match SQL keyword in middle of text', () => {
      assert.ok(!SQL_KEYWORDS_REGEX.test('print("SELECT")'));
    });

    it('should not match partial keyword', () => {
      assert.ok(!SQL_KEYWORDS_REGEX.test('SELECTION is not valid'));
    });

    it('should match keyword followed by whitespace', () => {
      assert.ok(SQL_KEYWORDS_REGEX.test('SELECT\n* FROM table'));
    });
  });

  describe('contentStartsWithMagic', () => {
    it('should return true for exact magic command', () => {
      assert.strictEqual(contentStartsWithMagic('%sql', '%sql'), true);
    });

    it('should return true for magic command followed by space', () => {
      assert.strictEqual(contentStartsWithMagic('%sql SELECT * FROM table', '%sql'), true);
    });

    it('should return true for magic command followed by newline', () => {
      assert.strictEqual(contentStartsWithMagic('%sql\nSELECT * FROM table', '%sql'), true);
    });

    it('should return false for partial match', () => {
      assert.strictEqual(contentStartsWithMagic('%sqlSELECT', '%sql'), false);
    });

    it('should return false for different magic command', () => {
      assert.strictEqual(contentStartsWithMagic('%python', '%sql'), false);
    });

    it('should return false for empty content', () => {
      assert.strictEqual(contentStartsWithMagic('', '%sql'), false);
    });

    it('should prevent %r matching %run', () => {
      assert.strictEqual(contentStartsWithMagic('%run /path/to/notebook', '%r'), false);
    });

    it('should correctly match %r when followed by space', () => {
      assert.strictEqual(contentStartsWithMagic('%r library(ggplot2)', '%r'), true);
    });

    it('should correctly match %r when alone', () => {
      assert.strictEqual(contentStartsWithMagic('%r', '%r'), true);
    });
  });

  describe('findMagicCommand', () => {
    it('should find %sql command', () => {
      assert.strictEqual(findMagicCommand('%sql SELECT * FROM table'), '%sql');
    });

    it('should find %md command', () => {
      assert.strictEqual(findMagicCommand('%md # Title'), '%md');
    });

    it('should find %md-sandbox before %md', () => {
      assert.strictEqual(findMagicCommand('%md-sandbox <html>'), '%md-sandbox');
    });

    it('should find %run before %r', () => {
      assert.strictEqual(findMagicCommand('%run /path/notebook'), '%run');
    });

    it('should find %r when alone', () => {
      assert.strictEqual(findMagicCommand('%r'), '%r');
    });

    it('should find %r when followed by space', () => {
      assert.strictEqual(findMagicCommand('%r library(ggplot2)'), '%r');
    });

    it('should return undefined for no magic command', () => {
      assert.strictEqual(findMagicCommand('print("hello")'), undefined);
    });

    it('should return undefined for empty string', () => {
      assert.strictEqual(findMagicCommand(''), undefined);
    });

    it('should return undefined for partial magic command', () => {
      assert.strictEqual(findMagicCommand('%sq'), undefined);
    });
  });

  describe('getMagicCommandForType', () => {
    it('should return %python for code type', () => {
      assert.strictEqual(getMagicCommandForType('code'), '%python');
    });

    it('should return %md for markdown type', () => {
      assert.strictEqual(getMagicCommandForType('markdown'), '%md');
    });

    it('should return %sql for sql type', () => {
      assert.strictEqual(getMagicCommandForType('sql'), '%sql');
    });

    it('should return %scala for scala type', () => {
      assert.strictEqual(getMagicCommandForType('scala'), '%scala');
    });

    it('should return %r for r type', () => {
      assert.strictEqual(getMagicCommandForType('r'), '%r');
    });

    it('should return %sh for shell type', () => {
      assert.strictEqual(getMagicCommandForType('shell'), '%sh');
    });

    it('should return %fs for fs type', () => {
      assert.strictEqual(getMagicCommandForType('fs'), '%fs');
    });

    it('should return %run for run type', () => {
      assert.strictEqual(getMagicCommandForType('run'), '%run');
    });

    it('should return %pip for pip type', () => {
      assert.strictEqual(getMagicCommandForType('pip'), '%pip');
    });

    it('should return original command when provided', () => {
      assert.strictEqual(getMagicCommandForType('markdown', '%md-sandbox'), '%md-sandbox');
    });

    it('should prefer original command over default', () => {
      assert.strictEqual(getMagicCommandForType('code', '%python'), '%python');
    });
  });
});
