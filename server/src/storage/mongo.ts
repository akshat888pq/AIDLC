import type { Db } from 'mongodb';

/**
 * Optional MongoDB. With MONGODB_URI set, governance data (audit_logs, users) lives
 * in Mongo; without it every store falls back to JSON files under data/, so a
 * developer without a database runs exactly as before.
 */

let dbPromise: Promise<Db | null> | null = null;

export function mongoConfigured(): boolean {
  return !!process.env.MONGODB_URI;
}

export function getDb(): Promise<Db | null> {
  if (!mongoConfigured()) return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = (async () => {
      try {
        const { MongoClient } = await import('mongodb');
        const client = new MongoClient(process.env.MONGODB_URI!);
        await client.connect();
        const db = client.db(process.env.MONGODB_DB || 'aidlc');
        await db.collection('audit_logs').createIndexes([
          { key: { projectId: 1, timestamp: -1 } },
          { key: { userId: 1, timestamp: -1 } },
          { key: { phase: 1, timestamp: -1 } },
        ]);
        await db.collection('users').createIndex({ id: 1 }, { unique: true });
        console.log(`[mongo] connected to ${db.databaseName}`);
        return db;
      } catch (err: any) {
        // Fail loudly but keep serving: governance falls back to file storage.
        console.error(`[mongo] connection failed, falling back to file storage: ${err.message}`);
        return null;
      }
    })();
  }
  return dbPromise;
}
