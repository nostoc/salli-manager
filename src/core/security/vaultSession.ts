import type { SQLiteDatabase } from 'expo-sqlite';
import { VaultError } from './nativeVault';

type SessionPorts = Readonly<{
  authorize(credentialOnly: boolean): Promise<string>;
  cancel(): Promise<void>;
  open(key: string): Promise<SQLiteDatabase>;
  initialize(db: SQLiteDatabase): Promise<void>;
  changed(unlocked: boolean): void;
}>;

// One owner for one authenticated connection. Lock hides UI immediately, rejects
// queued work, rolls back interrupted transactions, then closes after settlement.
export class VaultSession {
  private epoch = 0;
  private db: SQLiteDatabase | null = null;
  private opening = false;
  private queue: Promise<void> = Promise.resolve();
  private transition: Promise<void> = Promise.resolve();
  constructor(private readonly ports: SessionPorts) {}

  unlock(credentialOnly = false): Promise<void> {
    if (this.db || this.opening) return Promise.reject(new VaultError('VAULT_BUSY'));
    const epoch = ++this.epoch;
    this.opening = true;
    const previous = this.transition;
    const operation = (async () => {
      let candidate: SQLiteDatabase | null = null;
      let key: string | null = null;
      try {
        await previous;
        await this.queue;
        this.assertEpoch(epoch);
        key = await this.ports.authorize(credentialOnly);
        this.assertEpoch(epoch);
        candidate = await this.ports.open(key);
        key = null;
        this.assertEpoch(epoch);
        await this.ports.initialize(candidate);
        this.assertEpoch(epoch);
        this.db = candidate;
        candidate = null;
        this.opening = false;
        this.ports.changed(true);
      } catch {
        if (candidate) await candidate.closeAsync().catch(() => undefined);
        await Promise.resolve().then(() => this.ports.cancel()).catch(() => undefined);
        if (epoch === this.epoch) { this.opening = false; this.ports.changed(false); }
        throw new VaultError('UNLOCK_FAILED');
      } finally { key = null; }
    })();
    this.transition = operation.then(() => undefined, () => undefined);
    return operation;
  }

  lock(): Promise<void> {
    ++this.epoch;
    this.opening = false;
    const db = this.db;
    this.db = null;
    this.ports.changed(false);
    void Promise.resolve().then(() => this.ports.cancel()).catch(() => undefined);
    const close = this.queue.then(async () => { if (db) await db.closeAsync(); });
    this.queue = close.catch(() => undefined);
    return close;
  }

  transact<T>(work: (transaction: SQLiteDatabase) => Promise<T>): Promise<T> {
    const epoch = this.epoch;
    const db = this.db;
    const operation = this.queue.then(async () => {
      this.assertEpoch(epoch);
      if (!db || this.db !== db) throw new VaultError('LOCKED');
      // Expo's withExclusiveTransactionAsync opens a second, unkeyed native
      // connection. Keep transactions on this keyed, privately owned connection.
      // The queue prevents other application work from joining the transaction.
      let result: T;
      await db.execAsync('BEGIN IMMEDIATE');
      try {
        this.assertEpoch(epoch);
        result = await work(db);
        this.assertEpoch(epoch); // Throwing here rolls back work interrupted by lock.
        await db.execAsync('COMMIT');
      } catch (failure) {
        await db.execAsync('ROLLBACK').catch(() => undefined);
        throw failure;
      }
      this.assertEpoch(epoch);
      return result;
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private assertEpoch(epoch: number) {
    if (epoch !== this.epoch) throw new VaultError('LOCKED');
  }
}
