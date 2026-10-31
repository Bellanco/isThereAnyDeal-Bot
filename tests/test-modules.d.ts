declare module 'node:sqlite' {
  export interface StatementSync {
    run(...values: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    all(...values: unknown[]): Record<string, unknown>[];
    get(...values: unknown[]): Record<string, unknown> | undefined;
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}

declare module '*.sql?raw' {
  const content: string;
  export default content;
}
