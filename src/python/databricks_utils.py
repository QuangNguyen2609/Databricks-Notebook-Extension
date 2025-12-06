"""
Databricks authentication and token management utilities.

This module provides functions for:
- Reading Databricks CLI token cache
- Refreshing OAuth tokens
- Managing token expiry
- Reading Databricks configuration profiles
"""

import os
import json
import configparser
from datetime import datetime, timedelta, timezone
import re
import time
import urllib.request
import urllib.parse

DATABRICKS_CONFIG_FILE = '~/.databrickscfg'
DATABRICKS_TOKEN_CACHE = '~/.databricks/token-cache.json'

# Debug mode - only enabled when DATABRICKS_KERNEL_DEBUG=true
# This prevents sensitive debug info from being logged in production
DEBUG_MODE = os.environ.get('DATABRICKS_KERNEL_DEBUG', 'false').lower() == 'true'


def get_local_timezone() -> timezone:
    """
    Get the local timezone offset.
    Works correctly on Windows even when datetime.now().astimezone() reports UTC.
    """
    # Check if daylight saving is in effect
    if time.daylight and time.localtime().tm_isdst > 0:
        offset_seconds = -time.altzone
    else:
        offset_seconds = -time.timezone
    return timezone(timedelta(seconds=offset_seconds))


def get_local_now() -> datetime:
    """
    Get current local time with correct timezone.
    Works around Windows Python timezone issues.
    """
    local_tz = get_local_timezone()
    return datetime.now(local_tz)


def log_debug(msg: str):
    """
    Log debug message to stderr for kernel debugging.
    Only logs when DATABRICKS_KERNEL_DEBUG=true environment variable is set.
    """
    if not DEBUG_MODE:
        return
    import sys
    print(f"[KERNEL DEBUG] {msg}", file=sys.stderr, flush=True)


def normalize_host(host: str) -> str:
    """
    Normalize a Databricks host URL for comparison.

    Args:
        host: Databricks workspace host URL

    Returns:
        Normalized host URL (lowercase, with https://, without trailing slash)
    """
    normalized = host.rstrip('/').lower()
    if not normalized.startswith('https://'):
        normalized = f'https://{normalized}'
    return normalized


def get_databricks_profile() -> str | None:
    """
    Get the Databricks profile to use from environment variable only.
    No auto-selection - profile must be explicitly set by the extension.
    """
    profile = os.environ.get('DATABRICKS_CONFIG_PROFILE')
    return profile


def refresh_oauth_token(host: str, refresh_token: str) -> dict | None:
    """
    Refresh an OAuth token using the refresh_token.

    Args:
        host: Databricks workspace host URL
        refresh_token: OAuth refresh token

    Returns:
        New token data dict or None if refresh fails.
    """
    try:
        normalized_host = normalize_host(host)
        token_url = f"{normalized_host}/oidc/v1/token"

        data = urllib.parse.urlencode({
            'grant_type': 'refresh_token',
            'refresh_token': refresh_token,
            'client_id': 'databricks-cli',
        }).encode('utf-8')

        req = urllib.request.Request(token_url, data=data, method='POST')
        req.add_header('Content-Type', 'application/x-www-form-urlencoded')

        with urllib.request.urlopen(req, timeout=30) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as e:
        log_debug(f"Token refresh failed: {e}")
        return None


def is_token_expired(expiry_str: str) -> bool:
    """
    Check if a token is expired or about to expire (within 5 minutes).

    Args:
        expiry_str: ISO format expiry timestamp (e.g., "2025-12-03T19:23:27.6919132+10:30")

    Returns:
        True if token is expired or expiring within 5 minutes.
    """
    try:
        # Handle format: "2025-12-03T19:23:27.6919132+10:30"
        # Python's fromisoformat has issues with:
        # 1. Microseconds > 6 digits
        # 2. Timezone offsets with colons in older Python versions

        # Truncate microseconds to 6 digits
        expiry_clean = re.sub(r'(\.\d{6})\d+', r'\1', expiry_str)

        # Try parsing directly (Python 3.11+ handles +HH:MM well)
        try:
            expiry = datetime.fromisoformat(expiry_clean)
        except ValueError:
            # Fallback: manually parse timezone offset
            # Split datetime and timezone: "2025-12-03T19:23:27.691913" and "+10:30"
            if '+' in expiry_clean:
                dt_part, tz_part = expiry_clean.rsplit('+', 1)
                tz_sign = 1
            elif expiry_clean.count('-') > 2:  # Has negative timezone
                # Find the last '-' that's part of timezone (after T and time)
                t_idx = expiry_clean.index('T')
                last_dash = expiry_clean.rfind('-')
                if last_dash > t_idx:
                    dt_part = expiry_clean[:last_dash]
                    tz_part = expiry_clean[last_dash + 1:]
                    tz_sign = -1
                else:
                    dt_part = expiry_clean
                    tz_part = None
                    tz_sign = 0
            else:
                dt_part = expiry_clean
                tz_part = None
                tz_sign = 0

            # Parse datetime part
            expiry = datetime.fromisoformat(dt_part)

            # Apply timezone if present
            if tz_part and ':' in tz_part:
                hours, minutes = map(int, tz_part.split(':'))
                tz_offset = timedelta(hours=hours, minutes=minutes) * tz_sign
                expiry = expiry.replace(tzinfo=timezone(tz_offset))
            else:
                expiry = expiry.replace(tzinfo=timezone.utc)

        # Check if expired or expiring within 5 minutes
        # Use local timezone for comparison (uses time module to get correct Windows timezone)
        now = get_local_now()
        buffer = timedelta(minutes=5)

        # Convert expiry to local timezone for comparison
        local_tz = get_local_timezone()
        expiry_local = expiry.astimezone(local_tz) if expiry.tzinfo else expiry.replace(tzinfo=local_tz)

        is_expired = now + buffer >= expiry_local
        log_debug(f"Token expiry check: now={now.isoformat()}, expiry={expiry_local.isoformat()}, expired={is_expired}")
        return is_expired
    except Exception as e:
        log_debug(f"Failed to parse expiry time '{expiry_str}': {e}")
        # If we can't parse, assume it might be expired to trigger refresh
        return True


