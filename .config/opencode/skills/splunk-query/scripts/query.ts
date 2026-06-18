#!/usr/bin/env bun
import { resolveCredentials, promptFullCredentials, storeCredentials } from './credentials';

declare const process: {
  env: Record<string, string | undefined>;
  cwd: () => string;
  exit: (code?: number) => never;
};

declare const Bun: {
  $: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  write: (path: string, data: string) => Promise<unknown>;
};

/**
 * generic splunk query runner.
 *
 * usage:
 *   SPLUNK_HOST=<host> SPL=<query> [EARLIEST=-24h] [LATEST=now] bun query.ts
 *
 * env:
 *   SPLUNK_HOST  – e.g. https://splunk-awsdev.ezesoft.net
 *   SPL          – the SPL query to run (must start with "search")
 *   EARLIEST     – time range start (default: -24h)
 *   LATEST       – time range end (default: now)
 *   QUERY_TIMEOUT_MS – max time to wait for query completion (default: 60000)
 */

const SPLUNK_HOST = process.env.SPLUNK_HOST;
const SPL = process.env.SPL;
const EARLIEST = process.env.EARLIEST || '-24h';
const LATEST = process.env.LATEST || 'now';
const QUERY_TIMEOUT_MS = Number(process.env.QUERY_TIMEOUT_MS || '60000');

if (!SPLUNK_HOST || !SPL) {
  console.error('Required env vars: SPLUNK_HOST, SPL');
  process.exit(1);
}

const MAX_INLINE_ROWS = 50;
const MAX_RETRIES = 5;
const POLL_INTERVAL_MS = 2000;
const TLS_OPTS = { tls: { rejectUnauthorized: false } };
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || process.cwd();
const TMP_DIR = `${WORKSPACE_ROOT}/tmp`;

if (TMP_DIR.startsWith('/tmp/')) {
  console.error('Refusing to write under /tmp. Set WORKSPACE_ROOT to your workspace root.');
  process.exit(1);
}

if (!Number.isFinite(QUERY_TIMEOUT_MS) || QUERY_TIMEOUT_MS <= 0) {
  console.error('QUERY_TIMEOUT_MS must be a positive number.');
  process.exit(1);
}

// ── auth ──────────────────────────────────────────────────────

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
      const data = await resp.json() as { sessionKey?: string; messages?: { text: string }[] };
      if (resp.ok && data.sessionKey) {
        console.error(`authenticated on ${base}`);
        return { url: base, sessionKey: data.sessionKey };
      }
      if (resp.status === 401) sawAuthFailure = true;
      console.error(`port ${port}: ${resp.status} – ${data.messages?.[0]?.text ?? 'unknown error'}`);
    } catch (e: unknown) {
      console.error(`port ${port}: ${(e as Error).message}`);
    }
  }

  return sawAuthFailure ? 'auth-failed' : 'auth-failed';
}

async function login(): Promise<{ url: string; sessionKey: string }> {
  const result = await tryLogin(USER, PASS);
  if (result !== 'auth-failed') return result;

  // credentials may be wrong — re-prompt for both username and password
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

// ── search ────────────────────────────────────────────────────

type SplunkResult = Record<string, string>;

type SplunkJobStatus = {
  dispatchState?: string;
  isDone?: string | boolean;
  doneProgress?: number;
  eventCount?: number;
  resultCount?: number;
  scanCount?: number;
};

async function splunkRequest(url: string, options: RequestInit, attempt = 0): Promise<Response> {
  const resp = await fetch(url, {
    ...options,
    // @ts-ignore
    ...TLS_OPTS,
  });

  if (resp.status !== 503 || attempt >= MAX_RETRIES) {
    return resp;
  }

  const delay = 1000 * 2 ** attempt;
  console.error(`concurrency limit, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
  await new Promise(r => setTimeout(r, delay));
  return splunkRequest(url, options, attempt + 1);
}

async function createSearchJob(url: string, sessionKey: string): Promise<string> {
  const resp = await splunkRequest(`${url}/services/search/jobs`, {
    method: 'POST',
    headers: {
      Authorization: `Splunk ${sessionKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      search: SPL!,
      output_mode: 'json',
      earliest_time: EARLIEST,
      latest_time: LATEST,
    }).toString(),
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error(`failed to create search job (${resp.status}): ${body}`);
    process.exit(1);
  }

  const data = await resp.json() as { sid?: string };
  if (!data.sid) {
    console.error('splunk did not return a job sid');
    process.exit(1);
  }

  return data.sid;
}

