#!/usr/bin/env python3
"""
Unit tests for Databricks Connect auth resolution in kernel_runner.initialize_spark_session.
Uses mocks so databricks-connect does not need to be installed.
"""
import os
import sys
import types
import unittest
from unittest.mock import MagicMock, patch

# Avoid loading display_utils (pyspark/pandas) when importing kernel_runner for unit tests
_display_utils_stub = types.ModuleType('display_utils')
_display_utils_stub.display_to_html = lambda *a, **k: None
sys.modules['display_utils'] = _display_utils_stub

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import kernel_runner  # noqa: E402


class TestResolveWorkspaceHost(unittest.TestCase):
    """Tests for _resolve_workspace_host."""

    def test_env_host_wins(self):
        with patch.dict(os.environ, {'DATABRICKS_HOST': 'https://env.example.com'}, clear=False):
            with patch.object(kernel_runner, 'get_databricks_profile', return_value=None):
                self.assertEqual(kernel_runner._resolve_workspace_host(), 'https://env.example.com')

    def test_profile_host_when_no_env(self):
        with patch.dict(os.environ, {}, clear=True):
            with patch.object(kernel_runner, 'get_databricks_profile', return_value='myprof'):
                with patch.object(
                    kernel_runner, 'get_host_from_profile', return_value='https://prof.example.com'
                ):
                    self.assertEqual(
                        kernel_runner._resolve_workspace_host(),
                        'https://prof.example.com',
                    )


