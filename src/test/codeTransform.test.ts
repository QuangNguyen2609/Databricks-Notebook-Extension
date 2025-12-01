/**
 * Tests for code transformation utilities
 */

import * as assert from 'assert';
import {
  escapeForPythonTripleQuote,
  stripMagicPrefix,
  wrapSqlCode,
  wrapShellCode,
} from '../utils/codeTransform';

describe('Code Transform Tests', () => {
  describe('escapeForPythonTripleQuote', () => {
    it('should escape single backslash', () => {
      const result = escapeForPythonTripleQuote("test\\value");
      assert.strictEqual(result, "test\\\\value");
    });

    it('should escape multiple backslashes', () => {
      const result = escapeForPythonTripleQuote("path\\to\\file");
      assert.strictEqual(result, "path\\\\to\\\\file");
    });

    it('should escape double backslashes (regex escape sequences)', () => {
      // Original: \\[ which should become \\\\[ in Python
      const result = escapeForPythonTripleQuote("RLIKE '[^ A-Za-z0-9\\-./\\[\\]_:#]'");
      assert.strictEqual(result, "RLIKE '[^ A-Za-z0-9\\\\-./\\\\[\\\\]_:#]'");
    });

    it('should escape triple quotes', () => {
      const result = escapeForPythonTripleQuote('test"""value');
      assert.strictEqual(result, 'test\\"\\"\\"value');
    });

    it('should handle SQL with escaped single quotes', () => {
      // Original: NOT ILIKE '%\'%'
      const result = escapeForPythonTripleQuote("NOT ILIKE '%\\'%'");
      assert.strictEqual(result, "NOT ILIKE '%\\\\'%'");
    });

    it('should handle complex regex patterns', () => {
      // This is the actual pattern from the user's SQL
      const input = "[^ A-Za-z0-9&'(),\\-./\\[\\]_:#]";
      const result = escapeForPythonTripleQuote(input);
      assert.strictEqual(result, "[^ A-Za-z0-9&'(),\\\\-./\\\\[\\\\]_:#]");
    });

    it('should preserve strings without special characters', () => {
      const result = escapeForPythonTripleQuote("SELECT * FROM table");
      assert.strictEqual(result, "SELECT * FROM table");
    });

    it('should handle empty string', () => {
      const result = escapeForPythonTripleQuote('');
      assert.strictEqual(result, '');
    });

    it('should handle newlines (no escaping needed)', () => {
      const result = escapeForPythonTripleQuote("line1\nline2");
      assert.strictEqual(result, "line1\nline2");
    });

    it('should escape backslash before n (not a newline in source)', () => {
      // If someone has literal \n in their SQL (as two chars, not newline)
      const result = escapeForPythonTripleQuote("test\\nvalue");
      assert.strictEqual(result, "test\\\\nvalue");
    });
  });

  describe('stripMagicPrefix', () => {
    it('should strip %sql prefix', () => {
      const result = stripMagicPrefix('%sql SELECT 1', '%sql');
      assert.strictEqual(result, 'SELECT 1');
    });

    it('should strip %python prefix', () => {
      const result = stripMagicPrefix('%python print("hello")', '%python');
      assert.strictEqual(result, 'print("hello")');
    });

    it('should strip %sh prefix', () => {
      const result = stripMagicPrefix('%sh ls -la', '%sh');
      assert.strictEqual(result, 'ls -la');
    });

    it('should handle code without prefix', () => {
      const result = stripMagicPrefix('SELECT 1', '%sql');
      assert.strictEqual(result, 'SELECT 1');
    });

    it('should trim whitespace', () => {
      const result = stripMagicPrefix('  %sql   SELECT 1  ', '%sql');
      assert.strictEqual(result, 'SELECT 1');
    });

    it('should handle prefix at start only', () => {
      const result = stripMagicPrefix('%sql%sql', '%sql');
      assert.strictEqual(result, '%sql');
    });

    it('should handle empty string', () => {
      const result = stripMagicPrefix('', '%sql');
      assert.strictEqual(result, '');
    });

    it('should handle only prefix', () => {
      const result = stripMagicPrefix('%sql', '%sql');
      assert.strictEqual(result, '');
    });

    it('should handle multiline code', () => {
      const result = stripMagicPrefix('%sql\nSELECT 1\nFROM table', '%sql');
      assert.strictEqual(result, 'SELECT 1\nFROM table');
    });
  });

  describe('wrapSqlCode', () => {
    it('should wrap simple SQL', () => {
      const result = wrapSqlCode('SELECT 1');
      assert.ok(result.includes('spark.sql("""SELECT 1""")'));
      assert.ok(result.includes('display(_df)'));
    });

    it('should strip %sql prefix before wrapping', () => {
      const result = wrapSqlCode('%sql SELECT 1');
      assert.ok(result.includes('spark.sql("""SELECT 1""")'));
      assert.ok(!result.includes('%sql'));
    });

    it('should include spark existence check', () => {
      const result = wrapSqlCode('SELECT 1');
      assert.ok(result.includes("if 'spark' not in dir()"));
      assert.ok(result.includes('NameError'));
    });

    it('should escape backslashes in SQL with regex patterns', () => {
      const sql = "SELECT * FROM t WHERE col RLIKE '[\\d]+'";
      const result = wrapSqlCode(sql);
      // Backslash should be escaped
      assert.ok(result.includes('[\\\\d]+'));
    });

    it('should handle SQL with escaped single quotes', () => {
      const sql = "SELECT * FROM t WHERE name NOT ILIKE '%\\'%'";
      const result = wrapSqlCode(sql);
      // Should escape the backslash so Python preserves it
      assert.ok(result.includes("\\\\'"));
    });

    it('should handle complex SQL with multiple escape sequences', () => {
      const sql = `SELECT * FROM t
WHERE col RLIKE '[^ A-Za-z0-9&\\'(),\\-./\\[\\]_:#]'
  AND col NOT ILIKE '%\\'%'`;
      const result = wrapSqlCode(sql);
      // All backslashes should be doubled
      assert.ok(result.includes('\\\\-'));
      assert.ok(result.includes('\\\\['));
      assert.ok(result.includes('\\\\]'));
      assert.ok(result.includes("\\\\'"));
    });

    it('should handle SQL with triple quotes', () => {
      const sql = 'SELECT """test"""';
      const result = wrapSqlCode(sql);
      assert.ok(result.includes('\\"\\"\\"test\\"\\"\\"'));
    });

    it('should handle multiline SQL', () => {
      const sql = `SELECT
  a.col1,
  b.col2
FROM table_a a
JOIN table_b b ON a.id = b.id`;
      const result = wrapSqlCode(sql);
      assert.ok(result.includes('SELECT'));
      assert.ok(result.includes('JOIN'));
    });
  });

  describe('wrapShellCode', () => {
    it('should wrap simple shell command', () => {
      const result = wrapShellCode('ls -la');
      assert.ok(result.includes('subprocess'));
      assert.ok(result.includes('"""ls -la"""'));
    });

    it('should strip %sh prefix before wrapping', () => {
      const result = wrapShellCode('%sh ls -la');
      assert.ok(result.includes('"""ls -la"""'));
      assert.ok(!result.includes('%sh'));
    });

    it('should escape backslashes in shell commands', () => {
      const result = wrapShellCode('echo "path\\to\\file"');
      assert.ok(result.includes('\\\\'));
    });

    it('should handle shell command with single quotes', () => {
      const result = wrapShellCode("echo 'hello world'");
      assert.ok(result.includes("'hello world'"));
    });

    it('should capture stdout and stderr', () => {
      const result = wrapShellCode('ls');
      assert.ok(result.includes('capture_output=True'));
      assert.ok(result.includes('_result.stdout'));
      assert.ok(result.includes('_result.stderr'));
    });

    it('should handle multiline shell commands', () => {
      const shell = `ls -la
pwd
whoami`;
      const result = wrapShellCode(shell);
      assert.ok(result.includes('ls -la'));
      assert.ok(result.includes('pwd'));
      assert.ok(result.includes('whoami'));
    });

    it('should handle shell command with regex', () => {
      const result = wrapShellCode('grep -E "^[a-z]+" file.txt');
      assert.ok(result.includes('^[a-z]+'));
    });

    it('should handle shell command with environment variables', () => {
      const result = wrapShellCode('echo $HOME');
      assert.ok(result.includes('$HOME'));
    });
  });

  describe('Real-world SQL edge cases', () => {
    it('should handle the exact SQL that caused the original bug', () => {
      const sql = `%sql

SELECT
    -- E700 Application identification code
    a.ref_num
    ,p.givens
    ,p.surname
FROM santas_reporting.applicant a
WHERE (
    perm.address_1 RLIKE '[^ A-Za-z0-9&'(),\\-./\\[\\]_:#]' AND perm.address_1 NOT ILIKE '%\\'%'
    OR
    perm.address_2 RLIKE '[^ A-Za-z0-9&'(),\\-./\\[\\]_:#]' AND perm.address_2 NOT ILIKE '%\\'%'
  )
ORDER BY a.ref_num`;

      const result = wrapSqlCode(sql);

      // Verify backslashes are properly escaped
      // Original: \- should become \\-
      assert.ok(result.includes('\\\\-'), 'Should escape \\- in regex');
      // Original: \[ should become \\[
      assert.ok(result.includes('\\\\['), 'Should escape \\[ in regex');
      // Original: \] should become \\]
      assert.ok(result.includes('\\\\]'), 'Should escape \\] in regex');
      // Original: \' should become \\'
      assert.ok(result.includes("\\\\'"), 'Should escape \\\' in ILIKE');

      // Verify the SQL structure is preserved
      assert.ok(result.includes('RLIKE'), 'Should preserve RLIKE keyword');
      assert.ok(result.includes('NOT ILIKE'), 'Should preserve NOT ILIKE keyword');
      assert.ok(result.includes('ORDER BY'), 'Should preserve ORDER BY');
    });

    it('should handle SQL with Windows-style paths', () => {
      const sql = "SELECT * FROM t WHERE path = 'C:\\\\Users\\\\Name\\\\file.txt'";
      const result = wrapSqlCode(sql);
      // Each \\ in the input should become \\\\ in the output
      assert.ok(result.includes('\\\\\\\\'));
    });

    it('should handle SQL with JSON escape sequences', () => {
      const sql = `SELECT parse_json('{"key": "value\\nwith\\ttabs"}')`;
      const result = wrapSqlCode(sql);
      assert.ok(result.includes('\\\\n'));
      assert.ok(result.includes('\\\\t'));
    });
  });
});
