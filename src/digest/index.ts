import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DigestRow, NightDigest, ReadNight, RunStatus } from './types.js';

export type { DigestRow, NightDigest, ReadNight, RunStatus } from './types.js';

type RunRecord = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

function parseRecord(line: string): RunRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  if (!('at' in value) || typeof value.at !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.at)
    || !Number.isFinite(Date.parse(value.at))) return null;
  if (!('job' in value) || typeof value.job !== 'string' || !value.job.trim()) return null;
  if (!('status' in value)
    || (value.status !== 'ok' && value.status !== 'retry' && value.status !== 'fail')) return null;
  if (!('owner' in value) || (value.owner !== null && typeof value.owner !== 'string')) return null;
  const error = 'error' in value ? value.error : undefined;
  if (error !== undefined && typeof error !== 'string') return null;
  return {
    at: value.at,
    job: value.job,
    status: value.status,
    owner: value.owner,
    ...(error !== undefined ? { error } : {}),
  };
}

export const readNight: ReadNight = async (runsDir, night) => {
  // Only a date may select a file, never a path supplied by a route parameter.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;
  const date = Date.parse(`${night}T00:00:00Z`);
  if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== night) return null;

  let log: string;
  try {
    log = await readFile(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  const digest: NightDigest = { night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
  const records: RunRecord[] = [];
  for (const line of log.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const record = parseRecord(line);
    if (record) records.push(record);
    else digest.badLines++;
  }
  // Stable sort keeps file order when two events have the same instant.
  records.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const jobs = new Map<string, DigestRow>();
  for (const record of records) {
    digest.counts[record.status]++;
    let row = jobs.get(record.job);
    if (!row) {
      row = {
        job: record.job,
        owner: record.owner,
        runs: 0,
        retries: 0,
        failures: 0,
        lastStatus: record.status,
        lastError: null,
        firstAt: record.at,
        lastAt: record.at,
      };
      jobs.set(record.job, row);
    }
    row.runs++;
    if (record.status === 'retry') row.retries++;
    if (record.status === 'fail') row.failures++;
    row.owner = record.owner;
    row.lastStatus = record.status;
    if (record.error !== undefined) row.lastError = record.error;
    row.lastAt = record.at;
  }
  digest.rows = [...jobs.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return digest;
};
