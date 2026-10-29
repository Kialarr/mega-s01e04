import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest } from '../src/digest/types.js';

const night = '2026-10-28';
const at = '2026-10-28T03:00:00+01:00';
const records = [
  { at, job: 'zebra-job', owner: null, status: 'fail', error: 'disk full' },
  { at, job: 'Alpha-job', owner: 'Ada', status: 'ok' },
  { at, job: 'middle-job', owner: 'Mo', status: 'retry' },
];
const expected: NightDigest = {
  night,
  rows: [
    { job: 'Alpha-job', owner: 'Ada', runs: 1, retries: 0, failures: 0,
      lastStatus: 'ok', lastError: null, firstAt: at, lastAt: at },
    { job: 'middle-job', owner: 'Mo', runs: 1, retries: 1, failures: 0,
      lastStatus: 'retry', lastError: null, firstAt: at, lastAt: at },
    { job: 'zebra-job', owner: null, runs: 1, retries: 0, failures: 1,
      lastStatus: 'fail', lastError: 'disk full', firstAt: at, lastAt: at },
  ],
  badLines: 0,
  counts: { ok: 1, retry: 1, fail: 1 },
};

// Read the first cell of each data row, ignoring presentation wrappers.
function pageJobs(html: string): string[] {
  const body = html.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] ?? '';
  return [...body.matchAll(/<tr\b[^>]*>\s*<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
    .map((match) => match[1].replace(/<[^>]*>/g, '').trim());
}

describe('digest routes', () => {
  let runsDir: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), 'rig-digest-routes-'));
    app = createApp({ adapter: 'shim', installed: at, beatEverySeconds: 60, runsDir });
  });

  afterEach(async () => {
    await rm(runsDir, { recursive: true, force: true });
  });

  async function writeNight(contents: string) {
    await writeFile(join(runsDir, `${night}.jsonl`), contents);
  }

  it('serves HTML and the exact JSON digest with the same sorted jobs', async () => {
    await writeNight(records.map((record) => JSON.stringify(record)).join('\n'));
    const page = await app.request(`/digest/${night}`);
    const api = await app.request(`/api/digest/${night}`);

    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(api.status).toBe(200);
    expect(api.headers.get('content-type')).toContain('application/json');
    const digest: NightDigest = await api.json();
    expect(digest).toEqual(expected);
    const html = await page.text();
    expect(pageJobs(html)).toEqual(expected.rows.map((row) => row.job));
    expect(pageJobs(html)).toEqual(digest.rows.map((row) => row.job));
    expect(html).toContain('Ada');
    expect(html).toContain('—');
    expect(html).toContain('disk full');
    expect(html).toContain(at);
  });

  for (const route of ['/digest', '/api/digest']) {
    it(`${route} returns 404 for a missing night`, async () => {
      expect((await app.request(`${route}/${night}`)).status).toBe(404);
    });

    it.each(['not-a-date', '2026-02-30'])(`${route} returns 404 for invalid date %s`, async (invalid) => {
      // Even an existing file must not make an invalid night routable.
      await writeFile(join(runsDir, `${invalid}.jsonl`), '');
      expect((await app.request(`${route}/${invalid}`)).status).toBe(404);
    });
  }

  it('renders an empty night and returns an empty digest, not 404', async () => {
    await writeNight('');
    const page = await app.request(`/digest/${night}`);
    const api = await app.request(`/api/digest/${night}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html.toLowerCase()).toContain('nothing ran');
    expect(pageJobs(html)).toEqual([]);
    expect(api.status).toBe(200);
    expect(await api.json()).toEqual({
      night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('keeps valid rows in both routes when a malformed line interrupts the log', async () => {
    await writeNight([
      JSON.stringify(records[0]), '{broken json', '',
      ...records.slice(1).map((record) => JSON.stringify(record)),
    ].join('\n'));
    const page = await app.request(`/digest/${night}`);
    const api = await app.request(`/api/digest/${night}`);
    expect(page.status).toBe(200);
    expect(api.status).toBe(200);
    const digest: NightDigest = await api.json();
    expect(digest).toEqual({ ...expected, badLines: 1 });
    expect(pageJobs(await page.text())).toEqual(digest.rows.map((row) => row.job));
  });
});
