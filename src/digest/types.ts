/** Status values accepted from a run-log record. */
export type RunStatus = 'ok' | 'retry' | 'fail';

export interface DigestRow {
  job: string;
  /** Owner on the latest record; null is meaningful, not a missing row. */
  owner: string | null;
  /** All valid records for this job, including retries and failures. */
  runs: number;
  retries: number;
  /** All fail records, even if a later record recovered. */
  failures: number;
  lastStatus: RunStatus;
  /** Most recent recorded error, retained after recovery; null if none. */
  lastError: string | null;
  /** Earliest/latest instants, preserving the original timestamp strings. */
  firstAt: string;
  lastAt: string;
}

export interface NightDigest {
  night: string;
  /** Sorted by job in ascending, case-sensitive string order. */
  rows: DigestRow[];
  /** Nonempty lines rejected as invalid JSON or invalid run records. */
  badLines: number;
  /** Record counts, not counts of jobs' final statuses. */
  counts: Record<RunStatus, number>;
}

/**
 * Implemented/exported as readNight in src/digest/index.ts.
 * Reads <runsDir>/<night>.jsonl (night is a YYYY-MM-DD date).
 * Missing files or invalid night names return null; other I/O errors reject.
 * Empty files return a digest with empty rows and zero counts.
 * Records are ordered by timestamp; ties use their order in the log.
 */
export type ReadNight = (runsDir: string, night: string) => Promise<NightDigest | null>;
