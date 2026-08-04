# Scripts Directory

This directory contains the Python scripts for the eclipse-splunk-investigation skill.

## Configuration Script

### `setup.py`

One-time setup script that configures all Splunk credentials.

**Interactive mode** (recommended):
```bash
python3 setup.py
```

The script will:
1. Prompt for SPLUNK_HOST (defaults to `splunk-awsprod.ezesoft.net`)
2. Prompt for SPLUNK_USERNAME
3. Securely prompt for SPLUNK_PASSWORD
4. Store password in OS keyring (secure)
5. Create `.env` file with host and username

**Non-interactive mode** (for automation):
```bash
python3 setup.py --host splunk-awsprod.ezesoft.net --username myuser --password mypass
```

**Via environment variables**:
```bash
SPLUNK_HOST=splunk-awsprod.ezesoft.net SPLUNK_USERNAME=myuser SPLUNK_PASSWORD=mypass python3 setup.py
```

After running this script, you're ready to run queries immediately.

## Query Scripts

### `splunk_query.py`

Main query script for investigating Eclipse service logs.

**Prerequisites**: Run `setup.py` first to set up credentials.

**Examples**:
```bash
# Recent errors for a service
python3 splunk_query.py --service publisher --level ERROR --earliest -1h

# Track a job across all services
python3 splunk_query.py --service all --job-id "abc-123-xyz" --earliest -24h

# Custom SPL query
python3 splunk_query.py --raw-spl 'search index=main sourcetype="..." | stats count by Level'
```

See [SKILL.md](../SKILL.md) for full usage documentation.

### `splunk_explorer.py`

Schema discovery script for finding indexes, sourcetypes, and field names.

**Prerequisites**: Run `setup.py` first to set up credentials.

**Examples**:
```bash
# List available indexes
python3 splunk_explorer.py --mode list_indexes --pretty

# List sourcetypes in an index
python3 splunk_explorer.py --mode list_sourcetypes --index main --pretty

# Discover exact field names for a sourcetype
python3 splunk_explorer.py \
  --mode list_fields \
  --index main \
  --sourcetype "kube:container:publisher-service" \
  --pretty
```

## Utility Module

### `configuration_loader.py`

Internal module imported by the query scripts. Not meant to be run directly.

Functions:
- `load_from_env_file()`: Loads SPLUNK_HOST and SPLUNK_USERNAME from .env file
- `load_from_keyring()`: Loads SPLUNK_PASSWORD from OS keyring
- `load_password_from_env_file_fallback()`: Deprecated fallback for password from .env
- `load_configuration()`: Main entry point - orchestrates all configuration loading

Configuration priority:
1. Environment variables (highest priority)
2. .env file for SPLUNK_HOST and SPLUNK_USERNAME
3. Keyring for SPLUNK_PASSWORD
4. .env file for SPLUNK_PASSWORD (deprecated fallback)

## Configuration Flow

```
┌──────────────────────────────────────────────┐
│ setup.py (one-time setup)                    │
│                                              │
│  1. Prompt for host, username, password      │
│  2. Store password in OS keyring             │
│  3. Create .env file with host/username      │
└──────────────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
┌──────────────────┐      ┌──────────────────┐
│ OS Keyring       │      │ .env file        │
│                  │      │                  │
│ SPLUNK_PASSWORD  │      │ SPLUNK_HOST      │
│                  │      │ SPLUNK_USERNAME  │
└──────────────────┘      └──────────────────┘
        │                         │
        └────────────┬────────────┘
                     ▼
┌──────────────────────────────────────────────┐
│ configuration_loader.py                      │
│                                              │
│  Priority 1: Environment variables           │
│  Priority 2: .env (HOST, USERNAME)           │
│  Priority 3: Keyring (PASSWORD)              │
│  Priority 4: .env fallback (PASSWORD)        │
└──────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────┐
│ splunk_query.py / splunk_explorer.py         │
│                                              │
│  1. Import configuration_loader              │
│  2. Call load_configuration()                │
│  3. All config now in os.environ             │
│  4. Execute Splunk query                     │
└──────────────────────────────────────────────┘
```

## Troubleshooting

### "No keyring entry found"
The password is now expected in the OS keyring under:

- service: `eclipse-splunk-investigation`
- username: `SPLUNK_PASSWORD`

Set it up with either:

```bash
python3 scripts/setup.py
```

Or, if host and username are already configured, store only the password:

```bash
python3 -c "import keyring; keyring.set_password('eclipse-splunk-investigation', 'SPLUNK_PASSWORD', 'your-password')"
```

### "keyring module not available"
Install keyring, then run setup:

```bash
python3 -m pip install keyring
python3 scripts/setup.py
```

### "SPLUNK_HOST environment variable is not set"
Run `setup.py` to create the `.env` file with your configuration.

### Still using .env file with password
The scripts fall back to loading SPLUNK_PASSWORD from .env for backwards compatibility, but this is deprecated and insecure. To migrate:
1. Delete your old `.env` file: `rm ../.env`
2. Run `setup.py` to create a new `.env` and store password in keyring
