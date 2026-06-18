declare const process: {
  env: Record<string, string | undefined>;
  platform: string;
  exit: (code?: number) => never;
};

declare const Bun: {
  spawnSync: (cmd: string[], opts?: Record<string, unknown>) => {
    stdout: Uint8Array;
    stderr: Uint8Array;
    exitCode: number;
  };
};

export const CREDENTIAL_SERVICE = 'splunk-nexus';

export type CredentialSource = 'os-store';

// ── read ──────────────────────────────────────────────────────

function readFromMacKeychain(): { username: string; password: string } | null {
  try {
    const pwResult = Bun.spawnSync(['security', 'find-generic-password', '-s', CREDENTIAL_SERVICE, '-w']);
    if (pwResult.exitCode !== 0) return null;
    const password = new TextDecoder().decode(pwResult.stdout).trim();
    if (!password) return null;

    const infoResult = Bun.spawnSync(['security', 'find-generic-password', '-s', CREDENTIAL_SERVICE]);
    if (infoResult.exitCode !== 0) return null;
    const info = new TextDecoder().decode(infoResult.stdout);
    const match = info.match(/"acct"<blob>="([^"]+)"/);
    if (!match) return null;

    return { username: match[1], password };
  } catch {
    return null;
  }
}

function readFromWindowsCredentialStore(): { username: string; password: string } | null {
  try {
    const ps = [
      '$ErrorActionPreference = "Stop"',
      `$path = "$env:USERPROFILE\\.${CREDENTIAL_SERVICE}-credentials"`,
      'if (-not (Test-Path $path)) { exit 1 }',
      '$data = Get-Content $path -Raw | ConvertFrom-Json',
      '$secure = $data.password | ConvertTo-SecureString',
      '$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)',
      '$plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)',
      '[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)',
      'Write-Output $data.username',
      'Write-Output $plain',
    ].join('; ');

    const result = Bun.spawnSync(['powershell', '-NoProfile', '-NonInteractive', '-Command', ps]);
    if (result.exitCode !== 0) return null;

    const lines = new TextDecoder().decode(result.stdout).trim().split(/\r?\n/);
    if (lines.length < 2 || !lines[0] || !lines[1]) return null;

    return { username: lines[0], password: lines[1] };
  } catch {
    return null;
  }
}

// ── write ─────────────────────────────────────────────────────

function storeToMacKeychain(username: string, password: string) {
  Bun.spawnSync(
    ['security', 'delete-generic-password', '-s', CREDENTIAL_SERVICE],
    { stdout: 'pipe', stderr: 'pipe' },
  );

  const result = Bun.spawnSync([
    'security', 'add-generic-password',
    '-s', CREDENTIAL_SERVICE,
    '-a', username,
    '-w', password,
  ]);

  if (result.exitCode !== 0) {
    console.error('failed to store credentials in Keychain');
    return false;
  }

  return true;
}

function storeToWindowsCredentialStore(username: string, password: string) {
  const ps = [
    '$ErrorActionPreference = "Stop"',
    `$plain = '${password.replace(/'/g, "''")}'`,
    '$secure = ConvertTo-SecureString $plain -AsPlainText -Force',
    `$path = "$env:USERPROFILE\\.${CREDENTIAL_SERVICE}-credentials"`,
    '@{',
    `  username = '${username.replace(/'/g, "''")}'`,
    '  password = $secure | ConvertFrom-SecureString',
    '} | ConvertTo-Json | Set-Content $path',
  ].join('\n');

  const result = Bun.spawnSync(['powershell', '-NoProfile', '-NonInteractive', '-Command', ps]);
  return result.exitCode === 0;
}

export function storeCredentials(username: string, password: string) {
  if (process.platform === 'darwin') {
    return storeToMacKeychain(username, password);
  }

  if (process.platform === 'win32') {
    return storeToWindowsCredentialStore(username, password);
  }

  return false;
}

// ── prompt ────────────────────────────────────────────────────

export function promptFullCredentials(): { username: string; password: string } | null {
  if (process.platform === 'darwin') {
    const result = Bun.spawnSync(
      ['bash', '-c', 'read -p "username (e.g. bogu): " user && read -sp "password: " pass && printf "\\n" >&2 && printf "%s\\n%s" "$user" "$pass"'],
      { stdin: 'inherit', stderr: 'inherit' },
    );
    if (result.exitCode !== 0) return null;
    const parts = new TextDecoder().decode(result.stdout).split('\n');
    if (!parts[0]?.trim() || !parts[1]) return null;
    return { username: parts[0].trim(), password: parts[1] };
  }

  if (process.platform === 'win32') {
    const ps = [
      '$ErrorActionPreference = "Stop"',
      '$cred = Get-Credential -Message "Enter your Splunk credentials (e.g. username: bogu)"',
      'if (-not $cred) { exit 1 }',
      '$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($cred.Password)',
      '$plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)',
      '[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)',
      'Write-Output $cred.UserName',
      'Write-Output $plain',
    ].join('; ');
    const result = Bun.spawnSync(['powershell', '-NoProfile', '-Command', ps], { stdin: 'inherit' });
    if (result.exitCode !== 0) return null;
    const lines = new TextDecoder().decode(result.stdout).trim().split(/\r?\n/);
    if (lines.length < 2 || !lines[0] || !lines[1]) return null;
    return { username: lines[0], password: lines[1] };
  }

  return null;
}

// ── resolve ───────────────────────────────────────────────────

export function resolveCredentials(): { username: string; password: string; source: CredentialSource } {
  // OS credential store
  if (process.platform === 'darwin') {
    const creds = readFromMacKeychain();
    if (creds) return { ...creds, source: 'os-store' };
  } else if (process.platform === 'win32') {
    const creds = readFromWindowsCredentialStore();
    if (creds) return { ...creds, source: 'os-store' };
  }

  console.error('');
  console.error('No Splunk credentials found.');
  console.error('');
  console.error('Run the one-time credential setup:');
  console.error('  bun scripts/setup-credentials.ts');
  console.error('');
  process.exit(1);
}
