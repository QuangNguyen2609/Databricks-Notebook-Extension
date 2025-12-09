#!/usr/bin/env python3
"""
Unit tests for kernel_runner.py async execution support.

Tests the _contains_top_level_await, _run_async_code, and execute_code functions
to ensure proper handling of top-level await in notebook cells.

Run with: python -m pytest test_kernel_runner.py -v
Or: python test_kernel_runner.py
"""

import unittest
import sys
import os

# Add the current directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from kernel_runner import _contains_top_level_await, _run_async_code, execute_code


class TestContainsTopLevelAwait(unittest.TestCase):
    """Tests for _contains_top_level_await function."""

    def test_simple_await_expression(self):
        """Should detect simple await expression."""
        code = "result = await some_async_func()"
        self.assertTrue(_contains_top_level_await(code))

    def test_await_with_import(self):
        """Should detect await after import statements."""
        code = """
import asyncio
result = await asyncio.sleep(1)
"""
        self.assertTrue(_contains_top_level_await(code))

    def test_async_for_loop(self):
        """Should detect async for loop at top level."""
        code = """
async for item in async_generator():
    print(item)
"""
        self.assertTrue(_contains_top_level_await(code))

    def test_async_with_statement(self):
        """Should detect async with statement at top level."""
        code = """
async with async_context_manager() as ctx:
    print(ctx)
"""
        self.assertTrue(_contains_top_level_await(code))

    def test_no_await_simple_code(self):
        """Should return False for simple synchronous code."""
        code = "x = 1 + 2\nprint(x)"
        self.assertFalse(_contains_top_level_await(code))

    def test_await_inside_async_function_only(self):
        """Should return False when await is only inside async function."""
        code = """
async def my_func():
    return await some_async_call()
"""
        self.assertFalse(_contains_top_level_await(code))

    def test_await_inside_regular_function(self):
        """Should return False for await inside regular function (invalid but not top-level)."""
        code = """
def my_func():
    return await some_call()
"""
        # This is invalid Python but the detection should still work
        # (await inside regular function isn't top-level await)
        self.assertFalse(_contains_top_level_await(code))

    def test_await_inside_class_method(self):
        """Should return False when await is inside class method."""
        code = """
class MyClass:
    async def method(self):
        return await self.async_operation()
"""
        self.assertFalse(_contains_top_level_await(code))

    def test_nested_async_function(self):
        """Should return False for nested async function definition."""
        code = """
def outer():
    async def inner():
        await asyncio.sleep(1)
    return inner
"""
        self.assertFalse(_contains_top_level_await(code))

    def test_mixed_top_level_and_function_await(self):
        """Should return True when there's both top-level and function await."""
        code = """
async def helper():
    await asyncio.sleep(0.1)

result = await helper()
print(result)
"""
        self.assertTrue(_contains_top_level_await(code))

    def test_empty_code(self):
        """Should return False for empty code."""
        self.assertFalse(_contains_top_level_await(""))

    def test_comments_only(self):
        """Should return False for code with only comments."""
        code = "# This is a comment\n# Another comment"
        self.assertFalse(_contains_top_level_await(code))

    def test_await_in_list_comprehension(self):
        """Should detect await in list comprehension (top-level)."""
        code = "results = [await f(x) for x in items]"
        self.assertTrue(_contains_top_level_await(code))

    def test_multiple_awaits(self):
        """Should detect multiple await expressions."""
        code = """
a = await func1()
b = await func2()
c = await func3()
"""
        self.assertTrue(_contains_top_level_await(code))


class TestRunAsyncCode(unittest.TestCase):
    """Tests for _run_async_code function."""

    def test_simple_async_execution(self):
        """Should execute simple async code and update namespace."""
        namespace = {'__name__': '__main__', '__builtins__': __builtins__}
        code = """
import asyncio
result = await asyncio.sleep(0.01, result=42)
"""
        _run_async_code(code, namespace)
        self.assertEqual(namespace.get('result'), 42)

    def test_async_function_call(self):
        """Should execute async function and store result."""
        namespace = {'__name__': '__main__', '__builtins__': __builtins__}
        code = """
import asyncio

async def add(a, b):
    await asyncio.sleep(0.01)
    return a + b

result = await add(3, 4)
"""
        _run_async_code(code, namespace)
        self.assertEqual(namespace.get('result'), 7)

    def test_multiple_awaits(self):
        """Should handle multiple sequential awaits."""
        namespace = {'__name__': '__main__', '__builtins__': __builtins__}
        code = """
import asyncio
a = await asyncio.sleep(0.01, result=1)
b = await asyncio.sleep(0.01, result=2)
c = await asyncio.sleep(0.01, result=3)
total = a + b + c
"""
        _run_async_code(code, namespace)
        self.assertEqual(namespace.get('total'), 6)

    def test_async_preserves_namespace(self):
        """Should preserve existing namespace variables."""
        namespace = {
            '__name__': '__main__',
            '__builtins__': __builtins__,
            'existing_var': 100
        }
        code = """
import asyncio
result = await asyncio.sleep(0.01, result=existing_var * 2)
"""
        _run_async_code(code, namespace)
        self.assertEqual(namespace.get('result'), 200)
        self.assertEqual(namespace.get('existing_var'), 100)


