import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  Announcement,
  ChangeRequest,
  EnvironmentChatChannel,
  EnvironmentChatMessage,
  GlobalUser,
  MonthlySchedule,
  Servant,
  ServantLog,
  SessionUser,
  Student,
  UserRole,
  VisitationRecord,
  Workspace,
  WorkspaceAccount,
  WorkspaceBundle,
} from '../src/types.js';

export interface StoredUserRecord extends GlobalUser {
  passwordHash: string;
  salt: string;
}

export interface WorkspaceData {
  workspace: Workspace;
  students: Student[];
  servants: Servant[];
  accounts: WorkspaceAccount[];
  monthlySchedules: MonthlySchedule[];
  visitationSchedules: VisitationRecord[];
  announcements: Announcement[];
  changeRequests: ChangeRequest[];
  servantLogs: ServantLog[];
}

export interface DatabaseState {
  ownerClaimed: boolean;
  ownerEmail: string;
  globalUsers: StoredUserRecord[];
  workspaces: Record<string, WorkspaceData>;
  chatChannels: EnvironmentChatChannel[];
  chatMessages: Record<string, EnvironmentChatMessage[]>;
}

const DATA_FILE_PATH = process.env.VERCEL
  ? path.join('/tmp', 'sunday-school-saas-db.json')
  : path.join(process.cwd(), 'data', 'db.json');

const EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex');

function getSessionSecret(): string {
  return process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length >= 16
    ? process.env.SESSION_SECRET.trim()
    : EPHEMERAL_SECRET;
}

export function createSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function hashPassword(password: string, salt: string): string {
  return crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex');
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  if (!expectedHash || !salt) return false;
  const actualHash = hashPassword(password, salt);
  const actualBuf = Buffer.from(actualHash, 'hex');
  const expectedBuf = Buffer.from(expectedHash, 'hex');
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

export interface TokenPayload {
  sub: string;
  role: UserRole;
  workspaceId: string;
  exp: number;
}

export function signSessionToken(payload: Omit<TokenPayload, 'exp'>, ttlSeconds = 60 * 60 * 24 * 7): string {
  const fullPayload: TokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): TokenPayload | null {
  if (!token || !token.includes('.')) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
    if (!parsed || typeof parsed.sub !== 'string' || typeof parsed.exp !== 'number') {
      return null;
    }
    if (parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function toSessionUser(user: StoredUserRecord): SessionUser {
  const { passwordHash: _ph, salt: _s, ...safe } = user;
  return safe;
}

export function sanitizeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function buildInitialState(): DatabaseState {
  const nowIso = new Date().toISOString();

  const globalUsers: StoredUserRecord[] = [
    {
      id: 'owner_root',
      username: 'owner',
      passwordHash: '',
      salt: '',
      role: 'environment_owner',
      workspaceId: '',
      fullName: 'صاحب الـ Environment',
      phone: '',
      email: 'jovanni.ayman@gmail.com',
      status: 'active',
      mustChangePassword: false,
      linkedProfileId: 'owner_root',
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ];

  return {
    ownerClaimed: false,
    ownerEmail: 'jovanni.ayman@gmail.com',
    globalUsers,
    workspaces: {},
    chatChannels: [],
    chatMessages: {},
  };
}

class DbStore {
  private state: DatabaseState;

  constructor() {
    this.state = this.loadFromDisk();
  }

  private loadFromDisk(): DatabaseState {
    try {
      if (fs.existsSync(DATA_FILE_PATH)) {
        const raw = fs.readFileSync(DATA_FILE_PATH, 'utf8');
        const parsed = JSON.parse(raw) as DatabaseState;
        if (parsed && typeof parsed === 'object' && parsed.workspaces && parsed.globalUsers) {
          return parsed;
        }
      }
    } catch (err) {
      console.error('Failed to read DB state from disk, using clean slate:', err);
    }
    return buildInitialState();
  }

  private saveToDisk(stateToSave: DatabaseState = this.state): void {
    try {
      const dir = path.dirname(DATA_FILE_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(DATA_FILE_PATH, JSON.stringify(stateToSave, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to persist DB state:', err);
    }
  }

  public save(): void {
    this.saveToDisk(this.state);
  }

  public getState(): DatabaseState {
    return this.state;
  }

  public findUserById(userId: string): StoredUserRecord | undefined {
    return this.state.globalUsers.find((u) => u.id === userId);
  }

  public findUserByUsername(username: string): StoredUserRecord | undefined {
    return this.state.globalUsers.find((u) => u.username === username);
  }

  public getWorkspaceBundle(workspaceId: string): WorkspaceBundle | null {
    const ws = this.state.workspaces[workspaceId];
    if (!ws) return null;
    return {
      workspace: ws.workspace,
      students: ws.students,
      servants: ws.servants,
      accounts: ws.accounts,
      monthlySchedules: ws.monthlySchedules,
      visitationSchedules: ws.visitationSchedules,
      announcements: ws.announcements,
      changeRequests: ws.changeRequests,
      servantLogs: ws.servantLogs,
    };
  }

  public syncWorkspaceCounts(workspaceId: string): void {
    const ws = this.state.workspaces[workspaceId];
    if (!ws) return;
    ws.workspace.studentCount = ws.students.length;
    ws.workspace.servantCount = ws.servants.length;
    ws.workspace.updatedAt = new Date().toISOString();
  }
}

export const dbStore = new DbStore();
