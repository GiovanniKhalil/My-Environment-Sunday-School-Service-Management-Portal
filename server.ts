import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  createSalt,
  dbStore,
  hashPassword,
  sanitizeId,
  signSessionToken,
  toSessionUser,
  verifyPassword,
  verifySessionToken,
  type StoredUserRecord,
  type TokenPayload,
} from './server/dbStore.js';
import type {
  Announcement,
  ChangeRequest,
  EnvironmentChatChannel,
  EnvironmentChatMessage,
  MonthlySchedule,
  Servant,
  Student,
  UserRole,
  VisitationRecord,
  VisitationStatus,
  Workspace,
  WorkspaceAccount,
} from './src/types.js';

interface AuthedRequest extends Request {
  session?: TokenPayload;
}

interface SseClient {
  id: string;
  userId: string;
  role: UserRole;
  res: Response;
}

const sseClients: SseClient[] = [];

function loadFirebaseApiKey(): string {
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { apiKey?: string };
      return parsed.apiKey || '';
    }
  } catch {
    // ignore
  }
  return '';
}

function canAccessChatChannel(user: { id: string; role: UserRole }, channel: EnvironmentChatChannel): boolean {
  if (user.role === 'environment_owner') return true;
  if (channel.id === 'global_leaders' && user.role === 'head_servant') return true;
  if (channel.type === 'direct' && channel.participantUserId === user.id) return true;
  return false;
}

function broadcastChatEvent(channel: EnvironmentChatChannel, message: EnvironmentChatMessage): void {
  const payload = JSON.stringify({ type: 'chat:message', channel, message });
  for (const client of sseClients) {
    if (canAccessChatChannel({ id: client.userId, role: client.role }, channel)) {
      client.res.write(`data: ${payload}\n\n`);
    }
  }
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ error: 'جلسة الدخول منتهية أو غير مصرح بها.' });
    return;
  }
  req.session = payload;
  next();
}

function requireOwner(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.session || req.session.role !== 'environment_owner') {
    res.status(403).json({ error: 'هذا الإجراء متاح لصاحب الـ Environment فقط.' });
    return;
  }
  next();
}

function requireWorkspaceAccess(
  allowedRoles: UserRole[]
): (req: AuthedRequest, res: Response, next: NextFunction) => void {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const session = req.session;
    const workspaceId = String(req.params.workspaceId || '');
    if (!session) {
      res.status(401).json({ error: 'غير مصرح.' });
      return;
    }
    const wsData = dbStore.getState().workspaces[workspaceId];
    if (!wsData) {
      res.status(404).json({ error: 'مساحة الخدمة غير موجودة.' });
      return;
    }
    if (session.role === 'environment_owner') {
      next();
      return;
    }
    if (wsData.workspace.status !== 'active') {
      res.status(403).json({ error: 'مساحة هذا الفصل معلقة حالياً من إدارة المنصة.' });
      return;
    }
    if (session.workspaceId !== workspaceId) {
      res.status(403).json({ error: 'غير مسموح بالوصول إلى بيانات فصل آخر.' });
      return;
    }
    if (!allowedRoles.includes(session.role)) {
      res.status(403).json({ error: 'صلاحيات حسابك لا تسمح بهذا الإجراء.' });
      return;
    }
    next();
  };
}