class TestExecuteCodeAsync(unittest.TestCase):
    """Tests for execute_code function with async code."""

    def test_async_code_success(self):
        """Should successfully execute async code."""
        code = """
import asyncio
result = await asyncio.sleep(0.01, result="success")
print(f"Got: {result}")
"""
        result = execute_code(code)
        self.assertTrue(result['success'])
        self.assertIn("Got: success", result['stdout'])

    def test_async_code_captures_stdout(self):
        """Should capture stdout from async code."""
        code = """
import asyncio
print("Before await")
await asyncio.sleep(0.01)
print("After await")
"""
        result = execute_code(code)
        self.assertTrue(result['success'])
        self.assertIn("Before await", result['stdout'])
        self.assertIn("After await", result['stdout'])

    def test_sync_code_still_works(self):
        """Should still execute synchronous code correctly."""
        code = "x = 42\nprint(f'x = {x}')"
        result = execute_code(code)
        self.assertTrue(result['success'])
        self.assertIn("x = 42", result['stdout'])

    def test_async_error_handling(self):
        """Should handle errors in async code."""
        code = """
import asyncio
async def failing():
    await asyncio.sleep(0.01)
    raise ValueError("Test error")

await failing()
"""
        result = execute_code(code)
        self.assertFalse(result['success'])
        self.assertIn("ValueError", result['error'])
        self.assertIn("Test error", result['error'])

    def test_execution_time_tracked(self):
        """Should track execution time for async code."""
        code = """
import asyncio
await asyncio.sleep(0.05)
"""
        result = execute_code(code)
        self.assertTrue(result['success'])
        self.assertIn('executionTime', result)
        self.assertGreater(result['executionTime'], 0.04)

    def test_async_syntax_error(self):
        """Should handle syntax errors in async code."""
        code = "await invalid syntax here"
        result = execute_code(code)
        self.assertFalse(result['success'])
        self.assertIn("SyntaxError", result.get('error', '') or result.get('errorType', ''))

    def test_async_with_exception_traceback(self):
        """Should provide traceback for async exceptions."""
        code = """
import asyncio

async def level1():
    await level2()

async def level2():
    raise RuntimeError("Deep error")

await level1()
"""
        result = execute_code(code)
        self.assertFalse(result['success'])
        self.assertIn("RuntimeError", result['error'])
        self.assertIn("Deep error", result['error'])

    def test_namespace_persistence_with_async(self):
        """Should persist namespace across async and sync cells."""
        # First cell: define async function
        result1 = execute_code("""
import asyncio

async def async_add(a, b):
    await asyncio.sleep(0.01)
    return a + b
""")
        self.assertTrue(result1['success'])

        # Second cell: use the async function
        result2 = execute_code("""
result = await async_add(10, 20)
print(f"Result: {result}")
""")
        self.assertTrue(result2['success'])
        self.assertIn("Result: 30", result2['stdout'])


class TestAsyncComprehensions(unittest.TestCase):
    """Tests for async comprehension execution."""

    def test_async_list_comprehension_execution(self):
        """Should execute async list comprehension."""
        code = """
async def gen():
    for i in range(3):
        yield i * 2

values = [x async for x in gen()]
print(f"Values: {values}")
"""
        result = execute_code(code)
        self.assertTrue(result['success'])
        self.assertIn("Values: [0, 2, 4]", result['stdout'])

    def test_async_set_comprehension_execution(self):
        """Should execute async set comprehension."""
        code = """
async def gen():
    for i in [1, 2, 2, 3]:
        yield i

values = {x async for x in gen()}
print(f"Values: {sorted(values)}")
"""
        result = execute_code(code)
        self.assertTrue(result['success'])
        self.assertIn("Values: [1, 2, 3]", result['stdout'])

    def test_async_dict_comprehension_execution(self):
        """Should execute async dict comprehension."""
        code = """
async def gen():
    for i in range(3):
        yield i, chr(65 + i)

values = {k: v async for k, v in gen()}
print(f"Values: {values}")
"""
        result = execute_code(code)
        self.assertTrue(result['success'])
        self.assertIn("Values: {0: 'A', 1: 'B', 2: 'C'}", result['stdout'])


class TestEdgeCases(unittest.TestCase):
    """Tests for edge cases and corner cases."""

    def test_lambda_with_await_not_detected(self):
        """Lambda can't have await, so this should be False."""
        code = "f = lambda x: x + 1\nresult = f(5)"
        self.assertFalse(_contains_top_level_await(code))

    def test_string_containing_await_not_detected(self):
        """Await in string should not be detected as top-level await."""
        code = 'message = "Please await further instructions"\nprint(message)'
        self.assertFalse(_contains_top_level_await(code))

    def test_comment_containing_await_not_detected(self):
        """Await in comment should not be detected."""
        code = "# await some_func()\nx = 42"
        self.assertFalse(_contains_top_level_await(code))

    def test_async_generator_expression(self):
        """Should detect async generator expressions."""
        code = """
async def gen():
    yield 1
    yield 2

values = [x async for x in gen()]
"""
        # Note: async comprehension is top-level await
        self.assertTrue(_contains_top_level_await(code))

    def test_deeply_nested_await(self):
        """Should not detect await nested in function in class."""
        code = """
class Outer:
    class Inner:
        async def method(self):
            await asyncio.sleep(1)
"""
        self.assertFalse(_contains_top_level_await(code))


if __name__ == '__main__':
    # Run with verbosity
    unittest.main(verbosity=2)
