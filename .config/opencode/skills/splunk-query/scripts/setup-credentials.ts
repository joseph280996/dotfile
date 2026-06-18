#!/usr/bin/env bun
declare const process: {
  platform: string;
  exit: (code?: number) => never;
};

import { CREDENTIAL_SERVICE, promptFullCredentials, storeCredentials } from './credentials';

if (process.platform !== 'darwin' && process.platform !== 'win32') {
  console.error(`unsupported platform: ${process.platform}`);
  console.error('only macOS and Windows are supported for credential storage');
  process.exit(1);
}

console.log('Setting up Splunk credentials...');
console.log('');

const creds = promptFullCredentials();
if (!creds) {
  console.error('credential input cancelled');
  process.exit(1);
}

if (!storeCredentials(creds.username, creds.password)) {
  console.error('failed to store credentials');
  process.exit(1);
}

const location = process.platform === 'darwin'
  ? `macOS Keychain (service: ${CREDENTIAL_SERVICE})`
  : `Windows DPAPI (%USERPROFILE%\\.${CREDENTIAL_SERVICE}-credentials)`;
console.log(`credentials securely saved to ${location}`);