def _update_token_cache(cache_path: str, host: str, token_data: dict) -> None:
    """
    Update the token cache with new token data.

    Args:
        cache_path: Path to token cache JSON file
        host: Databricks workspace host URL
        token_data: New token data from OAuth refresh
    """
    try:
        with open(cache_path, 'r') as f:
            cache = json.load(f)

        normalized_host = normalize_host(host)

        # Find and update the matching entry
        for key in list(cache.get('tokens', {}).keys()):
            if normalize_host(key) == normalized_host:
                # Calculate expiry time using local timezone (matches Databricks CLI behavior)
                expires_in = token_data.get('expires_in', 3600)
                expiry = get_local_now() + timedelta(seconds=expires_in)

                cache['tokens'][key] = {
                    'access_token': token_data.get('access_token'),
                    'token_type': token_data.get('token_type', 'Bearer'),
                    'refresh_token': token_data.get('refresh_token'),
                    'expiry': expiry.isoformat(),
                    'expires_in': expires_in,
                }
                break

        with open(cache_path, 'w') as f:
            json.dump(cache, f, indent=2)
        log_debug(f"Token cache updated for host: {host}")
    except Exception as e:
        log_debug(f"Failed to update token cache: {e}")


def get_token_from_cache(host: str) -> str | None:
    """
    Get token from Databricks CLI token cache with EXACT host matching.
    Automatically refreshes expired tokens using the refresh_token.

    Args:
        host: Databricks workspace host URL

    Returns:
        Access token string or None if not found.
    """
    cache_path = os.path.expanduser(DATABRICKS_TOKEN_CACHE)
    if not os.path.exists(cache_path):
        return None

    try:
        with open(cache_path, 'r') as f:
            cache = json.load(f)

        tokens = cache.get('tokens', {})
        normalized_host = normalize_host(host)

        # EXACT match only - no substring matching or fallback
        for key, token_data in tokens.items():
            if normalize_host(key) == normalized_host:
                access_token = token_data.get('access_token')
                refresh_token = token_data.get('refresh_token')
                expiry = token_data.get('expiry')

                # Check if token is expired or about to expire
                if expiry and is_token_expired(expiry):
                    log_debug(f"Token expired (expiry: {expiry}), attempting refresh...")
                    if refresh_token:
                        new_token_data = refresh_oauth_token(host, refresh_token)
                        if new_token_data and new_token_data.get('access_token'):
                            log_debug("Token refresh successful!")
                            _update_token_cache(cache_path, host, new_token_data)
                            return new_token_data.get('access_token')
                        else:
                            log_debug("Token refresh failed, returning expired token")
                    else:
                        log_debug("No refresh token available")

                return access_token

        # No fallback to first token - return None if no exact match
        return None
    except Exception as e:
        log_debug(f"Error reading token cache: {e}")

    return None


def get_host_from_profile(profile: str) -> str | None:
    """
    Get the host URL from a Databricks profile configuration.

    Args:
        profile: Profile name to look up

    Returns:
        Host URL or None if not found.
    """
    config_path = os.path.expanduser(DATABRICKS_CONFIG_FILE)
    if not os.path.exists(config_path):
        return None

    try:
        config = configparser.ConfigParser()
        config.read(config_path)
        if config.has_option(profile, 'host'):
            return config.get(profile, 'host')
    except Exception as e:
        log_debug(f"Failed to read host from profile: {e}")

    return None


def get_auth_type_from_profile(profile: str) -> str | None:
    """
    Get the auth_type from a Databricks profile configuration.

    Args:
        profile: Profile name to look up

    Returns:
        Auth type string or None if not found.
    """
    config_path = os.path.expanduser(DATABRICKS_CONFIG_FILE)
    if not os.path.exists(config_path):
        return None

    try:
        config = configparser.ConfigParser()
        config.read(config_path)
        if config.has_option(profile, 'auth_type'):
            return config.get(profile, 'auth_type')
    except Exception as e:
        log_debug(f"Failed to read auth_type from profile: {e}")

    return None
