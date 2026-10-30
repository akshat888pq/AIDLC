import fs from 'fs';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';
import { getDb } from '../storage/mongo.js';

/**
 * Users and roles (RBAC scaffold).
 *
 * IDENTITY IS NOT AUTHENTICATED YET. The browser sends a self-chosen id in
 * `x-aidlc-user-id`; anyone can claim any id. This is the seam where SSO / OIDC
 * plugs in — replace `resolveIdentity` and nothing downstream changes.
 */

export const ROLES = ['viewer', 'contributor', 'lead', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export interface User {
  id: string;
  name: string;
  role: Role;
  createdAt: string;
  lastSeenAt: string;
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function roleAtLeast(role: Role, required: Role): boolean {
  return ROLES.indexOf(role) >= ROLES.indexOf(required);
}

const DEFAULT_ROLE: Role = isRole(process.env.RBAC_DEFAULT_ROLE) ? process.env.RBAC_DEFAULT_ROLE : 'contributor';
const ANONYMOUS: User = {
  id: 'anonymous',
  name: 'Anonymous',
  role: 'viewer',
  createdAt: new Date(0).toISOString(),
  lastSeenAt: new Date(0).toISOString(),
};

const USERS_FILE = path.resolve('data', 'users.json');

function readFileUsers(): User[] {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function writeFileUsers(users: User[]): void {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

export async function listUsers(): Promise<User[]> {
  const db = await getDb();
  if (db) return db.collection<User>('users').find({}, { projection: { _id: 0 } }).sort({ createdAt: 1 }).toArray();
  return readFileUsers();
}

async function saveUser(user: User): Promise<void> {
  const db = await getDb();
  if (db) {
    await db.collection<User>('users').updateOne({ id: user.id }, { $set: user }, { upsert: true });
    return;
  }
  const users = readFileUsers();
  const i = users.findIndex((u) => u.id === user.id);
  if (i >= 0) users[i] = user;
  else users.push(user);
  writeFileUsers(users);
}

/**
 * Find or provision the caller. The very first user of an installation becomes
 * admin so a fresh checkout is never locked out; later users get RBAC_DEFAULT_ROLE.
 */
async function resolveIdentity(id: string, name: string): Promise<User> {
  const users = await listUsers();
  const now = new Date().toISOString();
  const existing = users.find((u) => u.id === id);
  if (existing) {
    // Only touch storage when something visible changed, not on every request.
    const stale = Date.parse(existing.lastSeenAt) < Date.now() - 5 * 60_000;
    if ((name && name !== existing.name) || stale) {
      const updated = { ...existing, name: name || existing.name, lastSeenAt: now };
      await saveUser(updated);
      return updated;
    }
    return existing;
  }
  const user: User = {
    id,
    name: name || 'Unnamed user',
    role: users.length === 0 ? 'admin' : DEFAULT_ROLE,
    createdAt: now,
    lastSeenAt: now,
  };
  await saveUser(user);
  console.log(`[rbac] provisioned user ${user.id} (${user.name}) as ${user.role}`);
  return user;
}

export async function setUserRole(id: string, role: Role): Promise<User> {
  const users = await listUsers();
  const user = users.find((u) => u.id === id);
  if (!user) throw Object.assign(new Error(`Unknown user "${id}"`), { statusCode: 404 });
  if (user.role === 'admin' && role !== 'admin' && users.filter((u) => u.role === 'admin').length === 1) {
    throw Object.assign(new Error('Cannot demote the last admin.'), { statusCode: 409 });
  }
  const updated = { ...user, role };
  await saveUser(updated);
  return updated;
}

const ID_PATTERN = /^[A-Za-z0-9_.@:-]{1,100}$/;

/** Express middleware: attaches res.locals.user. */
export async function identityMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.header('x-aidlc-user-id');
    let name = (req.header('x-aidlc-user-name') ?? '').slice(0, 100);
    try {
      name = decodeURIComponent(name);
    } catch {
      // keep the raw header
    }
    res.locals.user = id && ID_PATTERN.test(id) ? await resolveIdentity(id, name) : ANONYMOUS;
    next();
  } catch (err) {
    next(err);
  }
}
