/**
 * Tests for the dotenv utility module
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseEnvFile } from '../utils/dotenv';

describe('Dotenv Module Tests', () => {
  let tempDir: string;

  before(() => {
    // Create a temp directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotenv-test-'));
  });

  after(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createEnvFile(content: string): string {
    const filePath = path.join(tempDir, `.env-${Date.now()}`);
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  describe('parseEnvFile', () => {
    it('should parse simple KEY=value pairs', () => {
      const envFile = createEnvFile('FOO=bar\nBAZ=qux');
      const result = parseEnvFile(envFile);

      assert.strictEqual(result.FOO, 'bar');
      assert.strictEqual(result.BAZ, 'qux');
    });

    it('should handle double-quoted values', () => {
      const envFile = createEnvFile('MESSAGE="Hello World"');
      const result = parseEnvFile(envFile);

      assert.strictEqual(result.MESSAGE, 'Hello World');
    });

    it('should handle single-quoted values', () => {
      const envFile = createEnvFile("MESSAGE='Hello World'");
      const result = parseEnvFile(envFile);

      assert.strictEqual(result.MESSAGE, 'Hello World');
    });

    it('should skip comment lines', () => {
      const envFile = createEnvFile('# This is a comment\nFOO=bar\n# Another comment\nBAZ=qux');
      const result = parseEnvFile(envFile);

      assert.strictEqual(result.FOO, 'bar');
      assert.strictEqual(result.BAZ, 'qux');
      assert.strictEqual(Object.keys(result).length, 2);
    });

    it('should skip empty lines', () => {
      const envFile = createEnvFile('FOO=bar\n\n\nBAZ=qux');
      const result = parseEnvFile(envFile);

      assert.strictEqual(result.FOO, 'bar');
      assert.strictEqual(result.BAZ, 'qux');
      assert.strictEqual(Object.keys(result).length, 2);
    });

    it('should handle values with equals signs', () => {
      const envFile = createEnvFile('CONNECTION_STRING=host=localhost;port=5432');
      const result = parseEnvFile(envFile);

      assert.strictEqual(result.CONNECTION_STRING, 'host=localhost;port=5432');
    });

    it('should handle empty values', () => {
      const envFile = createEnvFile('EMPTY_VAR=');
      const result = parseEnvFile(envFile);

      assert.strictEqual(result.EMPTY_VAR, '');
    });

    it('should trim whitespace around keys and values', () => {
      const envFile = createEnvFile('  FOO  =  bar  ');
      const result = parseEnvFile(envFile);

      assert.strictEqual(result.FOO, 'bar');
    });

    it('should handle inline comments for unquoted values', () => {
      const envFile = createEnvFile('FOO=bar # this is a comment');
      const result = parseEnvFile(envFile);

      assert.strictEqual(result.FOO, 'bar');
    });

    it('should return empty object for non-existent file', () => {
      const result = parseEnvFile('/non/existent/path/.env');

      assert.deepStrictEqual(result, {});
    });

    it('should return empty object for empty file', () => {
      const envFile = createEnvFile('');
      const result = parseEnvFile(envFile);

      assert.deepStrictEqual(result, {});
    });

    it('should skip lines without equals sign', () => {
      const envFile = createEnvFile('INVALID_LINE\nFOO=bar');
      const result = parseEnvFile(envFile);

      assert.strictEqual(result.FOO, 'bar');
      assert.strictEqual(result.INVALID_LINE, undefined);
    });

    it('should handle Windows-style line endings', () => {
      const envFile = createEnvFile('FOO=bar\r\nBAZ=qux\r\n');
      const result = parseEnvFile(envFile);

      assert.strictEqual(result.FOO, 'bar');
      assert.strictEqual(result.BAZ, 'qux');
    });

    it('should handle typical Databricks environment variables', () => {
      const envFile = createEnvFile(`
# Databricks config
DATABRICKS_HOST=https://my-workspace.cloud.databricks.com
DATABRICKS_TOKEN=dapi123456789
SPARK_HOME=/opt/spark

# Custom variables
MY_SECRET_KEY="super-secret-value"
DATABASE_URL='postgres://localhost/mydb'
      `.trim());

      const result = parseEnvFile(envFile);

      assert.strictEqual(result.DATABRICKS_HOST, 'https://my-workspace.cloud.databricks.com');
      assert.strictEqual(result.DATABRICKS_TOKEN, 'dapi123456789');
      assert.strictEqual(result.SPARK_HOME, '/opt/spark');
      assert.strictEqual(result.MY_SECRET_KEY, 'super-secret-value');
      assert.strictEqual(result.DATABASE_URL, 'postgres://localhost/mydb');
    });

    it('should handle multiline content with proper values', () => {
      const envFile = createEnvFile('KEY1=value1\nKEY2=value2\nKEY3=value3');
      const result = parseEnvFile(envFile);

      assert.strictEqual(Object.keys(result).length, 3);
      assert.strictEqual(result.KEY1, 'value1');
      assert.strictEqual(result.KEY2, 'value2');
      assert.strictEqual(result.KEY3, 'value3');
    });

    it('should preserve special characters in quoted values', () => {
      const envFile = createEnvFile('SPECIAL="hello$world"');
      const result = parseEnvFile(envFile);

      assert.strictEqual(result.SPECIAL, 'hello$world');
    });

    it('should handle keys with underscores and numbers', () => {
      const envFile = createEnvFile('MY_VAR_123=test\nAPI_KEY_V2=secret');
      const result = parseEnvFile(envFile);

      assert.strictEqual(result.MY_VAR_123, 'test');
      assert.strictEqual(result.API_KEY_V2, 'secret');
    });
  });
});
