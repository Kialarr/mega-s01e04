import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/index.js';

const night = '2026-10-28';
const tempDirs: string[] = [];

async function runsDir(log?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rig-digest-'));
  tempDirs.push(dir);
  if (log !== undefined) await writeFile(join(dir, `${night}.jsonl`), log);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('run-log reader', () => {
  it('reads the real night as five sorted jobs and one bad line without altering offsets', async () => {
    expect(await readNight('runs', night)).toEqual({
      night,
      badLines: 1,
      counts: { ok: 10, retry: 4, fail: 1 },
      rows: [
        {
          job: 'digest/render', owner: null, runs: 1, retries: 0, failures: 0,
          lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00',
        },
        {
          job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, failures: 0,
          lastStatus: 'ok', lastError: 'upstream 503',
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
        },
        {
          job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, failures: 0,
          lastStatus: 'ok', lastError: 'lock held',
          firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00',
        },
        {
          job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, failures: 1,
          lastStatus: 'fail', lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00',
        },
        {
          job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, failures: 0,
          lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00',
        },
      ],
    });
  });

  it('distinguishes a missing night from an empty or whitespace-only night', async () => {
    expect(await readNight(await runsDir(), night)).toBeNull();
    for (const log of ['', ' \r\n\n\t']) {
      expect(await readNight(await runsDir(log), night)).toEqual({
        night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
      });
    }
  });

  it('counts invalid JSON and invalid records, continuing through CRLF and a final line without newline', async () => {
    const record = { at: '2026-10-28T23:00:00-04:00', job: 'job', owner: null, status: 'ok' };
    const invalid = [
      '{', 'null', '[]', '42', '{}',
      JSON.stringify({ ...record, status: 'unknown' }),
      JSON.stringify({ ...record, owner: 12 }),
      JSON.stringify({ ...record, owner: undefined }),
      JSON.stringify({ ...record, job: '' }),
      JSON.stringify({ ...record, at: 'not a time' }),
      JSON.stringify({ ...record, at: '2026-10-28T23:00:00' }),
      JSON.stringify({ ...record, error: null }),
    ];
    const log = [JSON.stringify(record), ...invalid, '', JSON.stringify(record)].join('\r\n');
    const result = await readNight(await runsDir(log), night);
    expect(result?.badLines).toBe(invalid.length);
    expect(result?.counts).toEqual({ ok: 2, retry: 0, fail: 0 });
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0]).toMatchObject({ runs: 2, owner: null, firstAt: record.at, lastAt: record.at });
  });

  it('orders instants across offsets, keeps the last error after recovery, and breaks ties by log order', async () => {
    const log = [
      { at: '2026-10-29T00:30:00Z', job: 'job', owner: 'latest', status: 'retry', error: 'latest error' },
      { at: '2026-10-29T01:00:00+02:00', job: 'job', owner: 'early', status: 'fail', error: 'early error' },
      { at: '2026-10-28T20:30:00-04:00', job: 'job', owner: null, status: 'ok' },
    ].map((record) => JSON.stringify(record)).join('\n');
    expect((await readNight(await runsDir(log), night))?.rows).toEqual([{
      job: 'job', owner: null, runs: 3, retries: 1, failures: 1,
      lastStatus: 'ok', lastError: 'latest error',
      firstAt: '2026-10-29T01:00:00+02:00', lastAt: '2026-10-28T20:30:00-04:00',
    }]);
  });

  it('does not use object prototype keys to group jobs', async () => {
    const log = ['toString', '__proto__'].map((job) => JSON.stringify({
      at: '2026-10-28T00:00:00Z', job, owner: null, status: 'ok',
    })).join('\n');
    expect((await readNight(await runsDir(log), night))?.rows.map((row) => row.job))
      .toEqual(['__proto__', 'toString']);
  });

  it('rejects paths and invalid calendar dates rather than reading them', async () => {
    const dir = await runsDir('');
    for (const invalid of ['../2026-10-28', '/2026-10-28', '2026-10-28.jsonl', '2026-02-30', '2026-13-01']) {
      expect(await readNight(dir, invalid)).toBeNull();
    }
  });

  it('propagates I/O errors other than a missing file', async () => {
    const dir = await runsDir();
    await mkdir(join(dir, `${night}.jsonl`));
    await expect(readNight(dir, night)).rejects.toMatchObject({ code: 'EISDIR' });
  });
});
