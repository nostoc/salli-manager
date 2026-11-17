import { describe, expect, it, jest } from '@jest/globals';
import type { SQLiteDatabase } from 'expo-sqlite';
import { VaultSession } from '../vaultSession';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function setup() {
  const db = { execAsync: jest.fn<(sql: string) => Promise<void>>().mockResolvedValue(), closeAsync: jest.fn<() => Promise<void>>().mockResolvedValue() };
  const ports = { authorize: jest.fn<(credential: boolean) => Promise<string>>().mockResolvedValue('synthetic-key'),
    cancel: jest.fn<() => Promise<void>>().mockResolvedValue(),
    open: jest.fn<(key: string) => Promise<SQLiteDatabase>>().mockResolvedValue(db as unknown as SQLiteDatabase),
    initialize: jest.fn<(connection: SQLiteDatabase) => Promise<void>>().mockResolvedValue(), changed: jest.fn<(unlocked: boolean) => void>() };
  return { db, ports, session: new VaultSession(ports) };
}

describe('authenticated connection ownership', () => {
  it('rejects work before authentication and after lock without touching SQL', async () => {
    const { session, db, ports } = setup();
    const work = jest.fn<() => Promise<number>>().mockResolvedValue(1);
    await expect(session.transact(work)).rejects.toThrow();
    expect(work).not.toHaveBeenCalled();
    await session.unlock(true);
    expect(ports.authorize).toHaveBeenCalledWith(true);
    await expect(session.transact(work)).resolves.toBe(1);
    expect(db.execAsync.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN IMMEDIATE', 'COMMIT']);
    await session.lock();
    expect(ports.changed).toHaveBeenLastCalledWith(false);
    expect(db.closeAsync).toHaveBeenCalledTimes(1);
    await expect(session.transact(work)).rejects.toThrow();
    expect(work).toHaveBeenCalledTimes(1);
  });
  it('closes a candidate and never publishes unlocked state if initialization fails', async () => {
    const { session, db, ports } = setup();
    ports.initialize.mockRejectedValue(new Error('synthetic migration failure'));
    await expect(session.unlock()).rejects.toThrow('unavailable or locked');
    expect(db.closeAsync).toHaveBeenCalledTimes(1);
    expect(ports.changed).not.toHaveBeenCalledWith(true);
    expect(ports.cancel).toHaveBeenCalledTimes(1);
  });
  it('blocks a late authorization result after cancellation', async () => {
    const { session, ports } = setup();
    const authorized = deferred<string>();
    const started = deferred<void>();
    ports.authorize.mockImplementation(async () => { started.resolve(); return authorized.promise; });
    const unlocking = session.unlock();
    await started.promise;
    await session.lock();
    authorized.resolve('synthetic-late-key');
    await expect(unlocking).rejects.toThrow();
    expect(ports.open).not.toHaveBeenCalled();
    expect(ports.changed).not.toHaveBeenCalledWith(true);
  });
  it('closes a late opened connection before allowing another unlock', async () => {
    const { session, ports, db } = setup();
    const opened = deferred<SQLiteDatabase>();
    const started = deferred<void>();
    ports.open.mockImplementationOnce(async () => { started.resolve(); return opened.promise; });
    const first = session.unlock();
    await started.promise;
    await session.lock();
    const second = session.unlock();
    opened.resolve(db as unknown as SQLiteDatabase);
    await expect(first).rejects.toThrow();
    await second;
    expect(db.closeAsync).toHaveBeenCalledTimes(1);
    expect(ports.changed).toHaveBeenLastCalledWith(true);
    expect(ports.initialize).toHaveBeenCalledTimes(1);
  });
  it('rolls back an in-flight write, rejects queued work, and conceals UI before closing on lock', async () => {
    const { session, db, ports } = setup();
    await session.unlock();
    const started = deferred<void>();
    const complete = deferred<void>();
    const first = session.transact(async () => { started.resolve(); await complete.promise; return 'sensitive-result'; });
    await started.promise;
    const queued = jest.fn<() => Promise<void>>().mockResolvedValue();
    const second = session.transact(queued);
    const locked = session.lock();
    expect(ports.changed).toHaveBeenLastCalledWith(false);
    expect(db.closeAsync).not.toHaveBeenCalled();
    complete.resolve();
    await expect(first).rejects.toThrow();
    await expect(second).rejects.toThrow();
    await locked;
    expect(db.execAsync.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN IMMEDIATE', 'ROLLBACK']);
    expect(queued).not.toHaveBeenCalled();
    expect(db.closeAsync).toHaveBeenCalledTimes(1);
  });
  it('rolls back a failed command and permits later work without creating another connection', async () => {
    const { session, db, ports } = setup();
    await session.unlock();
    await expect(session.transact(async () => { throw new Error('synthetic command failure'); })).rejects.toThrow();
    await expect(session.transact(async () => 2)).resolves.toBe(2);
    expect(db.execAsync.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN IMMEDIATE', 'ROLLBACK', 'BEGIN IMMEDIATE', 'COMMIT']);
    expect(ports.open).toHaveBeenCalledTimes(1);
    await expect(session.unlock()).rejects.toThrow();
  });
  it('still closes the owned connection when native cancellation throws synchronously', async () => {
    const { session, db, ports } = setup();
    await session.unlock();
    ports.cancel.mockImplementation(() => { throw new Error('synthetic bridge loss'); });
    await session.lock();
    expect(db.closeAsync).toHaveBeenCalledTimes(1);
  });
});