function recalculateAttendanceRate(history: Student['attendanceHistory']): number {
  if (!history.length) return 100;
  const presentCount = history.filter((item) => item.status === 'present').length;
  return Math.round((presentCount / history.length) * 100);
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  // --- Health & Bootstrap Status ---
  app.get('/api/health', (_req: Request, res: Response) => {
    const state = dbStore.getState();
    res.json({
      ok: true,
      ownerClaimed: state.ownerClaimed,
      ownerEmail: state.ownerEmail,
      workspaceCount: Object.keys(state.workspaces).length,
    });
  });

  // --- First-run Environment Owner Claim (locks permanently once claimed) ---
  app.post('/api/auth/claim-owner', (req: Request, res: Response) => {
    const state = dbStore.getState();
    if (state.ownerClaimed) {
      res.status(409).json({ error: 'تم تفعيل حساب صاحب المنصة مسبقاً.' });
      return;
    }
    const { username, password, fullName } = req.body as {
      username?: string;
      password?: string;
      fullName?: string;
    };
    const cleanUser = (username || 'owner').trim();
    const cleanPass = String(password || '');
    if (cleanUser.length < 3 || cleanPass.length < 6) {
      res.status(400).json({ error: 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل وكلمة المرور 6 أحرف على الأقل.' });
      return;
    }
    const owner = state.globalUsers.find((u) => u.id === 'owner_root');
    if (!owner) {
      res.status(500).json({ error: 'حساب الإدارة الرئيسي غير مهيأ.' });
      return;
    }
    const salt = createSalt();
    owner.username = cleanUser;
    owner.fullName = (fullName || owner.fullName).trim();
    owner.salt = salt;
    owner.passwordHash = hashPassword(cleanPass, salt);
    owner.updatedAt = new Date().toISOString();
    state.ownerClaimed = true;
    dbStore.save();

    const token = signSessionToken({ sub: owner.id, role: owner.role, workspaceId: '' });
    res.json({ token, user: toSessionUser(owner), workspace: null });
  });

  // --- Google Auth Verification for Environment Owner ---
  app.post('/api/auth/google-owner', async (req: Request, res: Response) => {
    const { idToken } = req.body as { idToken?: string };
    if (!idToken || typeof idToken !== 'string') {
      res.status(400).json({ error: 'رمز التحقق من Google مفقود.' });
      return;
    }
    const apiKey = loadFirebaseApiKey();
    if (!apiKey) {
      res.status(500).json({ error: 'إعدادات Firebase غير مكتملة على الخادم.' });
      return;
    }
    try {
      const resp = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        }
      );
      if (!resp.ok) {
        res.status(401).json({ error: 'تعذر التحقق من جلسة Google.' });
        return;
      }
      const data = (await resp.json()) as {
        users?: Array<{ email?: string; emailVerified?: boolean; displayName?: string }>;
      };
      const fbUser = data.users?.[0];
      const state = dbStore.getState();
      if (!fbUser || !fbUser.emailVerified || fbUser.email?.toLowerCase() !== state.ownerEmail.toLowerCase()) {
        res.status(403).json({ error: 'هذا البريد الإلكتروني غير مصرح له بالدخول كصاحب الـ Environment.' });
        return;
      }
      const owner = state.globalUsers.find((u) => u.id === 'owner_root');
      if (!owner) {
        res.status(500).json({ error: 'حساب الإدارة الرئيسي غير موجود.' });
        return;
      }
      if (fbUser.displayName && owner.fullName === 'صاحب الـ Environment') {
        owner.fullName = fbUser.displayName;
      }
      owner.updatedAt = new Date().toISOString();
      dbStore.save();
      const token = signSessionToken({ sub: owner.id, role: owner.role, workspaceId: '' });
      res.json({ token, user: toSessionUser(owner), workspace: null });
    } catch {
      res.status(500).json({ error: 'حدث خطأ أثناء التحقق من Google.' });
    }
  });

  // --- Standard Username + Password Login ---
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const { username, password } = req.body as { username?: string; password?: string };
    const cleanUsername = String(username || '').trim();
    const cleanPassword = String(password || '');
    if (!cleanUsername || !cleanPassword) {
      res.status(400).json({ error: 'يرجى إدخال اسم المستخدم وكلمة المرور.' });
      return;
    }
    const state = dbStore.getState();
    const user = state.globalUsers.find((u) => u.username === cleanUsername);
    if (!user || !user.passwordHash) {
      res.status(401).json({ error: 'بيانات الدخول غير صحيحة أو لم يتم تعيين كلمة مرور للحساب بعد.' });
      return;
    }
    if (!verifyPassword(cleanPassword, user.salt, user.passwordHash)) {
      res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
      return;
    }
    if (user.status === 'suspended' || user.status === 'rejected') {
      res.status(403).json({ error: 'تم تعليق هذا الحساب. تواصل مع أمين الفصل أو إدارة المنصة.' });
      return;
    }

    let workspace: Workspace | null = null;
    if (user.workspaceId) {
      const ws = state.workspaces[user.workspaceId]?.workspace;
      if (!ws) {
        res.status(404).json({ error: 'مساحة الخدمة المرتبطة بالحساب غير موجودة.' });
        return;
      }
      if (ws.status !== 'active') {
        res.status(403).json({ error: 'مساحة خدمة هذا الفصل معلقة حالياً من صاحب المنصة.' });
        return;
      }
      workspace = ws;
    }

    const token = signSessionToken({
      sub: user.id,
      role: user.role,
      workspaceId: user.workspaceId || '',
    });
    res.json({ token, user: toSessionUser(user), workspace });
  });

  // --- Applicant Registration (New Prospective Class Leader) ---
  app.post('/api/auth/register-applicant', (req: Request, res: Response) => {
    const {
      fullName,
      phone,
      proposedChurchName,
      proposedClassName,
      proposedStageConfig,
      serviceVision,
      username,
      password,
    } = req.body as Record<string, string>;

    const cleanName = (fullName || '').trim();
    const cleanPhone = (phone || '').trim();
    const cleanChurch = (proposedChurchName || '').trim();
    const cleanClass = (proposedClassName || '').trim();
    const cleanStage = (proposedStageConfig || '').trim() || 'مرحلة مخصصة';
    const cleanVision = (serviceVision || '').trim();
    const cleanUser = (username || '').trim();
    const cleanPass = String(password || '');

    if (!cleanName || !cleanPhone || !cleanChurch || !cleanClass || !cleanUser || cleanPass.length < 6) {
      res.status(400).json({ error: 'يرجى استيفاء جميع الحقول الأساسية وكلمة مرور من 6 أحرف على الأقل.' });
      return;
    }

    const state = dbStore.getState();
    if (state.globalUsers.some((u) => u.username === cleanUser)) {
      res.status(409).json({ error: 'اسم المستخدم مستخدم بالفعل، يرجى اختيار اسم آخر.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const userId = sanitizeId('app');
    const salt = createSalt();
    const newApplicant: StoredUserRecord = {
      id: userId,
      username: cleanUser,
      passwordHash: hashPassword(cleanPass, salt),
      salt,
      role: 'applicant',
      workspaceId: '',
      fullName: cleanName,
      phone: cleanPhone,
      status: 'pending',
      mustChangePassword: false,
      linkedProfileId: userId,
      proposedChurchName: cleanChurch,
      proposedClassName: cleanClass,
      proposedStageConfig: cleanStage,
      serviceVision: cleanVision,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const channelId = `direct_${userId}`;
    const welcomeText = `مرحباً ${cleanName}. تم استلام طلب إنشاء نظام خدمة لـ «${cleanClass}» في «${cleanChurch}». يمكنك كتابة تفاصيل فصلك هنا للتنسيق المباشر مع صاحب الـ Environment.`;
    const newChannel: EnvironmentChatChannel = {
      id: channelId,
      type: 'direct',
      title: `${cleanName} — ${cleanChurch}`,
      participantUserId: userId,
      participantName: cleanName,
      participantRole: 'applicant',
      churchName: cleanChurch,
      className: cleanClass,
      lastMessage: welcomeText,
      lastMessageAt: nowIso,
    };
    const welcomeMsg: EnvironmentChatMessage = {
      id: sanitizeId('msg'),
      channelId,
      senderId: 'owner_root',
      senderName: 'صاحب الـ Environment',
      senderRole: 'environment_owner',
      senderWorkspaceName: 'الإدارة المركزية للمنصة',
      text: welcomeText,
      createdAt: nowIso,
      isSystem: true,
    };

    state.globalUsers.push(newApplicant);
    state.chatChannels.push(newChannel);
    state.chatMessages[channelId] = [welcomeMsg];
    dbStore.save();

    const token = signSessionToken({ sub: userId, role: 'applicant', workspaceId: '' });
    res.status(201).json({ token, user: toSessionUser(newApplicant), workspace: null });
  });

  // --- Phone-Verified Self-Service Password Reset ---
  app.post('/api/auth/reset-password', (req: Request, res: Response) => {
    const { username, phone, newPassword } = req.body as {
      username?: string;
      phone?: string;
      newPassword?: string;
    };
    const cleanUser = String(username || '').trim();
    const cleanPhone = String(phone || '').replace(/\s+/g, '').trim();
    const cleanPass = String(newPassword || '');
    if (!cleanUser || !cleanPhone || cleanPass.length < 6) {
      res.status(400).json({ error: 'يرجى إدخال اسم المستخدم ورقم الهاتف وكلمة مرور جديدة (6 أحرف فأكثر).' });
      return;
    }
    const state = dbStore.getState();
    const user = state.globalUsers.find((u) => u.username === cleanUser);
    if (!user || user.role === 'environment_owner') {
      res.status(404).json({ error: 'الحساب غير موجود.' });
      return;
    }
    const storedPhone = (user.phone || '').replace(/\s+/g, '').trim();
    if (!storedPhone || storedPhone !== cleanPhone) {
      res.status(403).json({ error: 'رقم الهاتف غير مطابق للرقم المسجل في الحساب.' });
      return;
    }
    const salt = createSalt();
    user.salt = salt;
    user.passwordHash = hashPassword(cleanPass, salt);
    user.mustChangePassword = false;
    user.updatedAt = new Date().toISOString();

    if (user.workspaceId && state.workspaces[user.workspaceId]) {
      const acc = state.workspaces[user.workspaceId].accounts.find((a) => a.username === cleanUser);
      if (acc) {
        acc.mustChangePassword = false;
        acc.updatedAt = user.updatedAt;
      }
    }
    dbStore.save();
    res.json({ ok: true, message: 'تم تحديث كلمة المرور بنجاح.' });
  });

  // --- Authenticated Change Password ---
  app.post('/api/auth/change-password', requireAuth, (req: AuthedRequest, res: Response) => {
    const { newPassword } = req.body as { newPassword?: string };
    const cleanPass = String(newPassword || '');
    if (cleanPass.length < 6) {
      res.status(400).json({ error: 'كلمة المرور يجب أن لا تقل عن 6 أحرف.' });
      return;
    }
    const state = dbStore.getState();
    const user = dbStore.findUserById(req.session!.sub);
    if (!user) {
      res.status(404).json({ error: 'المستخدم غير موجود.' });
      return;
    }
    const salt = createSalt();
    user.salt = salt;
    user.passwordHash = hashPassword(cleanPass, salt);
    user.mustChangePassword = false;
    user.updatedAt = new Date().toISOString();

    if (user.workspaceId && state.workspaces[user.workspaceId]) {
      const acc = state.workspaces[user.workspaceId].accounts.find((a) => a.username === user.username);
      if (acc) {
        acc.mustChangePassword = false;
        acc.updatedAt = user.updatedAt;
      }
    }
    dbStore.save();
    res.json({ ok: true, user: toSessionUser(user) });
  });

  // --- Current Authenticated Session ---
  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res: Response) => {
    const state = dbStore.getState();
    const user = dbStore.findUserById(req.session!.sub);
    if (!user) {
      res.status(404).json({ error: 'المستخدم غير موجود.' });
      return;
    }
    const workspace = user.workspaceId ? state.workspaces[user.workspaceId]?.workspace || null : null;
    res.json({ user: toSessionUser(user), workspace });
  });

  // --- Environment Owner Console Endpoints ---
  app.get('/api/owner/overview', requireAuth, requireOwner, (_req: AuthedRequest, res: Response) => {
    const state = dbStore.getState();
    const workspaces = Object.values(state.workspaces).map((w) => w.workspace);
    const applicants = state.globalUsers
      .filter((u) => u.role === 'applicant' || Boolean(u.proposedClassName))
      .map(toSessionUser);
    res.json({
      workspaces,
      applicants,
      chatChannels: state.chatChannels,
    });
  });

  app.post('/api/owner/workspaces', requireAuth, requireOwner, (req: AuthedRequest, res: Response) => {
    const {
      churchName,
      className,
      stageConfig,
      grades,
      logoUrl,
      verse,
      headFullName,
      headUsername,
      headPhone,
      headTempPassword,
      applicantId,
    } = req.body as {
      churchName?: string;
      className?: string;
      stageConfig?: string;
      grades?: string[];
      logoUrl?: string;
      verse?: string;
      headFullName?: string;
      headUsername?: string;
      headPhone?: string;
      headTempPassword?: string;
      applicantId?: string;
    };

    const cleanChurch = (churchName || '').trim();
    const cleanClass = (className || '').trim();
    const cleanHeadName = (headFullName || '').trim();
    const cleanHeadUser = (headUsername || '').trim();
    const cleanHeadPhone = (headPhone || '').trim();
    const cleanHeadPass = String(headTempPassword || '');

    if (!cleanChurch || !cleanClass || !cleanHeadName || !cleanHeadUser || cleanHeadPass.length < 4) {
      res.status(400).json({ error: 'يرجى استيفاء بيانات الكنيسة والفصل وأمين الفصل وكلمة المرور المؤقتة.' });
      return;
    }

    const state = dbStore.getState();
    const existingApplicant = applicantId ? dbStore.findUserById(applicantId) : undefined;
    if (
      state.globalUsers.some(
        (u) => u.username === cleanHeadUser && (!existingApplicant || u.id !== existingApplicant.id)
      )
    ) {
      res.status(409).json({ error: 'اسم المستخدم الخاص بأمين الفصل مستخدم بالفعل.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const workspaceId = sanitizeId('ws');
    const headServantId = sanitizeId('srv');
    const parsedGrades =
      Array.isArray(grades) && grades.length > 0
        ? grades.map((g) => String(g).trim()).filter(Boolean)
        : (stageConfig || cleanClass)
            .split(/[،,/]+/)
            .map((s) => s.trim())
            .filter(Boolean);

    const effectiveGrades = parsedGrades.length > 0 ? parsedGrades : [cleanClass];
    const cleanStage = (stageConfig || effectiveGrades.join('، ')).trim();
    const cleanVerse =
      (verse || '').trim() ||
      '«اخْدِمُوا الرَّبَّ بِفَرَحٍ، ادْخُلُوا إِلَى حَضْرَتِهِ بِتَرَنُّمٍ» (مز ١٠٠: ٢)';

    const newWorkspace: Workspace = {
      id: workspaceId,
      churchName: cleanChurch,
      className: cleanClass,
      stageConfig: cleanStage,
      grades: effectiveGrades,
      logoUrl: logoUrl || '/src/assets/images/coptic_platform_emblem_1795619749170.jpg',
      verse: cleanVerse,
      status: 'active',
      headServantId,
      headServantName: cleanHeadName,
      ownerUid: req.session!.sub,
      studentCount: 0,
      servantCount: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const headServant: Servant = {
      id: headServantId,
      workspaceId,
      fullName: cleanHeadName,
      role: 'head_servant',
      phone: cleanHeadPhone,
      assignedGrade: effectiveGrades[0],
      gender: 'ذكر',
      avatarUrl: '',
      username: cleanHeadUser,
      bio: `أمين خدمة ${cleanClass}`,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const headAccount: WorkspaceAccount = {
      id: `acc_${headServantId}`,
      workspaceId,
      username: cleanHeadUser,
      role: 'head_servant',
      fullName: cleanHeadName,
      phone: cleanHeadPhone,
      linkedProfileId: headServantId,
      mustChangePassword: true,
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const salt = createSalt();
    let globalHeadUserId = `usr_${headServantId}`;

    if (existingApplicant) {
      globalHeadUserId = existingApplicant.id;
      existingApplicant.username = cleanHeadUser;
      existingApplicant.fullName = cleanHeadName;
      existingApplicant.phone = cleanHeadPhone || existingApplicant.phone;
      existingApplicant.role = 'head_servant';
      existingApplicant.workspaceId = workspaceId;
      existingApplicant.linkedProfileId = headServantId;
      existingApplicant.status = 'approved';
      existingApplicant.approvedWorkspaceId = workspaceId;
      existingApplicant.salt = salt;
      existingApplicant.passwordHash = hashPassword(cleanHeadPass, salt);
      existingApplicant.mustChangePassword = true;
      existingApplicant.updatedAt = nowIso;

      const existingChannel = state.chatChannels.find((c) => c.participantUserId === existingApplicant.id);
      if (existingChannel) {
        existingChannel.title = `${cleanHeadName} — ${cleanChurch}`;
        existingChannel.participantRole = 'head_servant';
        existingChannel.workspaceId = workspaceId;
        existingChannel.churchName = cleanChurch;
        existingChannel.className = cleanClass;
        existingChannel.lastMessage = `تمت الموافقة وتدشين مساحة خدمة «${cleanClass}»!`;
        existingChannel.lastMessageAt = nowIso;
        state.chatMessages[existingChannel.id] = state.chatMessages[existingChannel.id] || [];
        state.chatMessages[existingChannel.id].push({
          id: sanitizeId('msg'),
          channelId: existingChannel.id,
          senderId: 'owner_root',
          senderName: 'صاحب الـ Environment',
          senderRole: 'environment_owner',
          senderWorkspaceName: 'الإدارة المركزية للمنصة',
          text: `مبارك! تمت الموافقة على طلبك وتجهيز غرفة الخدمة الخاصة بكم: ${cleanClass} — ${cleanChurch}. يمكنك الآن تسجيل الدخول باسم المستخدم (${cleanHeadUser}) وإدارة فصلك بالكامل.`,
          createdAt: nowIso,
          isSystem: true,
        });
      }
    } else {
      state.globalUsers.push({
        id: globalHeadUserId,
        username: cleanHeadUser,
        passwordHash: hashPassword(cleanHeadPass, salt),
        salt,
        role: 'head_servant',
        workspaceId,
        fullName: cleanHeadName,
        phone: cleanHeadPhone,
        status: 'active',
        mustChangePassword: true,
        linkedProfileId: headServantId,
        createdAt: nowIso,
        updatedAt: nowIso,
      });

      const directChannelId = `direct_${globalHeadUserId}`;
      const welcomeMsgText = `تم إطلاق مساحة خدمة «${cleanClass}» (${cleanChurch}). أهلاً بك ${cleanHeadName} في شبكة أمناء الفصول.`;
      state.chatChannels.push({
        id: directChannelId,
        type: 'direct',
        title: `${cleanHeadName} — ${cleanChurch}`,
        participantUserId: globalHeadUserId,
        participantName: cleanHeadName,
        participantRole: 'head_servant',
        workspaceId,
        churchName: cleanChurch,
        className: cleanClass,
        lastMessage: welcomeMsgText,
        lastMessageAt: nowIso,
      });
      state.chatMessages[directChannelId] = [
        {
          id: sanitizeId('msg'),
          channelId: directChannelId,
          senderId: 'owner_root',
          senderName: 'صاحب الـ Environment',
          senderRole: 'environment_owner',
          senderWorkspaceName: 'الإدارة المركزية للمنصة',
          text: welcomeMsgText,
          createdAt: nowIso,
          isSystem: true,
        },
      ];
    }

    const defaultSchedule: MonthlySchedule = {
      id: sanitizeId('sch'),
      workspaceId,
      date: new Date(Date.now() + ((7 - new Date().getDay()) % 7) * 86400000).toISOString().slice(0, 10),
      grade: effectiveGrades[0],
      lessonTitle: 'لقاء الافتتاح والتعارف الروحي',
      memoryVerse: cleanVerse,
      primaryTeacherId: headServantId,
      primaryTeacherName: cleanHeadName,
      backupTeacherId: headServantId,
      backupTeacherName: cleanHeadName,
      segments: {
        openingPrayer: true,
        hymns: true,
        coptic: false,
        rites: false,
        behavior: true,
        weeklyReadings: true,
        visitationReview: true,
      },
      notes: 'جدول مبدئي قابل للتعديل وإضافة الخدام.',
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const welcomeAnnouncement: Announcement = {
      id: sanitizeId('ann'),
      workspaceId,
      title: `أهلاً بكم في خدمة ${cleanClass}`,
      body: `تم إطلاق النظام الإلكتروني لمتابعة الحضور والنقاط وجدول الخدمة في ${cleanChurch}.`,
      target: 'all',
      isUrgent: false,
      authorName: cleanHeadName,
      authorRole: 'أمين الفصل',
      createdAt: nowIso,
    };

    state.workspaces[workspaceId] = {
      workspace: newWorkspace,
      students: [],
      servants: [headServant],
      accounts: [headAccount],
      monthlySchedules: [defaultSchedule],
      visitationSchedules: [],
      announcements: [welcomeAnnouncement],
      changeRequests: [],
      servantLogs: [],
    };
    dbStore.save();

    res.status(201).json({
      workspace: newWorkspace,
      headServant,
    });
  });

  app.patch('/api/owner/workspaces/:workspaceId/status', requireAuth, requireOwner, (req: AuthedRequest, res: Response) => {
    const workspaceId = String(req.params.workspaceId || '');
    const { status } = req.body as { status?: 'active' | 'suspended' };
    const ws = dbStore.getState().workspaces[workspaceId];
    if (!ws) {
      res.status(404).json({ error: 'مساحة الخدمة غير موجودة.' });
      return;
    }
    if (status !== 'active' && status !== 'suspended') {
      res.status(400).json({ error: 'حالة غير صالحة.' });
      return;
    }
    ws.workspace.status = status;
    ws.workspace.updatedAt = new Date().toISOString();
    dbStore.save();
    res.json({ workspace: ws.workspace });
  });

  app.delete('/api/owner/workspaces/:workspaceId', requireAuth, requireOwner, (req: AuthedRequest, res: Response) => {
    const workspaceId = String(req.params.workspaceId || '');
    const state = dbStore.getState();
    if (!state.workspaces[workspaceId]) {
      res.status(404).json({ error: 'مساحة الخدمة غير موجودة.' });
      return;
    }
    delete state.workspaces[workspaceId];
    state.globalUsers = state.globalUsers.filter((u) => u.workspaceId !== workspaceId);
    state.chatChannels = state.chatChannels.filter((c) => c.workspaceId !== workspaceId);
    dbStore.save();
    res.json({ ok: true });
  });

  app.patch('/api/owner/applicants/:userId', requireAuth, requireOwner, (req: AuthedRequest, res: Response) => {
    const userId = String(req.params.userId || '');
    const { status } = req.body as { status?: 'rejected' | 'pending' };
    const applicant = dbStore.findUserById(userId);
    if (!applicant || applicant.role !== 'applicant') {
      res.status(404).json({ error: 'طلب المتقدم غير موجود.' });
      return;
    }
    if (status === 'rejected' || status === 'pending') {
      applicant.status = status;
      applicant.updatedAt = new Date().toISOString();
      dbStore.save();
    }
    res.json({ applicant: toSessionUser(applicant) });
  });

  // --- Real-Time Leadership & Applicant Chat ---
  app.get('/api/chat/stream', (req: Request, res: Response) => {
    const token = String(req.query.token || '').trim();
    const payload = verifySessionToken(token);
    if (!payload) {
      res.status(401).end();
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const clientId = sanitizeId('sse');
    const client: SseClient = { id: clientId, userId: payload.sub, role: payload.role, res };
    sseClients.push(client);
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

    req.on('close', () => {
      const idx = sseClients.findIndex((c) => c.id === clientId);
      if (idx !== -1) sseClients.splice(idx, 1);
    });
  });

  app.get('/api/chat/channels', requireAuth, (req: AuthedRequest, res: Response) => {
    const state = dbStore.getState();
    const user = { id: req.session!.sub, role: req.session!.role };
    const channels = state.chatChannels.filter((ch) => canAccessChatChannel(user, ch));
    res.json({ channels });
  });

  app.get('/api/chat/channels/:channelId/messages', requireAuth, (req: AuthedRequest, res: Response) => {
    const channelId = String(req.params.channelId || '');
    const state = dbStore.getState();
    const channel = state.chatChannels.find((c) => c.id === channelId);
    if (!channel) {
      res.status(404).json({ error: 'قناة المحادثة غير موجودة.' });
      return;
    }
    if (!canAccessChatChannel({ id: req.session!.sub, role: req.session!.role }, channel)) {
      res.status(403).json({ error: 'غير مصرح بالوصول إلى هذه المحادثة.' });
      return;
    }
    res.json({ channel, messages: state.chatMessages[channelId] || [] });
  });

  app.post('/api/chat/channels/:channelId/messages', requireAuth, (req: AuthedRequest, res: Response) => {
    const channelId = String(req.params.channelId || '');
    const { text } = req.body as { text?: string };
    const cleanText = String(text || '').trim();
    if (!cleanText || cleanText.length > 2000) {
      res.status(400).json({ error: 'نص الرسالة يجب أن يكون بين 1 و 2000 حرف.' });
      return;
    }
    const state = dbStore.getState();
    const channel = state.chatChannels.find((c) => c.id === channelId);
    if (!channel) {
      res.status(404).json({ error: 'قناة المحادثة غير موجودة.' });
      return;
    }
    const user = dbStore.findUserById(req.session!.sub);
    if (!user || !canAccessChatChannel({ id: user.id, role: user.role }, channel)) {
      res.status(403).json({ error: 'غير مصرح بالإرسال في هذه المحادثة.' });
      return;
    }
    const wsName = user.workspaceId
      ? state.workspaces[user.workspaceId]?.workspace.className
      : user.proposedClassName || 'الإدارة المركزية للمنصة';
    const nowIso = new Date().toISOString();
    const msg: EnvironmentChatMessage = {
      id: sanitizeId('msg'),
      channelId,
      senderId: user.id,
      senderName: user.fullName,
      senderRole: user.role,
      senderWorkspaceName: wsName,
      text: cleanText,
      createdAt: nowIso,
    };

    state.chatMessages[channelId] = state.chatMessages[channelId] || [];
    state.chatMessages[channelId].push(msg);
    channel.lastMessage = cleanText.slice(0, 140);
    channel.lastMessageAt = nowIso;
    dbStore.save();

    broadcastChatEvent(channel, msg);
    res.status(201).json({ message: msg, channel });
  });

  // --- Workspace Bundle & Settings ---
  app.get(
    '/api/workspaces/:workspaceId/bundle',
    requireAuth,
    requireWorkspaceAccess(['environment_owner', 'head_servant', 'assistant_head', 'servant', 'student']),
    (req: AuthedRequest, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '');
      const ws = dbStore.getState().workspaces[workspaceId];
      if (!ws) {
        res.status(404).json({ error: 'مساحة الخدمة غير موجودة.' });
        return;
      }

      const role = req.session!.role;
      const user = dbStore.findUserById(req.session!.sub);

      if (role === 'student') {
        const ownStudent = ws.students.filter((s) => s.id === user?.linkedProfileId);
        const studentAnnouncements = ws.announcements.filter(
          (a) => a.target === 'all' || a.target === 'students_only'
        );
        const ownChangeRequests = ws.changeRequests.filter((cr) => cr.studentId === user?.linkedProfileId);
        res.json({
          workspace: ws.workspace,
          students: ownStudent,
          servants: ws.servants,
          accounts: [],
          monthlySchedules: ws.monthlySchedules,
          visitationSchedules: [],
          announcements: studentAnnouncements,
          changeRequests: ownChangeRequests,
          servantLogs: [],
        });
        return;
      }

      const isAdmin = role === 'environment_owner' || role === 'head_servant' || role === 'assistant_head';
      res.json({
        workspace: ws.workspace,
        students: ws.students,
        servants: ws.servants,
        accounts: isAdmin ? ws.accounts : [],
        monthlySchedules: ws.monthlySchedules,
        visitationSchedules: ws.visitationSchedules,
        announcements: ws.announcements,
        changeRequests: ws.changeRequests,
        servantLogs: isAdmin ? ws.servantLogs : [],
      });
    }
  );

  app.patch(
    '/api/workspaces/:workspaceId/settings',
    requireAuth,
    requireWorkspaceAccess(['environment_owner', 'head_servant', 'assistant_head']),
    (req: AuthedRequest, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '');
      const ws = dbStore.getState().workspaces[workspaceId];
      const { churchName, className, stageConfig, grades, logoUrl, verse } = req.body as Partial<Workspace>;
      if (churchName && churchName.trim().length >= 2) ws.workspace.churchName = churchName.trim();
      if (className && className.trim().length >= 2) ws.workspace.className = className.trim();
      if (stageConfig !== undefined) ws.workspace.stageConfig = stageConfig.trim();
      if (Array.isArray(grades) && grades.length > 0) {
        ws.workspace.grades = grades.map((g) => String(g).trim()).filter(Boolean);
      }
      if (typeof logoUrl === 'string') ws.workspace.logoUrl = logoUrl;
      if (typeof verse === 'string') ws.workspace.verse = verse.trim();
      ws.workspace.updatedAt = new Date().toISOString();
      dbStore.save();
      res.json({ workspace: ws.workspace });
    }
  );

  // --- Students CRUD, Bulk Actions & Excel Import ---
  app.post(
    '/api/workspaces/:workspaceId/students',
    requireAuth,
    requireWorkspaceAccess(['environment_owner', 'head_servant', 'assistant_head', 'servant']),
    (req: AuthedRequest, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '');
      const state = dbStore.getState();
      const ws = state.workspaces[workspaceId];
      const {
        fullName,
        grade,
        gender,
        birthDate,
        phone,
        parentPhone,
        address,
        avatarUrl,
        username,
        tempPassword,
      } = req.body as Record<string, string>;

      const cleanName = (fullName || '').trim();
      const cleanGrade = (grade || '').trim() || ws.workspace.grades[0] || 'غير محدد';
      if (cleanName.length < 2) {
        res.status(400).json({ error: 'اسم المخدوم مطلوب.' });
        return;
      }

      const nowIso = new Date().toISOString();
      const studentId = sanitizeId('stu');
      let cleanUsername = (username || '').trim();
      if (!cleanUsername) {
        cleanUsername = `stu.${studentId.slice(-6)}`;
      }
      if (state.globalUsers.some((u) => u.username === cleanUsername)) {
        cleanUsername = `${cleanUsername}.${studentId.slice(-4)}`;
      }

      const student: Student = {
        id: studentId,
        workspaceId,
        fullName: cleanName,
        grade: cleanGrade,
        gender: gender === 'أنثى' ? 'أنثى' : 'ذكر',
        birthDate: (birthDate || '').trim(),
        phone: (phone || '').trim(),
        parentPhone: (parentPhone || '').trim(),
        address: (address || '').trim(),
        avatarUrl: avatarUrl || '',
        points: 0,
        badges: [],
        evaluations: { memoryVerse: 80, bibleQuiz: 80, behavior: 90, attendanceRate: 100 },
        attendanceHistory: [],
        pointsHistory: [],
        username: cleanUsername,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const passToUse = (tempPassword || '').trim() || '123456';
      const salt = createSalt();
      const acc: WorkspaceAccount = {
        id: `acc_${studentId}`,
        workspaceId,
        username: cleanUsername,
        role: 'student',
        fullName: cleanName,
        phone: (parentPhone || phone || '').trim(),
        linkedProfileId: studentId,
        mustChangePassword: true,
        isActive: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      const globalUser: StoredUserRecord = {
        id: `usr_${studentId}`,
        username: cleanUsername,
        passwordHash: hashPassword(passToUse, salt),
        salt,
        role: 'student',
        workspaceId,
        fullName: cleanName,
        phone: (parentPhone || phone || '').trim(),
        status: 'active',
        mustChangePassword: true,
        linkedProfileId: studentId,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      ws.students.push(student);
      ws.accounts.push(acc);
      state.globalUsers.push(globalUser);
      dbStore.syncWorkspaceCounts(workspaceId);
      dbStore.save();
      res.status(201).json({ student, account: acc });
    }
  );

  app.post(
    '/api/workspaces/:workspaceId/students/import',
    requireAuth,
    requireWorkspaceAccess(['environment_owner', 'head_servant', 'assistant_head', 'servant']),
    (req: AuthedRequest, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '');
      const state = dbStore.getState();
      const ws = state.workspaces[workspaceId];
      const { rows } = req.body as {
        rows?: Array<{
          fullName?: string;
          grade?: string;
          gender?: string;
          birthDate?: string;
          phone?: string;
          parentPhone?: string;
          address?: string;
          username?: string;
          tempPassword?: string;
        }>;
      };

      if (!Array.isArray(rows) || rows.length === 0) {
        res.status(400).json({ error: 'لا توجد صفوف صالحة للاستيراد.' });
        return;
      }

      const nowIso = new Date().toISOString();
      let importedCount = 0;
      let skippedCount = 0;
      const createdStudents: Student[] = [];

      for (const row of rows.slice(0, 500)) {
        const cleanName = String(row.fullName || '').trim();
        if (cleanName.length < 2) {
          skippedCount++;
          continue;
        }
        const duplicate = ws.students.some(
          (s) => s.fullName.trim() === cleanName && (!row.grade || s.grade === row.grade.trim())
        );
        if (duplicate) {
          skippedCount++;
          continue;
        }
        const studentId = sanitizeId('stu');
        let cleanUser = String(row.username || '').trim() || `stu.${studentId.slice(-6)}`;
        if (state.globalUsers.some((u) => u.username === cleanUser)) {
          cleanUser = `${cleanUser}.${studentId.slice(-4)}`;
        }
        const cleanGrade = String(row.grade || '').trim() || ws.workspace.grades[0] || 'غير محدد';
        const phone = String(row.phone || '').trim();
        const parentPhone = String(row.parentPhone || '').trim();
        const student: Student = {
          id: studentId,
          workspaceId,
          fullName: cleanName,
          grade: cleanGrade,
          gender: row.gender === 'أنثى' ? 'أنثى' : 'ذكر',
          birthDate: String(row.birthDate || '').trim(),
          phone,
          parentPhone,
          address: String(row.address || '').trim(),
          avatarUrl: '',
          points: 0,
          badges: [],
          evaluations: { memoryVerse: 80, bibleQuiz: 80, behavior: 90, attendanceRate: 100 },
          attendanceHistory: [],
          pointsHistory: [],
          username: cleanUser,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        const salt = createSalt();
        const passToUse = String(row.tempPassword || '').trim() || '123456';
        ws.students.push(student);
        ws.accounts.push({
          id: `acc_${studentId}`,
          workspaceId,
          username: cleanUser,
          role: 'student',
          fullName: cleanName,
          phone: parentPhone || phone,
          linkedProfileId: studentId,
          mustChangePassword: true,
          isActive: true,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
        state.globalUsers.push({
          id: `usr_${studentId}`,
          username: cleanUser,
          passwordHash: hashPassword(passToUse, salt),
          salt,
          role: 'student',
          workspaceId,
          fullName: cleanName,
          phone: parentPhone || phone,
          status: 'active',
          mustChangePassword: true,
          linkedProfileId: studentId,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
        createdStudents.push(student);
        importedCount++;
      }

      dbStore.syncWorkspaceCounts(workspaceId);
      dbStore.save();
      res.json({ importedCount, skippedCount, students: createdStudents });
    }
  );

  app.patch(
    '/api/workspaces/:workspaceId/students/:studentId',
    requireAuth,
    requireWorkspaceAccess(['environment_owner', 'head_servant', 'assistant_head', 'servant']),
    (req: AuthedRequest, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '');
      const studentId = String(req.params.studentId || '');
      const state = dbStore.getState();
      const ws = state.workspaces[workspaceId];
      const student = ws.students.find((s) => s.id === studentId);
      if (!student) {
        res.status(404).json({ error: 'المخدوم غير موجود.' });
        return;
      }

      const patch = req.body as Partial<Student>;
      if (patch.fullName !== undefined && patch.fullName.trim().length >= 2) student.fullName = patch.fullName.trim();
      if (patch.grade !== undefined) student.grade = patch.grade.trim();
      if (patch.gender === 'ذكر' || patch.gender === 'أنثى') student.gender = patch.gender;
      if (patch.birthDate !== undefined) student.birthDate = patch.birthDate.trim();
      if (patch.phone !== undefined) student.phone = patch.phone.trim();
      if (patch.parentPhone !== undefined) student.parentPhone = patch.parentPhone.trim();
      if (patch.address !== undefined) student.address = patch.address.trim();
      if (patch.avatarUrl !== undefined) student.avatarUrl = patch.avatarUrl;
      if (patch.evaluations !== undefined) student.evaluations = { ...student.evaluations, ...patch.evaluations };
      if (Array.isArray(patch.badges)) student.badges = patch.badges;
      if (typeof patch.points === 'number') student.points = Math.max(0, patch.points);
      if (patch.username && patch.username.trim() && patch.username.trim() !== student.username) {
        const nextUser = patch.username.trim();
        if (state.globalUsers.some((u) => u.username === nextUser && u.linkedProfileId !== studentId)) {
          res.status(409).json({ error: 'اسم المستخدم مسجل لحساب آخر.' });
          return;
        }
        const gUser = state.globalUsers.find((u) => u.linkedProfileId === studentId && u.workspaceId === workspaceId);
        const wAcc = ws.accounts.find((a) => a.linkedProfileId === studentId);
        student.username = nextUser;
        if (gUser) gUser.username = nextUser;
        if (wAcc) wAcc.username = nextUser;
      }
      student.updatedAt = new Date().toISOString();
      dbStore.save();
      res.json({ student });
    }
  );

  app.delete(
    '/api/workspaces/:workspaceId/students/:studentId',
    requireAuth,
    requireWorkspaceAccess(['environment_owner', 'head_servant', 'assistant_head']),
    (req: AuthedRequest, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '');
      const studentId = String(req.params.studentId || '');
      const state = dbStore.getState();
      const ws = state.workspaces[workspaceId];
      ws.students = ws.students.filter((s) => s.id !== studentId);
      ws.accounts = ws.accounts.filter((a) => a.linkedProfileId !== studentId);
      ws.visitationSchedules = ws.visitationSchedules.filter((v) => v.studentId !== studentId);
      state.globalUsers = state.globalUsers.filter(
        (u) => !(u.workspaceId === workspaceId && u.linkedProfileId === studentId)
      );
      dbStore.syncWorkspaceCounts(workspaceId);
      dbStore.save();
      res.json({ ok: true });
    }
  );

  app.post(
    '/api/workspaces/:workspaceId/students/bulk-attendance',
    requireAuth,
    requireWorkspaceAccess(['environment_owner', 'head_servant', 'assistant_head', 'servant']),
    (req: AuthedRequest, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '');
      const ws = dbStore.getState().workspaces[workspaceId];
      const actor = dbStore.findUserById(req.session!.sub);
      const { date, sessionType, records } = req.body as {
        date?: string;
        sessionType?: 'mass' | 'sunday_school';
        records?: Array<{ studentId: string; status: 'present' | 'absent' }>;
      };
      const cleanDate = (date || '').trim() || new Date().toISOString().slice(0, 10);
      const cleanSession = sessionType === 'mass' ? 'mass' : 'sunday_school';
      if (!Array.isArray(records) || records.length === 0) {
        res.status(400).json({ error: 'لا توجد سجلات حضور لحفظها.' });
        return;
      }

      const nowIso = new Date().toISOString();
      for (const item of records) {
        const student = ws.students.find((s) => s.id === item.studentId);
        if (!student) continue;
        student.attendanceHistory = student.attendanceHistory.filter(
          (a) => !(a.date === cleanDate && a.sessionType === cleanSession)
        );
        student.attendanceHistory.unshift({
          date: cleanDate,
          sessionType: cleanSession,
          status: item.status === 'present' ? 'present' : 'absent',
          recordedBy: actor?.fullName || 'خادم',
        });
        if (item.status === 'present') {
          student.points += 10;
          student.pointsHistory.unshift({
            id: sanitizeId('pt'),
            amount: 10,
            reason: cleanSession === 'mass' ? 'حضور القداس الإلهي' : 'حضور مدارس الأحد',
            date: cleanDate,
            recordedBy: actor?.fullName || 'خادم',
          });
        }
        student.evaluations.attendanceRate = recalculateAttendanceRate(student.attendanceHistory);
        student.updatedAt = nowIso;
      }
      dbStore.save();
      res.json({ ok: true, students: ws.students });
    }
  );

  app.post(
    '/api/workspaces/:workspaceId/students/bulk-points',
    requireAuth,
    requireWorkspaceAccess(['environment_owner', 'head_servant', 'assistant_head', 'servant']),
    (req: AuthedRequest, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '');
      const ws = dbStore.getState().workspaces[workspaceId];
      const actor = dbStore.findUserById(req.session!.sub);
      const { studentIds, amount, mode, reason } = req.body as {
        studentIds?: string[];
        amount?: number;
        mode?: 'bonus' | 'penalty';
        reason?: string;
      };
      const cleanReason = String(reason || '').trim();
      const absAmount = Math.min(1000, Math.max(1, Math.round(Number(amount) || 0)));
      if (!Array.isArray(studentIds) || studentIds.length === 0 || !cleanReason || absAmount < 1) {
        res.status(400).json({ error: 'يرجى تحديد المخدومين والمبلغ (1-1000) وسبب التعديل.' });
        return;
      }
      const delta = mode === 'penalty' ? -absAmount : absAmount;
      const today = new Date().toISOString().slice(0, 10);
      const nowIso = new Date().toISOString();

      for (const sid of studentIds) {
        const student = ws.students.find((s) => s.id === sid);
        if (!student) continue;
        student.points = Math.max(0, student.points + delta);
        student.pointsHistory.unshift({
          id: sanitizeId('pt'),
          amount: delta,
          reason: cleanReason,
          date: today,
          recordedBy: actor?.fullName || 'خادم',
        });
        if (student.points >= 300 && !student.badges.includes('درع التفوق الذهبي')) {
          student.badges.push('درع التفوق الذهبي');
        }
        student.updatedAt = nowIso;
      }
      dbStore.save();
      res.json({ ok: true, students: ws.students });
    }
  );

  app.post(
    '/api/workspaces/:workspaceId/batch',
    requireAuth,
    requireWorkspaceAccess(['environment_owner', 'head_servant', 'assistant_head']),
    (req: AuthedRequest, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '');
      const state = dbStore.getState();
      const ws = state.workspaces[workspaceId];
      const { action, fromGrade, toGrade, confirmKeyword } = req.body as {
        action?: 'promote_grade' | 'delete_grade' | 'reset_points';
        fromGrade?: string;
        toGrade?: string;
        confirmKeyword?: string;
      };

      const nowIso = new Date().toISOString();
      if (action === 'promote_grade') {
        if (!fromGrade || !toGrade) {
          res.status(400).json({ error: 'يرجى تحديد المرحلة الحالية والمرحلة الجديدة.' });
          return;
        }
        for (const s of ws.students) {
          if (s.grade === fromGrade) {
            s.grade = toGrade.trim();
            s.updatedAt = nowIso;
          }
        }
      } else if (action === 'delete_grade') {
        if (confirmKeyword !== 'تأكيد' || !fromGrade) {
          res.status(400).json({ error: 'يرجى كتابة كلمة "تأكيد" وتحديد المرحلة المراد حذفها.' });
          return;
        }
        const removedIds = new Set(ws.students.filter((s) => s.grade === fromGrade).map((s) => s.id));
        ws.students = ws.students.filter((s) => !removedIds.has(s.id));
        ws.accounts = ws.accounts.filter((a) => !removedIds.has(a.linkedProfileId));
        ws.visitationSchedules = ws.visitationSchedules.filter((v) => !removedIds.has(v.studentId));
        state.globalUsers = state.globalUsers.filter(
          (u) => !(u.workspaceId === workspaceId && removedIds.has(u.linkedProfileId))
        );
      } else if (action === 'reset_points') {
        if (confirmKeyword !== 'تأكيد') {
          res.status(400).json({ error: 'يرجى كتابة كلمة "تأكيد" لتصفير نقاط الترم.' });
          return;
        }
        for (const s of ws.students) {
          s.points = 0;
          s.pointsHistory = [];
          s.updatedAt = nowIso;
        }
      } else {
        res.status(400).json({ error: 'إجراء غير معروف.' });
        return;
      }

      dbStore.syncWorkspaceCounts(workspaceId);
      dbStore.save();
      res.json({ ok: true, students: ws.students });
    }
  );

  // --- Monthly Schedules ---
  app.post(
    '/api/workspaces/:workspaceId/schedules',
    requireAuth,
    requireWorkspaceAccess(['environment_owner', 'head_servant', 'assistant_head', 'servant']),
    (req: AuthedRequest, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '');
      const ws = dbStore.getState().workspaces[workspaceId];
      const payload = req.body as Partial<MonthlySchedule> & { pruneExpired?: boolean };

      if (payload.pruneExpired) {
        const cutoff = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
        ws.monthlySchedules = ws.monthlySchedules.filter((s) => s.date >= cutoff);
      }

      if (!payload.lessonTitle || !payload.date || !payload.grade) {
        dbStore.save();
        res.json({ schedules: ws.monthlySchedules });
        return;
      }

      const nowIso = new Date().toISOString();
      const primary = ws.servants.find((s) => s.id === payload.primaryTeacherId);
      const backup = ws.servants.find((s) => s.id === payload.backupTeacherId);

      if (payload.id) {
        const existing = ws.monthlySchedules.find((s) => s.id === payload.id);
        if (existing) {
          existing.date = payload.date;
          existing.grade = payload.grade;
          existing.lessonTitle = payload.lessonTitle.trim();
          existing.memoryVerse = (payload.memoryVerse || '').trim();
          existing.primaryTeacherId = payload.primaryTeacherId || existing.primaryTeacherId;
          existing.primaryTeacherName = primary?.fullName || payload.primaryTeacherName || existing.primaryTeacherName;
          existing.backupTeacherId = payload.backupTeacherId || existing.backupTeacherId;
          existing.backupTeacherName = backup?.fullName || payload.backupTeacherName || existing.backupTeacherName;
          if (payload.segments) existing.segments = payload.segments;
          if (payload.notes !== undefined) existing.notes = payload.notes;
          existing.updatedAt = nowIso;
          dbStore.save();
          res.json({ schedule: existing, schedules: ws.monthlySchedules });
          return;
        }
      }

      const newSchedule: MonthlySchedule = {
        id: sanitizeId('sch'),
        workspaceId,
        date: payload.date,
        grade: payload.grade,
        lessonTitle: payload.lessonTitle.trim(),
        memoryVerse: (payload.memoryVerse || '').trim(),
        primaryTeacherId: payload.primaryTeacherId || ws.servants[0]?.id || '',
        primaryTeacherName: primary?.fullName || payload.primaryTeacherName || ws.servants[0]?.fullName || 'غير محدد',
        backupTeacherId: payload.backupTeacherId || ws.servants[0]?.id || '',
        backupTeacherName: backup?.fullName || payload.backupTeacherName || ws.servants[0]?.fullName || 'غير محدد',
        segments: payload.segments || {
          openingPrayer: true,
          hymns: true,
          coptic: false,
          rites: false,
          behavior: true,
          weeklyReadings: true,
          visitationReview: true,
        },
        notes: (payload.notes || '').trim(),
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      ws.monthlySchedules.push(newSchedule);
      ws.monthlySchedules.sort((a, b) => a.date.localeCompare(b.date));
      dbStore.save();
      res.status(201).json({ schedule: newSchedule, schedules: ws.monthlySchedules });
    }
  );

  app.post(
    '/api/workspaces/:workspaceId/schedules/:scheduleId/swap',
    requireAuth,
    requireWorkspaceAccess(['environment_owner', 'head_servant', 'assistant_head', 'servant']),
    (req: AuthedRequest, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '');
      const scheduleId = String(req.params.scheduleId || '');
      const ws = dbStore.getState().workspaces[workspaceId];
      const sch = ws.monthlySchedules.find((s) => s.id === scheduleId);
      if (!sch) {
        res.status(404).json({ error: 'الحصة غير موجودة.' });
        return;
      }
      const prevPrimaryId = sch.primaryTeacherId;
      const prevPrimaryName = sch.primaryTeacherName;
      sch.primaryTeacherId = sch.backupTeacherId;
      sch.primaryTeacherName = sch.backupTeacherName;
      sch.backupTeacherId = prevPrimaryId;
      sch.backupTeacherName = prevPrimaryName;
      sch.updatedAt = new Date().toISOString();
      dbStore.save();
      res.json({ schedule: sch });
    }
  );

  app.delete(
    '/api/workspaces/:workspaceId/schedules/:scheduleId',
    requireAuth,
    requireWorkspaceAccess(['environment_owner', 'head_servant', 'assistant_head']),
    (req: AuthedRequest, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '');
      const scheduleId = String(req.params.scheduleId || '');
      const ws = dbStore.getState().workspaces[workspaceId];
      ws.monthlySchedules = ws.monthlySchedules.filter((s) => s.id !== scheduleId);
      dbStore.save();
      res.json({ ok: true });
    }
  );

  // --- Weekly Visitation Board ---
  app.post(
    '/api/workspaces/:workspaceId/visitations/auto-distribute',
    requireAuth,
    requireWorkspaceAccess(['environment_owner', 'head_servant', 'assistant_head', 'servant']),
    (req: AuthedRequest, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '');
      const ws = dbStore.getState().workspaces[workspaceId];
      if (ws.servants.length === 0 || ws.students.length === 0) {
        res.status(400).json({ error: 'يجب وجود مخدومين وخدام داخل الفصل للتوزيع.' });
        return;
      }
      const weekLabel = String(req.body?.weekLabel || 'الأسبوع الحالي').trim();
      const nowIso = new Date().toISOString();
      const newRecords: VisitationRecord[] = ws.students.map((stu, idx) => {
        const srv = ws.servants[idx % ws.servants.length];
        const existing = ws.visitationSchedules.find((v) => v.studentId === stu.id);
        return {
          id: existing?.id || sanitizeId('vis'),
          workspaceId,
          studentId: stu.id,
          studentName: stu.fullName,
          studentGrade: stu.grade,
          studentPhone: stu.phone,
          parentPhone: stu.parentPhone,
          servantId: srv.id,
          servantName: srv.fullName,
          status: existing?.status || 'pending',
          weekLabel,
          notes: existing?.notes || '',
          lastUpdatedAt: nowIso,
        };
      });
      ws.visitationSchedules = newRecords;
      dbStore.save();
      res.json({ visitations: ws.visitationSchedules });
    }
  );

  app.post(
    '/api/workspaces/:workspaceId/visitations/reset-statuses',
    requireAuth,
    requireWorkspaceAccess(['environment_owner', 'head_servant', 'assistant_head', 'servant']),
    (req: AuthedRequest, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '');
      const ws = dbStore.getState().workspaces[workspaceId];
      const nowIso = new Date().toISOString();
      const weekLabel = typeof req.body?.weekLabel === 'string' ? req.body.weekLabel.trim().slice(0, 64) : '';
      for (const vis of ws.visitationSchedules) {
        vis.status = 'pending';
        vis.lastUpdatedAt = nowIso;
        if (weekLabel) vis.weekLabel = weekLabel;
      }
      dbStore.save();
      res.json({ visitations: ws.visitationSchedules });
    }
  );

  app.post(
    '/api/workspaces/:workspaceId/visitations/bulk-assign',
    requireAuth,
    requireWorkspaceAccess(['environment_owner', 'head_servant', 'assistant_head', 'servant']),
    (req: AuthedRequest, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '');
      const ws = dbStore.getState().workspaces[workspaceId];
      const { servantId, studentIds, weekLabel } = req.body as {
        servantId?: string;
        studentIds?: unknown;
        weekLabel?: string;
      };
      const srv = ws.servants.find((s) => s.id === servantId);
      if (!srv || !Array.isArray(studentIds)) {
        res.status(400).json({ error: 'يرجى تحديد الخادم وقائمة المخدومين بشكل صحيح.' });
        return;
      }
      const validStudentIds = new Set(ws.students.map((s) => s.id));
      const selectedSet = new Set(
        studentIds.map((id) => String(id)).filter((id) => validStudentIds.has(id))
      );
      const nowIso = new Date().toISOString();
      const cleanWeekLabel =
        typeof weekLabel === 'string' && weekLabel.trim()
          ? weekLabel.trim().slice(0, 64)
          : 'الأسبوع الحالي';

      // Remove students previously assigned to this servant that were unchecked
      ws.visitationSchedules = ws.visitationSchedules.filter(
        (v) => v.servantId !== srv.id || selectedSet.has(v.studentId)
      );

      // Assign or reassign selected students to this servant
      for (const stuId of selectedSet) {
        const stu = ws.students.find((s) => s.id === stuId);
        if (!stu) continue;
        const existing = ws.visitationSchedules.find((v) => v.studentId === stuId);
        if (existing) {
          existing.servantId = srv.id;
          existing.servantName = srv.fullName;
          existing.studentName = stu.fullName;
          existing.studentGrade = stu.grade;
          existing.studentPhone = stu.phone;
          existing.parentPhone = stu.parentPhone;
          existing.lastUpdatedAt = nowIso;
        } else {
          ws.visitationSchedules.push({
            id: sanitizeId('vis'),
            workspaceId,
            studentId: stu.id,
            studentName: stu.fullName,
            studentGrade: stu.grade,
            studentPhone: stu.phone,
            parentPhone: stu.parentPhone,
            servantId: srv.id,
            servantName: srv.fullName,
            status: 'pending',
            weekLabel: cleanWeekLabel,
            notes: '',
            lastUpdatedAt: nowIso,
          });
        }
      }

      dbStore.save();
      res.json({ visitations: ws.visitationSchedules });
    }
  );

  app.post(
    '/api/workspaces/:workspaceId/visitations',
    requireAuth,
    requireWorkspaceAccess(['environment_owner', 'head_servant', 'assistant_head', 'servant']),
    (req: AuthedRequest, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '');
      const ws = dbStore.getState().workspaces[workspaceId];
      const { id, studentId, servantId, status, notes, weekLabel } = req.body as {
        id?: string;
        studentId?: string;
        servantId?: string;
        status?: VisitationStatus;
        notes?: string;
        weekLabel?: string;
      };
      const nowIso = new Date().toISOString();

      if (id) {
        const existing = ws.visitationSchedules.find((v) => v.id === id);
        if (existing) {
          if (servantId) {
            const srv = ws.servants.find((s) => s.id === servantId);
            if (srv) {
              existing.servantId = srv.id;
              existing.servantName = srv.fullName;
            }
          }
          if (status) existing.status = status;
          if (notes !== undefined) existing.notes = notes;
          if (weekLabel) existing.weekLabel = weekLabel;
          existing.lastUpdatedAt = nowIso;
          dbStore.save();
          res.json({ visitation: existing, visitations: ws.visitationSchedules });
          return;
        }
      }

      const stu = ws.students.find((s) => s.id === studentId);
      const srv = ws.servants.find((s) => s.id === servantId);
      if (!stu || !srv) {
        res.status(400).json({ error: 'يرجى اختيار المخدوم والخادم.' });
        return;
      }
      const created: VisitationRecord = {
        id: sanitizeId('vis'),
        workspaceId,
        studentId: stu.id,
        studentName: stu.fullName,
        studentGrade: stu.grade,
        studentPhone: stu.phone,
        parentPhone: stu.parentPhone,
        servantId: srv.id,
        servantName: srv.fullName,
        status: status || 'pending',
        weekLabel: weekLabel || 'الأسبوع الحالي',
        notes: (notes || '').trim(),
        lastUpdatedAt: nowIso,
      };
      ws.visitationSchedules.unshift(created);
      dbStore.save();
      res.status(201).json({ visitation: created, visitations: ws.visitationSchedules });
    }
  );

  // --- Announcements ---
  app.post(
    '/api/workspaces/:workspaceId/announcements',
    requireAuth,
    requireWorkspaceAccess(['environment_owner', 'head_servant', 'assistant_head', 'servant']),
    (req: AuthedRequest, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '');
      const ws = dbStore.getState().workspaces[workspaceId];
      const actor = dbStore.findUserById(req.session!.sub);
      const { title, body, target, isUrgent } = req.body as Partial<Announcement>;
      if (!title?.trim() || !body?.trim()) {
        res.status(400).json({ error: 'عنوان ونص الإعلان مطلوبان.' });
        return;
      }
      const roleLabels: Record<UserRole, string> = {
        environment_owner: 'إدارة المنصة',
        applicant: 'متقدم',
        head_servant: 'أمين الفصل',
        assistant_head: 'الأمين المساعد',
        servant: 'خادم',
        student: 'مخدوم',
      };
      const announcement: Announcement = {
        id: sanitizeId('ann'),
        workspaceId,
        title: title.trim(),
        body: body.trim(),
        target: target === 'students_only' || target === 'servants_only' ? target : 'all',
        isUrgent: Boolean(isUrgent),
        authorName: actor?.fullName || 'الخدمة',
        authorRole: roleLabels[req.session!.role],
        createdAt: new Date().toISOString(),
      };
      ws.announcements.unshift(announcement);
      dbStore.save();
      res.status(201).json({ announcement });
    }
  );

  app.delete(
    '/api/workspaces/:workspaceId/announcements/:announcementId',
    requireAuth,
    requireWorkspaceAccess(['environment_owner', 'head_servant', 'assistant_head']),
    (req: AuthedRequest, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '');
      const announcementId = String(req.params.announcementId || '');
      const ws = dbStore.getState().workspaces[workspaceId];
      ws.announcements = ws.announcements.filter((a) => a.id !== announcementId);
      dbStore.save();
      res.json({ ok: true });
    }
  );

  // --- Student Data Change Requests ---
  app.post(
    '/api/workspaces/:workspaceId/change-requests',
    requireAuth,
    requireWorkspaceAccess(['environment_owner', 'head_servant', 'assistant_head', 'servant', 'student']),
    (req: AuthedRequest, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '');
      const ws = dbStore.getState().workspaces[workspaceId];
      const actor = dbStore.findUserById(req.session!.sub);
      const { studentId, field, oldValue, newValue, reason } = req.body as Partial<ChangeRequest>;

      const targetStudentId = req.session!.role === 'student' ? actor?.linkedProfileId || '' : studentId || '';
      const stu = ws.students.find((s) => s.id === targetStudentId);
      if (!stu || !field?.trim() || !newValue?.trim()) {
        res.status(400).json({ error: 'بيانات طلب التعديل غير مكتملة.' });
        return;
      }
      const created: ChangeRequest = {
        id: sanitizeId('chg'),
        workspaceId,
        studentId: stu.id,
        studentName: stu.fullName,
        requestedByUsername: actor?.username || '',
        field: field.trim(),
        oldValue: (oldValue || '').trim(),
        newValue: newValue.trim(),
        reason: (reason || '').trim(),
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      ws.changeRequests.unshift(created);
      dbStore.save();
      res.status(201).json({ changeRequest: created });
    }
  );

  app.patch(
    '/api/workspaces/:workspaceId/change-requests/:requestId',
    requireAuth,
    requireWorkspaceAccess(['environment_owner', 'head_servant', 'assistant_head']),
    (req: AuthedRequest, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '');
      const requestId = String(req.params.requestId || '');
      const ws = dbStore.getState().workspaces[workspaceId];
      const actor = dbStore.findUserById(req.session!.sub);
      const cr = ws.changeRequests.find((c) => c.id === requestId);
      if (!cr) {
        res.status(404).json({ error: 'الطلب غير موجود.' });
        return;
      }
      const { status } = req.body as { status?: 'approved' | 'rejected' };
      if (status !== 'approved' && status !== 'rejected') {
        res.status(400).json({ error: 'حالة غير صالحة.' });
        return;
      }
      cr.status = status;
      cr.reviewedBy = actor?.fullName || 'الأمين';
      cr.reviewedAt = new Date().toISOString();

      if (status === 'approved') {
        const stu = ws.students.find((s) => s.id === cr.studentId);
        if (stu) {
          if (cr.field === 'الاسم الكامل') stu.fullName = cr.newValue;
          else if (cr.field === 'رقم الهاتف') stu.phone = cr.newValue;
          else if (cr.field === 'رقم ولي الأمر') stu.parentPhone = cr.newValue;
          else if (cr.field === 'العنوان') stu.address = cr.newValue;
          else if (cr.field === 'تاريخ الميلاد') stu.birthDate = cr.newValue;
          stu.updatedAt = new Date().toISOString();
        }
      }
      dbStore.save();
      res.json({ changeRequest: cr });
    }
  );

  // --- Servants, Audit Logs & Account Security ---
  app.post(
    '/api/workspaces/:workspaceId/servants',
    requireAuth,
    requireWorkspaceAccess(['environment_owner', 'head_servant', 'assistant_head']),
    (req: AuthedRequest, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '');
      const state = dbStore.getState();
      const ws = state.workspaces[workspaceId];
      const { fullName, role, phone, assignedGrade, gender, username, tempPassword, bio } = req.body as Record<
        string,
        string
      >;
      const cleanName = (fullName || '').trim();
      const cleanUser = (username || '').trim();
      const cleanPass = String(tempPassword || '').trim() || '123456';
      const srvRole: Servant['role'] =
        role === 'assistant_head' ? 'assistant_head' : role === 'head_servant' ? 'head_servant' : 'servant';

      if (cleanName.length < 2 || cleanUser.length < 2) {
        res.status(400).json({ error: 'الاسم واسم المستخدم مطلوبان.' });
        return;
      }
      if (state.globalUsers.some((u) => u.username === cleanUser)) {
        res.status(409).json({ error: 'اسم المستخدم مستخدم بالفعل.' });
        return;
      }

      const nowIso = new Date().toISOString();
      const servantId = sanitizeId('srv');
      const servant: Servant = {
        id: servantId,
        workspaceId,
        fullName: cleanName,
        role: srvRole,
        phone: (phone || '').trim(),
        assignedGrade: (assignedGrade || '').trim() || ws.workspace.grades[0] || '',
        gender: gender === 'أنثى' ? 'أنثى' : 'ذكر',
        avatarUrl: '',
        username: cleanUser,
        bio: (bio || '').trim(),
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      const salt = createSalt();
      const acc: WorkspaceAccount = {
        id: `acc_${servantId}`,
        workspaceId,
        username: cleanUser,
        role: srvRole,
        fullName: cleanName,
        phone: (phone || '').trim(),
        linkedProfileId: servantId,
        mustChangePassword: true,
        isActive: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      state.globalUsers.push({
        id: `usr_${servantId}`,
        username: cleanUser,
        passwordHash: hashPassword(cleanPass, salt),
        salt,
        role: srvRole,
        workspaceId,
        fullName: cleanName,
        phone: (phone || '').trim(),
        status: 'active',
        mustChangePassword: true,
        linkedProfileId: servantId,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      ws.servants.push(servant);
      ws.accounts.push(acc);
      dbStore.syncWorkspaceCounts(workspaceId);
      dbStore.save();
      res.status(201).json({ servant, account: acc });
    }
  );

  app.patch(
    '/api/workspaces/:workspaceId/servants/:servantId',
    requireAuth,
    requireWorkspaceAccess(['environment_owner', 'head_servant', 'assistant_head', 'servant']),
    (req: AuthedRequest, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '');
      const servantId = String(req.params.servantId || '');
      const ws = dbStore.getState().workspaces[workspaceId];
      const actor = dbStore.findUserById(req.session!.sub);
      const srv = ws.servants.find((s) => s.id === servantId);
      if (!srv) {
        res.status(404).json({ error: 'الخادم غير موجود.' });
        return;
      }

      const isAdmin =
        req.session!.role === 'environment_owner' ||
        req.session!.role === 'head_servant' ||
        req.session!.role === 'assistant_head';
      if (!isAdmin && actor?.linkedProfileId !== servantId) {
        res.status(403).json({ error: 'يمكنك تعديل ملفك الشخصي فقط.' });
        return;
      }

      const { fullName, phone, assignedGrade, bio, avatarUrl, role } = req.body as Partial<Servant>;
      if (fullName && fullName.trim().length >= 2) srv.fullName = fullName.trim();
      if (phone !== undefined) srv.phone = phone.trim();
      if (bio !== undefined) srv.bio = bio.trim();
      if (avatarUrl !== undefined) srv.avatarUrl = avatarUrl;
      if (isAdmin) {
        if (assignedGrade !== undefined) srv.assignedGrade = assignedGrade.trim();
        if (role === 'head_servant' || role === 'assistant_head' || role === 'servant') srv.role = role;
      }
      srv.updatedAt = new Date().toISOString();

      ws.servantLogs.unshift({
        id: sanitizeId('log'),
        workspaceId,
        servantId: srv.id,
        servantName: srv.fullName,
        action: isAdmin && actor?.linkedProfileId !== servantId ? 'تحديث إداري لملف خادم' : 'تحديث الملف الشخصي للخادم',
        details: `قام ${actor?.fullName || srv.fullName} بتحديث بيانات ملف ${srv.fullName}.`,
        createdAt: srv.updatedAt,
      });
      dbStore.save();
      res.json({ servant: srv });
    }
  );

  app.post(
    '/api/workspaces/:workspaceId/accounts/:accountId/reset-password',
    requireAuth,
    requireWorkspaceAccess(['environment_owner', 'head_servant', 'assistant_head']),
    (req: AuthedRequest, res: Response) => {
      const workspaceId = String(req.params.workspaceId || '');
      const accountId = String(req.params.accountId || '');
      const state = dbStore.getState();
      const ws = state.workspaces[workspaceId];
      const acc = ws.accounts.find((a) => a.id === accountId);
      if (!acc) {
        res.status(404).json({ error: 'الحساب غير موجود.' });
        return;
      }
      const { tempPassword } = req.body as { tempPassword?: string };
      const cleanPass = String(tempPassword || '').trim();
      if (cleanPass.length < 4) {
        res.status(400).json({ error: 'كلمة المرور المؤقتة يجب أن لا تقل عن 4 أحرف.' });
        return;
      }
      const gUser = state.globalUsers.find((u) => u.username === acc.username && u.workspaceId === workspaceId);
      if (!gUser) {
        res.status(404).json({ error: 'سجل الدخول العالمي غير موجود.' });
        return;
      }
      const salt = createSalt();
      gUser.salt = salt;
      gUser.passwordHash = hashPassword(cleanPass, salt);
      gUser.mustChangePassword = true;
      gUser.updatedAt = new Date().toISOString();
      acc.mustChangePassword = true;
      acc.updatedAt = gUser.updatedAt;
      dbStore.save();
      res.json({ ok: true, account: acc });
    }
  );

  return app;
}

async function startLocalServer() {
  const app = createApp();
  const port = Number(process.env.PORT || 3000);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Sunday School Multi-Tenant SaaS running on http://0.0.0.0:${port}`);
  });
}

if (!process.env.VERCEL) {
  startLocalServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
