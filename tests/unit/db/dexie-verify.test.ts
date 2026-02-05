/**
 * Phase 0.4.4 - Verify Dexie works with fake-indexeddb.
 * Opens a database, defines a table, writes and reads a record.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Dexie from 'dexie';

interface TestRecord {
  id?: number;
  name: string;
  value: number;
}

class TestDB extends Dexie {
  items!: Dexie.Table<TestRecord, number>;

  constructor() {
    super('TestDB');
    this.version(1).stores({
      items: '++id, name',
    });
  }
}

describe('Dexie + fake-indexeddb verification', () => {
  let db: TestDB;

  beforeEach(() => {
    db = new TestDB();
  });

  afterEach(async () => {
    await db.delete();
  });

  it('opens database successfully', async () => {
    await db.open();
    expect(db.isOpen()).toBe(true);
  });

  it('creates table with correct schema', async () => {
    await db.open();
    expect(db.tables).toHaveLength(1);
    expect(db.tables[0].name).toBe('items');
  });

  it('writes and reads a record', async () => {
    const id = await db.items.add({ name: 'test', value: 42 });
    expect(id).toBeDefined();

    const record = await db.items.get(id);
    expect(record).toBeDefined();
    expect(record!.name).toBe('test');
    expect(record!.value).toBe(42);
  });

  it('queries by indexed field', async () => {
    await db.items.bulkAdd([
      { name: 'alpha', value: 1 },
      { name: 'beta', value: 2 },
      { name: 'alpha', value: 3 },
    ]);

    const results = await db.items.where('name').equals('alpha').toArray();
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.name === 'alpha')).toBe(true);
  });

  it('updates a record with put', async () => {
    const id = await db.items.add({ name: 'test', value: 1 });
    await db.items.put({ id, name: 'test', value: 99 });

    const record = await db.items.get(id);
    expect(record!.value).toBe(99);
  });

  it('deletes a record', async () => {
    const id = await db.items.add({ name: 'test', value: 1 });
    await db.items.delete(id);

    const record = await db.items.get(id);
    expect(record).toBeUndefined();
  });

  it('handles transactions', async () => {
    await db.transaction('rw', db.items, async () => {
      await db.items.add({ name: 'tx1', value: 10 });
      await db.items.add({ name: 'tx2', value: 20 });
    });

    const count = await db.items.count();
    expect(count).toBe(2);
  });

  it('returns empty array for empty table', async () => {
    const all = await db.items.toArray();
    expect(all).toEqual([]);
  });
});
