import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

describe('status board', () => {
  it('shows the lane banner and the nights on disk', async () => {
    process.env.LANE_MARKER = 'TEST-MARKER';
    const res = await createApp(config).request('/');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('TEST-MARKER');
    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a>');
    expect(html).toContain('<a href="/digest/2026-10-27">2026-10-27</a>');
    expect(html.indexOf('/digest/2026-10-28')).toBeLessThan(html.indexOf('/digest/2026-10-27'));
  });

  it('shows record counts including retries and failures before recovery, and zeroes for an empty night', async () => {
    const runsDir = await mkdtemp(join(tmpdir(), 'rig-board-'));
    try {
      const records = ['retry', 'retry', 'fail', 'ok', 'ok'].map((status) => JSON.stringify({
        at: '2026-10-28T01:00:00+01:00', job: 'recovered', owner: null, status,
      }));
      await writeFile(join(runsDir, '2026-10-28.jsonl'), [...records, 'bad line'].join('\n'));
      await writeFile(join(runsDir, '2026-10-27.jsonl'), '');
      const res = await createApp({ ...config, runsDir }).request('/');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a> · ok 2 / retry 2 / fail 1');
      expect(html).toContain('<a href="/digest/2026-10-27">2026-10-27</a> · ok 0 / retry 0 / fail 0');
    } finally {
      await rm(runsDir, { recursive: true, force: true });
    }
  });

  it('keeps the empty board message when no nights exist', async () => {
    const runsDir = await mkdtemp(join(tmpdir(), 'rig-board-'));
    try {
      const res = await createApp({ ...config, runsDir }).request('/');
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('nothing in runs/');
    } finally {
      await rm(runsDir, { recursive: true, force: true });
    }
  });

  it('health answers with the lane id', async () => {
    const res = await createApp(config).request('/health');
    expect(await res.json()).toEqual({ ok: true, lane: 'lane-07' });
  });
});
