#!/usr/bin/env python3
"""
Unit tests for timestamp normalization in display_utils.py.

Tests the normalize_timestamp_for_display and safe_str functions
to ensure timestamps are displayed without local timezone conversion.

Run with: python -m pytest test_timestamp_normalizer.py -v
Or: python test_timestamp_normalizer.py
"""

import unittest
import sys
import os
from datetime import datetime, timezone, timedelta

# Add the current directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from display_utils import normalize_timestamp_for_display, safe_str


class TestNormalizeTimestampForDisplay(unittest.TestCase):
    """Tests for normalize_timestamp_for_display function."""

    def test_utc_datetime_preserves_timezone(self):
        """Should preserve UTC timezone offset (+00:00)."""
        dt = datetime(2025, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
        result = normalize_timestamp_for_display(dt)
        self.assertEqual(result, "2025-01-01T00:00:00.000+00:00")

    def test_positive_timezone_offset_preserved(self):
        """Should preserve positive timezone offset (e.g., +10:30 Adelaide)."""
        adelaide_tz = timezone(timedelta(hours=10, minutes=30))
        dt = datetime(2025, 1, 1, 10, 30, 0, tzinfo=adelaide_tz)
        result = normalize_timestamp_for_display(dt)
        self.assertEqual(result, "2025-01-01T10:30:00.000+10:30")

    def test_negative_timezone_offset_preserved(self):
        """Should preserve negative timezone offset (e.g., -05:00 EST)."""
        est_tz = timezone(timedelta(hours=-5))
        dt = datetime(2025, 1, 1, 19, 0, 0, tzinfo=est_tz)
        result = normalize_timestamp_for_display(dt)
        self.assertEqual(result, "2025-01-01T19:00:00.000-05:00")

    def test_naive_datetime_no_timezone(self):
        """Should format naive datetime (TIMESTAMP_NTZ) without timezone."""
        dt = datetime(2025, 1, 1, 0, 0, 0)
        result = normalize_timestamp_for_display(dt)
        self.assertEqual(result, "2025-01-01T00:00:00.000")

    def test_datetime_with_microseconds(self):
        """Should preserve microsecond precision."""
        dt = datetime(2025, 1, 1, 0, 0, 0, 123456, tzinfo=timezone.utc)
        result = normalize_timestamp_for_display(dt)
        self.assertEqual(result, "2025-01-01T00:00:00.123456+00:00")

    def test_datetime_with_milliseconds(self):
        """Should preserve millisecond precision."""
        dt = datetime(2025, 1, 1, 0, 0, 0, 123000, tzinfo=timezone.utc)
        result = normalize_timestamp_for_display(dt)
        self.assertEqual(result, "2025-01-01T00:00:00.123000+00:00")

    def test_non_datetime_returns_none(self):
        """Should return None for non-datetime values."""
        self.assertIsNone(normalize_timestamp_for_display("2025-01-01"))
        self.assertIsNone(normalize_timestamp_for_display(123456))
        self.assertIsNone(normalize_timestamp_for_display(None))
        self.assertIsNone(normalize_timestamp_for_display([]))

    def test_end_of_day_timestamp(self):
        """Should correctly format end-of-day timestamps."""
        dt = datetime(2025, 1, 1, 23, 59, 59, tzinfo=timezone.utc)
        result = normalize_timestamp_for_display(dt)
        self.assertEqual(result, "2025-01-01T23:59:59.000+00:00")

    def test_leap_second_boundary(self):
        """Should handle timestamps near midnight correctly."""
        dt = datetime(2025, 12, 31, 23, 59, 59, 999999, tzinfo=timezone.utc)
        result = normalize_timestamp_for_display(dt)
        self.assertEqual(result, "2025-12-31T23:59:59.999999+00:00")

    def test_timezone_with_minutes_offset(self):
        """Should handle timezones with non-hour offsets (e.g., +05:45 Nepal)."""
        nepal_tz = timezone(timedelta(hours=5, minutes=45))
        dt = datetime(2025, 6, 15, 12, 30, 0, tzinfo=nepal_tz)
        result = normalize_timestamp_for_display(dt)
        self.assertEqual(result, "2025-06-15T12:30:00.000+05:45")


class TestSafeStrWithDatetime(unittest.TestCase):
    """Tests for safe_str function with datetime values."""

    def test_safe_str_preserves_utc_timestamp(self):
        """safe_str should preserve UTC timezone for datetime."""
        dt = datetime(2025, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
        result = safe_str(dt)
        self.assertEqual(result, "2025-01-01T00:00:00.000+00:00")

    def test_safe_str_preserves_local_timezone(self):
        """safe_str should preserve local timezone offset."""
        adelaide_tz = timezone(timedelta(hours=10, minutes=30))
        dt = datetime(2025, 1, 1, 10, 30, 0, tzinfo=adelaide_tz)
        result = safe_str(dt)
        self.assertEqual(result, "2025-01-01T10:30:00.000+10:30")

    def test_safe_str_naive_datetime(self):
        """safe_str should handle naive datetime without timezone."""
        dt = datetime(2025, 1, 1, 0, 0, 0)
        result = safe_str(dt)
        self.assertEqual(result, "2025-01-01T00:00:00.000")

    def test_safe_str_none_returns_none(self):
        """safe_str should return None for None input."""
        result = safe_str(None)
        self.assertIsNone(result)

    def test_safe_str_string_unchanged(self):
        """safe_str should handle regular strings normally."""
        result = safe_str("hello world")
        self.assertEqual(result, "hello world")

    def test_safe_str_number_unchanged(self):
        """safe_str should handle numbers normally."""
        result = safe_str(42)
        self.assertEqual(result, "42")
        result = safe_str(3.14)
        self.assertEqual(result, "3.14")

    def test_safe_str_float_special_values(self):
        """safe_str should handle special float values."""
        self.assertEqual(safe_str(float('nan')), 'NaN')
        self.assertEqual(safe_str(float('inf')), 'Infinity')
        self.assertEqual(safe_str(float('-inf')), '-Infinity')


class TestTimestampNoLocalConversion(unittest.TestCase):
    """
    Critical tests to verify timestamps are NOT converted to local timezone.

    These tests simulate the actual bug scenario where:
    - Databricks returns UTC timestamps
    - The extension should display them as UTC, not local time
    """

    def test_utc_not_converted_to_local(self):
        """
        CRITICAL: UTC timestamp must NOT be converted to local timezone.

        Bug scenario:
        - Databricks returns: 2025-01-01T00:00:00.000+00:00 (UTC)
        - Bug would show: 2025-01-01T10:30:00.000+10:30 (Adelaide)
        - Fix must show: 2025-01-01T00:00:00.000+00:00 (UTC unchanged)
        """
        # Simulate Databricks returning UTC timestamp
        databricks_timestamp = datetime(2025, 1, 1, 0, 0, 0, tzinfo=timezone.utc)

        # The display function should preserve the original timezone
        result = safe_str(databricks_timestamp)

        # MUST contain +00:00 (UTC), NOT +10:30 (Adelaide) or any other local offset
        self.assertIn("+00:00", result)
        self.assertNotIn("+10:30", result)
        self.assertNotIn("+10:00", result)
        self.assertNotIn("+11:00", result)

        # The time portion must remain 00:00:00, NOT 10:30:00
        self.assertIn("T00:00:00", result)
        self.assertNotIn("T10:30:00", result)

    def test_end_time_not_converted(self):
        """
        Test end_time scenario from the bug report.

        Bug scenario:
        - Databricks returns: 2025-01-01T23:59:59.000+00:00 (UTC)
        - Bug would show: 2025-01-02T10:29:59.000+10:30 (Adelaide, next day!)
        - Fix must show: 2025-01-01T23:59:59.000+00:00 (UTC unchanged)
        """
        databricks_end_time = datetime(2025, 1, 1, 23, 59, 59, tzinfo=timezone.utc)
        result = safe_str(databricks_end_time)

        # Date must remain 2025-01-01, NOT 2025-01-02
        self.assertIn("2025-01-01", result)
        self.assertNotIn("2025-01-02", result)

        # Time must remain 23:59:59
        self.assertIn("T23:59:59", result)

    def test_multiple_rows_same_format(self):
        """Test that multiple timestamps maintain consistent formatting."""
        timestamps = [
            datetime(2025, 1, 1, 0, 0, 0, tzinfo=timezone.utc),
            datetime(2025, 4, 18, 0, 0, 0, tzinfo=timezone.utc),
            datetime(2025, 12, 25, 0, 0, 0, tzinfo=timezone.utc),
        ]

        for ts in timestamps:
            result = safe_str(ts)
            # All should show midnight UTC
            self.assertIn("T00:00:00.000+00:00", result)


class TestDateOnlyNotAffected(unittest.TestCase):
    """Tests to ensure date-only handling still works."""

    def test_date_object_passes_through(self):
        """Date objects (not datetime) should pass through to str()."""
        from datetime import date
        d = date(2025, 1, 1)
        result = safe_str(d)
        # Date objects don't have timezone issues, str() is fine
        self.assertEqual(result, "2025-01-01")


if __name__ == '__main__':
    # Run with verbosity
    unittest.main(verbosity=2)