async function getJobStatus(url: string, sessionKey: string, sid: string): Promise<SplunkJobStatus> {
  const resp = await splunkRequest(`${url}/services/search/jobs/${encodeURIComponent(sid)}?output_mode=json`, {
    method: 'GET',
    headers: { Authorization: `Splunk ${sessionKey}` },
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error(`failed to read job status (${resp.status}): ${body}`);
    process.exit(1);
  }

  const data = await resp.json() as { entry?: { content?: SplunkJobStatus }[] };
  return data.entry?.[0]?.content ?? {};
}

async function cancelJob(url: string, sessionKey: string, sid: string) {
  const resp = await splunkRequest(`${url}/services/search/jobs/${encodeURIComponent(sid)}/control`, {
    method: 'POST',
    headers: {
      Authorization: `Splunk ${sessionKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ action: 'cancel' }).toString(),
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error(`failed to cancel job ${sid} (${resp.status}): ${body}`);
    return;
  }

  console.error(`cancelled job ${sid}`);
}

async function waitForCompletion(url: string, sessionKey: string, sid: string) {
  const startedAt = Date.now();

  while (true) {
    const status = await getJobStatus(url, sessionKey, sid);
    const elapsed = Date.now() - startedAt;
    const isDone = status.isDone === true || status.isDone === '1';

    if (isDone) {
      return;
    }

    if (elapsed > QUERY_TIMEOUT_MS) {
      console.error(`query exceeded timeout (${QUERY_TIMEOUT_MS}ms), cancelling sid=${sid}`);
      await cancelJob(url, sessionKey, sid);
      console.error('query cancelled due to timeout. inspect SPL for broad filters or expensive commands and re-run with narrower scope or higher QUERY_TIMEOUT_MS.');
      process.exit(2);
    }

    const progress = typeof status.doneProgress === 'number' ? `${Math.round(status.doneProgress * 100)}%` : 'unknown';
    console.error(`waiting for sid=${sid}, dispatchState=${status.dispatchState ?? 'unknown'}, progress=${progress}, elapsed=${elapsed}ms`);
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

async function fetchResults(url: string, sessionKey: string, sid: string): Promise<SplunkResult[]> {
  const params = new URLSearchParams({
    output_mode: 'json',
    count: '0',
  });
  const resultsUrl = `${url}/services/search/jobs/${encodeURIComponent(sid)}/results?${params.toString()}`;
  const resp = await splunkRequest(resultsUrl, {
    method: 'GET',
    headers: { Authorization: `Splunk ${sessionKey}` },
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error(`failed to fetch results (${resp.status}): ${body}`);
    process.exit(1);
  }

  const data = await resp.json() as { results?: SplunkResult[] };
  return data.results ?? [];
}

// ── output ────────────────────────────────────────────────────

async function outputResults(results: SplunkResult[]) {
  if (!results.length) {
    console.log('(no results)');
    return;
  }

  console.log(`${results.length} result(s)`);

  if (results.length <= MAX_INLINE_ROWS) {
    console.table(results);
    return;
  }

  // large result set — save to workspace tmp/ folder
  await Bun.$`mkdir -p ${TMP_DIR}`;
  const tmpPath = `${TMP_DIR}/splunk-results-${Date.now()}.json`;
  await Bun.write(tmpPath, JSON.stringify(results, null, 2));
  console.log(`results saved to: ${tmpPath}`);

  // print first few rows as preview
  console.log('\npreview (first 10 rows):');
  console.table(results.slice(0, 10));
}

// ── main ──────────────────────────────────────────────────────

const { url, sessionKey } = await login();
const sid = await createSearchJob(url, sessionKey);
console.error(`created sid=${sid}`);
await waitForCompletion(url, sessionKey, sid);
const results = await fetchResults(url, sessionKey, sid);
await outputResults(results);

export {};
