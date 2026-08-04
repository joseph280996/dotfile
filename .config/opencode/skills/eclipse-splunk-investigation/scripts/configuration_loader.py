#!/usr/bin/env python3
"""Configuration loader for Splunk queries.

Loads configuration from multiple sources in priority order:
1. Environment variables (highest priority - allows override)
2. .env file (for SPLUNK_HOST and SPLUNK_USERNAME)
3. OS keyring (for SPLUNK_PASSWORD)
"""

import os
import sys
from pathlib import Path
from typing import Set

KEYRING_SERVICE = "eclipse-splunk-investigation"
KEYRING_USERNAME = "SPLUNK_PASSWORD"


class KeyringConfigurationError(RuntimeError):
    """Raised when keyring-backed credential loading cannot be completed."""


def _skill_root() -> Path:
    """Return the skill root directory."""
    return Path(__file__).resolve().parent.parent


def _setup_script_path() -> Path:
    """Return the path to the interactive setup script."""
    return _skill_root() / "scripts" / "setup.py"


def _emit_keyring_setup_help(reason: str) -> None:
    """Print actionable instructions when keyring-backed auth is unavailable."""
    print(reason, file=sys.stderr)
    print(f"[help] Loaded skill root: {_skill_root()}", file=sys.stderr)
    print(
        "[help] This skill expects SPLUNK_PASSWORD in your OS keyring "
        f"(service={KEYRING_SERVICE}, username={KEYRING_USERNAME}).",
        file=sys.stderr,
    )
    print("[help] To configure it:", file=sys.stderr)
    print(
        f"  1. Run the setup script: python3 {_setup_script_path()}",
        file=sys.stderr,
    )
    print("  2. Or store only the password manually:", file=sys.stderr)
    print(
        "     python3 -c \"import keyring; "
        f"keyring.set_password('{KEYRING_SERVICE}', '{KEYRING_USERNAME}', 'your-password')\"",
        file=sys.stderr,
    )
    print(
        "[help] SPLUNK_HOST and SPLUNK_USERNAME still come from your environment "
        "or the skill's .env file.",
        file=sys.stderr,
    )


def _parse_env_file(allowed_keys: Set[str]) -> dict[str, str]:
    """Parse .env file and return values for allowed keys.

    Args:
        allowed_keys: Set of keys to extract from .env file

    Returns:
        Dictionary of key-value pairs for allowed keys that aren't already in os.environ
    """
    env_path = _skill_root() / ".env"
    if not env_path.exists():
        return {}

    result = {}
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")

            # Only load allowed keys that aren't already in environment
            if key in allowed_keys and key not in os.environ:
                result[key] = value

    return result


def load_from_env_file() -> None:
    """Load configuration from .env file if values not already in environment.

    Only loads SPLUNK_HOST and SPLUNK_USERNAME from .env.
    Does NOT load SPLUNK_PASSWORD from .env (use keyring for that).
    """
    values = _parse_env_file({"SPLUNK_HOST", "SPLUNK_USERNAME"})
    os.environ.update(values)


def load_from_keyring() -> None:
    """Load SPLUNK_PASSWORD from OS keyring if not already in environment."""
    # Check if password is already in environment (from user override or .env fallback)
    if os.environ.get("SPLUNK_PASSWORD"):
        return

    # Try loading from keyring
    try:
        import keyring
    except ImportError as exc:
        raise KeyringConfigurationError(
            "[error] keyring module not available. "
            "Install it with: python3 -m pip install keyring"
        ) from exc

    password = keyring.get_password(KEYRING_SERVICE, KEYRING_USERNAME)
    if not password:
        raise KeyringConfigurationError(
            "[error] SPLUNK_PASSWORD was not found in the OS keyring."
        )

    os.environ["SPLUNK_PASSWORD"] = password


def load_password_from_env_file_fallback() -> None:
    """DEPRECATED: Load SPLUNK_PASSWORD from .env as last resort fallback.

    This is for backwards compatibility only. Keyring is strongly preferred.
    """
    if os.environ.get("SPLUNK_PASSWORD"):
        return

    values = _parse_env_file({"SPLUNK_PASSWORD"})
    if values:
        print(
            "[warning] Loading SPLUNK_PASSWORD from .env file. "
            "This is deprecated and insecure. "
            f"Migrate to keyring: python3 {_setup_script_path()}",
            file=sys.stderr,
        )
        os.environ.update(values)


def load_configuration() -> None:
    """Load all Splunk configuration from environment, .env file, and keyring.

    Priority order:
    1. Environment variables (always checked first, allows override)
    2. .env file for SPLUNK_HOST and SPLUNK_USERNAME
    3. Keyring for SPLUNK_PASSWORD
    4. .env file for SPLUNK_PASSWORD (deprecated fallback)
    """
    # Load non-sensitive config from .env file (if not in environment)
    load_from_env_file()

    # Load password from keyring (if not in environment)
    keyring_error: KeyringConfigurationError | None = None
    try:
        load_from_keyring()
    except KeyringConfigurationError as exc:
        keyring_error = exc
        # Keyring failed, try .env fallback for backwards compatibility
        load_password_from_env_file_fallback()

    if not os.environ.get("SPLUNK_PASSWORD"):
        if keyring_error is not None:
            _emit_keyring_setup_help(str(keyring_error))
        print(
            "[error] SPLUNK_PASSWORD not found in environment, keyring, or .env file.",
            file=sys.stderr,
        )
        sys.exit(1)
