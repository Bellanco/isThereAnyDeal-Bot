import { DatabaseSync } from 'node:sqlite';
import type { D1Database, D1PreparedStatement, D1Result } from '../src/d1-storage';
import migration1 from '../migrations/0001_i4_storage.sql?raw';
import migration2 from '../migrations/0002_i5_delivery.sql?raw';
import migration3 from '../migrations/0003_i6_detail_claims.sql?raw';
import migration4 from '../migrations/0004_i6_poll_gate.sql?raw';

/**
 * Unit-test stand-in for D1 over node:sqlite with the real migrations. Batches are
 * transactions like D1. It is NOT D1: `npm run test:d1`/`test:cron` cover local D1.
 */
export interface TestDatabase extends D1Database {
  raw: DatabaseSync;
  /** Throws a driver error for matching SQL until reset to null. */
  failWhen: ((sql: string) => boolean) | null;
}

export function createTestDatabase(): TestDatabase {
  const raw = new DatabaseSync(':memory:');
  raw.exec(migration1);
  raw.exec(migration2);
  raw.exec(migration3);
  raw.exec(migration4);
  const database: TestDatabase = {
    raw,
    failWhen: null,
    prepare(sql: string): D1PreparedStatement {
      return statement(sql, []);
    },
    async batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      raw.exec('BEGIN');
      try {
        const results = statements.map(item => (item as Statement).execute() as D1Result<T>);
        raw.exec('COMMIT');
        return results;
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
  };

  interface Statement extends D1PreparedStatement {
    execute(): D1Result;
  }

  function check(sql: string) {
    if (database.failWhen?.(sql)) throw new Error('simulated D1 failure');
  }

  function statement(sql: string, values: unknown[]): Statement {
    return {
      bind: (...next: unknown[]) => statement(sql, next),
      execute() {
        check(sql);
        if (/^\s*SELECT/i.test(sql)) {
          return { success: true, results: raw.prepare(sql).all(...values), meta: { changes: 0 } };
        }
        if (/\bRETURNING\b/i.test(sql)) {
          const results = raw.prepare(sql).all(...values);
          const count = raw.prepare('SELECT changes() AS n').get() as { n: number };
          return { success: true, results, meta: { changes: Number(count.n) } };
        }
        const result = raw.prepare(sql).run(...values);
        return { success: true, results: [], meta: { changes: Number(result.changes) } };
      },
      async run<T>() {
        return this.execute() as D1Result<T>;
      },
      async all<T>() {
        check(sql);
        return { success: true, results: raw.prepare(sql).all(...values) as T[], meta: { changes: 0 } };
      },
      async first<T>() {
        check(sql);
        return (raw.prepare(sql).get(...values) ?? null) as T | null;
      },
    };
  }
  return database;
}
