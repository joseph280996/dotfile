#!/usr/bin/env bun
import { resolveCredentials, promptFullCredentials, storeCredentials } from './credentials';

declare const process: {
  env: Record<string, string | undefined>;
  exit: (code?: number) => never;
};

/**
 * cancel a running splunk search job.
 *
 * usage:
 *   SPLUNK_HOST=<host> SPLUNK_SID=<sid> bun kill-job.ts
 *
 * env:
 *   SPLUNK_HOST  – e.g. https://splunk-awsdev.ezesoft.net
 *   SPLUNK_SID   – job sid returned by query.ts
 */

const SPLUNK_HOST = process.env.SPLUNK_HOST;
const SID = process.env.SPLUNK_SID;
const TLS_OPTS = { tls: { rejectUnauthorized: false } };

if (!SPLUNK_HOST || !SID) {
  console.error('Required env vars: SPLUNK_HOST, SPLUNK_SID');
  process.exit(1);
}

let { username: USER, password: PASS, source: CRED_SOURCE } = resolveCredentials();

async function tryLogin(username: string, password: string): Promise<{ url: string; sessionKey: string } | 'auth-failed'> {
  let sawAuthFailure = false;

  for (const port of [8089, 443]) {
    const base = `${SPLUNK_HOST}:${port}`;
    try {
      const resp = await fetch(`${base}/services/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username, password, output_mode: 'json' }).toString(),
        // @ts-ignore
        ...TLS_OPTS,
      });
      const data = await resp.json() as { sessionKey?: string };
      if (resp.ok && data.sessionKey) {
        console.error(`authenticated on ${base}`);
        return { url: base, sessionKey: data.sessionKey };
      }
      if (resp.status === 401) sawAuthFailure = true;
      console.error(`port ${port}: ${resp.status}`);
    } catch (e: unknown) {
      console.error(`port ${port}: ${(e as Error).message}`);
    }
  }

  return sawAuthFailure ? 'auth-failed' : 'auth-failed';
}

async function login(): Promise<{ url: string; sessionKey: string }> {
  const result = await tryLogin(USER, PASS);
  if (result !== 'auth-failed') return result;

  if (CRED_SOURCE === 'os-store') {
    console.error('');
    console.error('Login failed — your username or password may be incorrect.');
    console.error('');
    const creds = promptFullCredentials();
    if (creds) {
      const retry = await tryLogin(creds.username, creds.password);
      if (retry !== 'auth-failed') {
        storeCredentials(creds.username, creds.password);
        console.error('credentials updated in credential store');
        return retry;
      }
      console.error('login still failed with the new credentials');
    }
  } else {
    console.error('');
    console.error('Login failed — your username or password may be incorrect.');
    console.error('Set up the OS credential store for automatic re-prompting:');
    console.error('  bun scripts/setup-credentials.ts');
  }

  console.error('');
  process.exit(1);
}

async function cancelJob(url: string, sessionKey: string, sid: string) {
  const resp = await fetch(`${url}/services/search/jobs/${encodeURIComponent(sid)}/control`, {
    method: 'POST',
    headers: {
      Authorization: `Splunk ${sessionKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ action: 'cancel' }).toString(),
    // @ts-ignore
    ...TLS_OPTS,
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error(`failed to cancel sid=${sid} (${resp.status}): ${body}`);
    process.exit(1);
  }

  console.log(`cancelled sid=${sid}`);
}

const { url, sessionKey } = await login();
await cancelJob(url, sessionKey, SID);

export {};