class TestSparkAuthOrder(unittest.TestCase):
    """Auth precedence: env token > profile (non-cli) > token cache."""

    def setUp(self):
        self.fake_spark = object()
        self.builder = MagicMock()
        self.builder.sdkConfig.return_value = self.builder
        self.builder.getOrCreate.return_value = self.fake_spark

        self.mock_ds_cls = MagicMock()
        self.mock_ds_cls.builder = self.builder

        self.config_ctor = MagicMock(side_effect=lambda **kwargs: {'config': kwargs})

        databricks_mod = types.ModuleType('databricks')
        connect_mod = types.ModuleType('databricks.connect')
        sdk_mod = types.ModuleType('databricks.sdk')
        core_mod = types.ModuleType('databricks.sdk.core')

        connect_mod.DatabricksSession = self.mock_ds_cls
        sdk_mod.WorkspaceClient = MagicMock()
        core_mod.Config = self.config_ctor

        databricks_mod.connect = connect_mod
        databricks_mod.sdk = sdk_mod

        sys.modules['databricks'] = databricks_mod
        sys.modules['databricks.connect'] = connect_mod
        sys.modules['databricks.sdk'] = sdk_mod
        sys.modules['databricks.sdk.core'] = core_mod

    def tearDown(self):
        sys.modules.pop('databricks.connect', None)
        sys.modules.pop('databricks.sdk.core', None)
        sys.modules.pop('databricks.sdk', None)
        sys.modules.pop('databricks', None)

    def _minimal_namespace(self):
        kernel_runner._namespace.clear()
        kernel_runner._namespace.update({
            '__name__': '__main__',
            '__builtins__': __builtins__,
        })

    def _assert_sdk_config(self, **expected):
        self.config_ctor.assert_called()
        actual = self.config_ctor.call_args.kwargs
        for key, value in expected.items():
            self.assertEqual(actual.get(key), value)

    @patch.object(kernel_runner, 'initialize_dbutils')
    def test_prefers_env_token_over_token_cache(self, mock_dbutils):
        mock_dbutils.return_value = (None, 'dbutils: OK | widgets')

        env = {
            'DATABRICKS_HOST': 'https://w.example.com',
            'DATABRICKS_TOKEN': 'tok-env',
            'DATABRICKS_CONFIG_PROFILE': 'cli-profile',
        }
        with patch.dict(os.environ, env, clear=True):
            with patch.object(kernel_runner, 'get_databricks_profile', return_value='cli-profile'):
                with patch.object(
                    kernel_runner, 'get_auth_type_from_profile', return_value='databricks-cli'
                ):
                    with patch.object(
                        kernel_runner, 'get_token_from_cache', return_value='stale-cache-token'
                    ) as mock_cache:
                        self._minimal_namespace()
                        status = kernel_runner.initialize_spark_session()
                        self.assertTrue(status.startswith('OK:'), status)
                        self.assertIn('(env token)', status)
                        mock_cache.assert_not_called()
                        self.builder.sdkConfig.assert_called_once()
                        self._assert_sdk_config(
                            host='https://w.example.com',
                            token='tok-env',
                            auth_type='pat',
                            serverless_compute_id='auto',
                        )

    @patch.object(kernel_runner, 'initialize_dbutils')
    def test_env_token_uses_profile_host_when_env_host_missing(self, mock_dbutils):
        mock_dbutils.return_value = (None, 'dbutils: OK | widgets')

        env = {
            'DATABRICKS_TOKEN': 'tok-env',
            'DATABRICKS_CONFIG_PROFILE': 'selected-profile',
        }
        with patch.dict(os.environ, env, clear=True):
            with patch.object(kernel_runner, 'get_databricks_profile', return_value='selected-profile'):
                with patch.object(
                    kernel_runner, 'get_auth_type_from_profile', return_value='databricks-cli'
                ):
                    with patch.object(
                        kernel_runner, 'get_host_from_profile', return_value='https://profile.example.com'
                    ):
                        self._minimal_namespace()
                        status = kernel_runner.initialize_spark_session()
                        self.assertTrue(status.startswith('OK:'), status)
                        self._assert_sdk_config(
                            host='https://profile.example.com',
                            token='tok-env',
                            auth_type='pat',
                            serverless_compute_id='auto',
                        )

    @patch.object(kernel_runner, 'initialize_dbutils')
    def test_token_cache_for_databricks_cli_when_no_env_token(self, mock_dbutils):
        mock_dbutils.return_value = (None, 'dbutils: OK | widgets')

        env = {
            'DATABRICKS_HOST': 'https://w.example.com',
            'DATABRICKS_CONFIG_PROFILE': 'p',
        }
        with patch.dict(os.environ, env, clear=True):
            with patch.object(kernel_runner, 'get_databricks_profile', return_value='p'):
                with patch.object(
                    kernel_runner, 'get_auth_type_from_profile', return_value='databricks-cli'
                ):
                    with patch.object(
                        kernel_runner, 'get_token_from_cache', return_value='cache-tok'
                    ):
                        self._minimal_namespace()
                        status = kernel_runner.initialize_spark_session()
                        self.assertTrue(status.startswith('OK:'), status)
                        self.assertIn('(token cache)', status)
                        self._assert_sdk_config(
                            host='https://w.example.com',
                            token='cache-tok',
                            auth_type='pat',
                            serverless_compute_id='auto',
                        )

    @patch.object(kernel_runner, 'initialize_dbutils')
    def test_profile_when_oauth_not_cli(self, mock_dbutils):
        mock_dbutils.return_value = (None, 'dbutils: OK | widgets')

        env = {'DATABRICKS_CONFIG_PROFILE': 'prod'}
        with patch.dict(os.environ, env, clear=True):
            with patch.object(kernel_runner, 'get_databricks_profile', return_value='prod'):
                with patch.object(
                    kernel_runner, 'get_auth_type_from_profile', return_value='oauth'
                ):
                    with patch.object(
                        kernel_runner, 'get_host_from_profile', return_value='https://x.com'
                    ):
                        self._minimal_namespace()
                        status = kernel_runner.initialize_spark_session()
                        self.assertTrue(status.startswith('OK:'), status)
                        self.assertIn('(profile: prod)', status)
                        self._assert_sdk_config(
                            profile='prod',
                            serverless_compute_id='auto',
                        )

    @patch.object(kernel_runner, 'initialize_dbutils')
    def test_warning_mentions_actual_auth_source_that_failed(self, mock_dbutils):
        mock_dbutils.return_value = (None, 'dbutils: OK | widgets')
        self.builder.getOrCreate.side_effect = RuntimeError('Invalid Token')

        env = {
            'DATABRICKS_HOST': 'https://w.example.com',
            'DATABRICKS_CONFIG_PROFILE': 'cli-profile',
        }
        with patch.dict(os.environ, env, clear=True):
            with patch.object(kernel_runner, 'get_databricks_profile', return_value='cli-profile'):
                with patch.object(
                    kernel_runner, 'get_auth_type_from_profile', return_value='databricks-cli'
                ):
                    with patch.object(
                        kernel_runner, 'get_token_from_cache', return_value='cache-tok'
                    ):
                        self._minimal_namespace()
                        status = kernel_runner.initialize_spark_session()
                        self.assertTrue(status.startswith('WARN:'), status)
                        self.assertIn('Token cache failed: Invalid Token', status)
                        self.assertNotIn('Profile failed', status)


class TestLazySparkRetry(unittest.TestCase):
    def test_retries_initialize_spark_session_on_background_failure(self):
        fake_spark = object()

        def fake_init():
            kernel_runner._namespace['spark'] = fake_spark
            return 'OK: recovered'

        state = kernel_runner._SparkInitState()
        state.set_failure('WARN: Spark not initialized (background).')

        self.assertIsNone(state._session)
        with patch.object(kernel_runner, 'initialize_spark_session', fake_init):
            lazy = kernel_runner.LazySparkSession(state)
            self.assertIs(lazy._get_session(), fake_spark)
        self.assertIsNone(state._error_msg)
        self.assertIs(state._session, fake_spark)


if __name__ == '__main__':
    unittest.main(verbosity=2)
