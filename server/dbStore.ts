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

function getNextSundayIso(offsetWeeks = 0): string {
  const now = new Date();
  const day = now.getDay();
  const diffToSunday = (7 - day) % 7;
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToSunday + offsetWeeks * 7);
  return target.toISOString().slice(0, 10);
}

function buildInitialState(): DatabaseState {
  const nowIso = new Date().toISOString();
  const sampleWorkspaceId = 'ws_st_mary_primary';
  const headServantId = 'srv_mina_head';
  const assistantId = 'srv_marina_asst';
  const servantId = 'srv_kyrillos_srv';

  const sampleStudents: Student[] = [
    {
      id: 'stu_youssef_1',
      workspaceId: sampleWorkspaceId,
      fullName: 'يوسف مينا جرجس',
      grade: 'أولى ابتدائي',
      gender: 'ذكر',
      birthDate: '2019-11-25',
      phone: '01223456781',
      parentPhone: '01223456780',
      address: 'شارع الكنيسة - شبرا',
      avatarUrl: '',
      points: 245,
      badges: ['مواظب بالقداس', 'حافظ المزمور'],
      evaluations: {
        memoryVerse: 95,
        bibleQuiz: 90,
        behavior: 96,
        attendanceRate: 92,
      },
      attendanceHistory: [
        { date: getNextSundayIso(-2), sessionType: 'sunday_school', status: 'present', recordedBy: 'مينا عياد' },
        { date: getNextSundayIso(-1), sessionType: 'mass', status: 'present', recordedBy: 'مينا عياد' },
      ],
      pointsHistory: [
        { id: 'pt_1', amount: 30, reason: 'حفظ آية الأسبوع كاملة', date: getNextSundayIso(-1), recordedBy: 'مينا عياد' },
        { id: 'pt_2', amount: 25, reason: 'حضور القداس مبكراً', date: getNextSundayIso(-1), recordedBy: 'مارينا عادل' },
      ],
      username: 'youssef.mina',
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'stu_mariam_2',
      workspaceId: sampleWorkspaceId,
      fullName: 'مريم هاني فوزي',
      grade: 'تانية ابتدائي',
      gender: 'أنثى',
      birthDate: '2018-04-12',
      phone: '01098765432',
      parentPhone: '01098765431',
      address: 'ميدان المسرة - شبرا',
      avatarUrl: '',
      points: 310,
      badges: ['درع التفوق الذهبي', 'صديقة الجميع'],
      evaluations: {
        memoryVerse: 98,
        bibleQuiz: 94,
        behavior: 100,
        attendanceRate: 96,
      },
      attendanceHistory: [
        { date: getNextSundayIso(-2), sessionType: 'sunday_school', status: 'present', recordedBy: 'مارينا عادل' },
        { date: getNextSundayIso(-1), sessionType: 'sunday_school', status: 'present', recordedBy: 'مارينا عادل' },
      ],
      pointsHistory: [
        { id: 'pt_3', amount: 50, reason: 'اجتياز مسابقة الكتاب المقدس', date: getNextSundayIso(-1), recordedBy: 'مينا عياد' },
      ],
      username: 'mariam.hany',
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'stu_bishoy_3',
      workspaceId: sampleWorkspaceId,
      fullName: 'بيشوي عماد صبحي',
      grade: 'أولى ابتدائي',
      gender: 'ذكر',
      birthDate: '2019-07-08',
      phone: '01155443322',
      parentPhone: '01155443321',
      address: 'شارع خلوصي - شبرا',
      avatarUrl: '',
      points: 180,
      badges: ['مشارك بالألحان'],
      evaluations: {
        memoryVerse: 85,
        bibleQuiz: 82,
        behavior: 90,
        attendanceRate: 84,
      },
      attendanceHistory: [
        { date: getNextSundayIso(-2), sessionType: 'mass', status: 'absent', recordedBy: 'مينا عياد' },
        { date: getNextSundayIso(-1), sessionType: 'sunday_school', status: 'present', recordedBy: 'كيرلس سامي' },
      ],
      pointsHistory: [
        { id: 'pt_4', amount: 20, reason: 'مشاركة متميزة في فقرة الألحان', date: getNextSundayIso(-1), recordedBy: 'كيرلس سامي' },
      ],
      username: 'bishoy.emad',
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ];

  const sampleServants: Servant[] = [
    {
      id: headServantId,
      workspaceId: sampleWorkspaceId,
      fullName: 'أ. مينا عياد رزق',
      role: 'head_servant',
      phone: '01200112233',
      assignedGrade: 'أولى وتانية ابتدائي',
      gender: 'ذكر',
      avatarUrl: '',
      username: 'mina.head',
      bio: 'أمين خدمة المرحلة الابتدائية الصغرى.',
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: assistantId,
      workspaceId: sampleWorkspaceId,
      fullName: 'ت. مارينا عادل ناصف',
      role: 'assistant_head',
      phone: '01200445566',
      assignedGrade: 'تانية ابتدائي',
      gender: 'أنثى',
      avatarUrl: '',
      username: 'marina.asst',
      bio: 'الأمين المساعد ومنسقة الأنشطة والألحان.',
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: servantId,
      workspaceId: sampleWorkspaceId,
      fullName: 'أ. كيرلس سامي حبيب',
      role: 'servant',
      phone: '01200778899',
      assignedGrade: 'أولى ابتدائي',
      gender: 'ذكر',
      avatarUrl: '',
      username: 'kyrillos.srv',
      bio: 'خادم فصل أولى ابتدائي ومسؤول الافتقاد.',
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ];

  const sampleWorkspace: Workspace = {
    id: sampleWorkspaceId,
    churchName: 'كنيسة السيدة العذراء مريم — مسرة',
    className: 'أسرة البابا كيرلس السادس (أولى وتانية ابتدائي)',
    stageConfig: 'أولى وتانية ابتدائي',
    grades: ['أولى ابتدائي', 'تانية ابتدائي'],
    logoUrl: '/src/assets/images/coptic_platform_emblem_1795619749170.jpg',
    verse: '«دَعُوا الأَوْلاَدَ يَأْتُونَ إِلَيَّ وَلاَ تَمْنَعُوهُمْ، لأَنَّ لِمِثْلِ هؤُلاَءِ مَلَكُوتَ السَّمَاوَاتِ» (مت 19: 14)',
    status: 'active',
    headServantId,
    headServantName: 'أ. مينا عياد رزق',
    ownerUid: 'owner_root',
    studentCount: sampleStudents.length,
    servantCount: sampleServants.length,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const sampleSchedules: MonthlySchedule[] = [
    {
      id: 'sch_1',
      workspaceId: sampleWorkspaceId,
      date: getNextSundayIso(0),
      grade: 'أولى ابتدائي',
      lessonTitle: 'الراعي الصالح وحب ربنا يسوع لأولاده',
      memoryVerse: '«أَنَا هُوَ الرَّاعِي الصَّالِحُ، وَالرَّاعِي الصَّالِحُ يَبْذِلُ نَفْسَهُ عَنِ الْخِرَافِ» (يو ١٠: ١١)',
      primaryTeacherId: servantId,
      primaryTeacherName: 'أ. كيرلس سامي حبيب',
      backupTeacherId: headServantId,
      backupTeacherName: 'أ. مينا عياد رزق',
      segments: {
        openingPrayer: true,
        hymns: true,
        coptic: true,
        rites: false,
        behavior: true,
        weeklyReadings: true,
        visitationReview: true,
      },
      notes: 'تجهيز وسائل الإيضاح لخروف الضائع وتوزيع هدايا الحضور المبكر.',
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'sch_2',
      workspaceId: sampleWorkspaceId,
      date: getNextSundayIso(0),
      grade: 'تانية ابتدائي',
      lessonTitle: 'الطفل يسوع في الهيكل وطاعة الوالدين',
      memoryVerse: '«وَكَانَ يَسُوعُ يَتَقَدَّمُ فِي الْحِكْمَةِ وَالْقَامَةِ وَالنِّعْمَةِ» (لو ٢: ٥٢)',
      primaryTeacherId: assistantId,
      primaryTeacherName: 'ت. مارينا عادل ناصف',
      backupTeacherId: headServantId,
      backupTeacherName: 'أ. مينا عياد رزق',
      segments: {
        openingPrayer: true,
        hymns: true,
        coptic: false,
        rites: true,
        behavior: true,
        weeklyReadings: true,
        visitationReview: true,
      },
      notes: 'مراجعة لحن إبؤرو وتعليم درس الطاعة داخل البيت والكنيسة.',
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'sch_3',
      workspaceId: sampleWorkspaceId,
      date: getNextSundayIso(1),
      grade: 'أولى ابتدائي',
      lessonTitle: 'معجزة إشباع الجموع بالخمس خبزات والسمكتين',
      memoryVerse: '«اَلرَّبُّ رَاعِيَّ فَلاَ يُعْوِزُنِي شَيْءٌ» (مز ٢٣: ١)',
      primaryTeacherId: headServantId,
      primaryTeacherName: 'أ. مينا عياد رزق',
      backupTeacherId: servantId,
      backupTeacherName: 'أ. كيرلس سامي حبيب',
      segments: {
        openingPrayer: true,
        hymns: true,
        coptic: true,
        rites: true,
        behavior: false,
        weeklyReadings: true,
        visitationReview: true,
      },
      notes: 'نشاط مشاركة البركة وتجهيز سلة العطاء.',
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ];

  const sampleVisitations: VisitationRecord[] = [
    {
      id: 'vis_1',
      workspaceId: sampleWorkspaceId,
      studentId: 'stu_youssef_1',
      studentName: 'يوسف مينا جرجس',
      studentGrade: 'أولى ابتدائي',
      studentPhone: '01223456781',
      parentPhone: '01223456780',
      servantId,
      servantName: 'أ. كيرلس سامي حبيب',
      status: 'visited',
      weekLabel: 'الأسبوع الحالي',
      notes: 'تمت الزيارة والأسرة تشكر الخدمة على المتابعة.',
      lastUpdatedAt: nowIso,
    },
    {
      id: 'vis_2',
      workspaceId: sampleWorkspaceId,
      studentId: 'stu_mariam_2',
      studentName: 'مريم هاني فوزي',
      studentGrade: 'تانية ابتدائي',
      studentPhone: '01098765432',
      parentPhone: '01098765431',
      servantId: assistantId,
      servantName: 'ت. مارينا عادل ناصف',
      status: 'called',
      weekLabel: 'الأسبوع الحالي',
      notes: 'تم التواصل تليفونياً وتأكيد حضور قداس الجمعة.',
      lastUpdatedAt: nowIso,
    },
    {
      id: 'vis_3',
      workspaceId: sampleWorkspaceId,
      studentId: 'stu_bishoy_3',
      studentName: 'بيشوي عماد صبحي',
      studentGrade: 'أولى ابتدائي',
      studentPhone: '01155443322',
      parentPhone: '01155443321',
      servantId,
      servantName: 'أ. كيرلس سامي حبيب',
      status: 'pending',
      weekLabel: 'الأسبوع الحالي',
      notes: 'تغيب الأسبوع قبل الماضي ويحتاج زيارة منزلية.',
      lastUpdatedAt: nowIso,
    },
  ];

  const sampleAnnouncements: Announcement[] = [
    {
      id: 'ann_1',
      workspaceId: sampleWorkspaceId,
      title: 'حفل ختام شهر كيهك ومهرجان الألحان',
      body: 'ندعو جميع أبنائنا وبناتنا وأولياء الأمور للمشاركة في التدريب الأسبوعي على الألحان يوم الجمعة بعد القداس الإلهي مباشرة في قاعة البابا كيرلس.',
      target: 'all',
      isUrgent: true,
      authorName: 'أ. مينا عياد رزق',
      authorRole: 'أمين الفصل',
      createdAt: nowIso,
    },
    {
      id: 'ann_2',
      workspaceId: sampleWorkspaceId,
      title: 'اجتماع تحضير الخدام الأسبوعي',
      body: 'يرجى من جميع خدام المرحلة الحضور قبل الخدمة بنصف ساعة لمراجعة جدول الافتقاد وتحضير وسائل الإيضاح.',
      target: 'servants_only',
      isUrgent: false,
      authorName: 'ت. مارينا عادل ناصف',
      authorRole: 'الأمين المساعد',
      createdAt: nowIso,
    },
  ];

  const sampleChangeRequests: ChangeRequest[] = [
    {
      id: 'chg_1',
      workspaceId: sampleWorkspaceId,
      studentId: 'stu_bishoy_3',
      studentName: 'بيشوي عماد صبحي',
      requestedByUsername: 'bishoy.emad',
      field: 'رقم ولي الأمر',
      oldValue: '01155443321',
      newValue: '01155443399',
      reason: 'تم تغيير رقم الهاتف الخاص بوالد المخدوم.',
      status: 'pending',
      createdAt: nowIso,
    },
  ];

  const sampleServantLogs: ServantLog[] = [
    {
      id: 'log_1',
      workspaceId: sampleWorkspaceId,
      servantId: servantId,
      servantName: 'أ. كيرلس سامي حبيب',
      action: 'تحديث بيانات الافتقاد',
      details: 'تم تحديث حالة افتقاد المخدوم يوسف مينا إلى تمت الزيارة.',
      createdAt: nowIso,
    },
  ];

  const sampleAccounts: WorkspaceAccount[] = [
    ...sampleServants.map((srv) => ({
      id: `acc_${srv.id}`,
      workspaceId: sampleWorkspaceId,
      username: srv.username,
      role: srv.role,
      fullName: srv.fullName,
      phone: srv.phone,
      linkedProfileId: srv.id,
      mustChangePassword: false,
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    })),
    ...sampleStudents.map((stu) => ({
      id: `acc_${stu.id}`,
      workspaceId: sampleWorkspaceId,
      username: stu.username,
      role: 'student' as const,
      fullName: stu.fullName,
      phone: stu.parentPhone || stu.phone,
      linkedProfileId: stu.id,
      mustChangePassword: false,
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    })),
  ];

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
    ...sampleServants.map((srv) => ({
      id: `usr_${srv.id}`,
      username: srv.username,
      passwordHash: '',
      salt: '',
      role: srv.role,
      workspaceId: sampleWorkspaceId,
      fullName: srv.fullName,
      phone: srv.phone,
      status: 'active' as const,
      mustChangePassword: false,
      linkedProfileId: srv.id,
      createdAt: nowIso,
      updatedAt: nowIso,
    })),
    ...sampleStudents.map((stu) => ({
      id: `usr_${stu.id}`,
      username: stu.username,
      passwordHash: '',
      salt: '',
      role: 'student' as const,
      workspaceId: sampleWorkspaceId,
      fullName: stu.fullName,
      phone: stu.parentPhone || stu.phone,
      status: 'active' as const,
      mustChangePassword: false,
      linkedProfileId: stu.id,
      createdAt: nowIso,
      updatedAt: nowIso,
    })),
  ];

  const chatChannels: EnvironmentChatChannel[] = [
    {
      id: 'global_leaders',
      type: 'group',
      title: 'مجتمع أمناء الفصول',
      lastMessage: 'أهلاً بكم جميعاً في قناة التواصل المركزية بين أمناء الفصول وصاحب المنصة.',
      lastMessageAt: nowIso,
    },
    {
      id: `direct_usr_${headServantId}`,
      type: 'direct',
      title: 'أ. مينا عياد رزق — كنيسة السيدة العذراء مريم',
      participantUserId: `usr_${headServantId}`,
      participantName: 'أ. مينا عياد رزق',
      participantRole: 'head_servant',
      workspaceId: sampleWorkspaceId,
      churchName: sampleWorkspace.churchName,
      className: sampleWorkspace.className,
      lastMessage: 'تم تفعيل مساحة خدمة أسرة البابا كيرلس بنجاح.',
      lastMessageAt: nowIso,
    },
  ];

  const chatMessages: Record<string, EnvironmentChatMessage[]> = {
    global_leaders: [
      {
        id: 'msg_welcome_global',
        channelId: 'global_leaders',
        senderId: 'owner_root',
        senderName: 'صاحب الـ Environment',
        senderRole: 'environment_owner',
        senderWorkspaceName: 'الإدارة المركزية للمنصة',
        text: 'سلام ونعمة لكم جميعاً أمناء الفصول. هذه القناة مخصصة لتبادل الخبرات والمقترحات ومتابعة احتياجات كل كنيسة.',
        createdAt: nowIso,
        isSystem: true,
      },
    ],
    [`direct_usr_${headServantId}`]: [
      {
        id: 'msg_welcome_head',
        channelId: `direct_usr_${headServantId}`,
        senderId: 'owner_root',
        senderName: 'صاحب الـ Environment',
        senderRole: 'environment_owner',
        senderWorkspaceName: 'الإدارة المركزية للمنصة',
        text: 'تم إطلاق مساحة الخدمة الخاصة بفصلكم. يمكنكم تعيين كلمات المرور للخدام والمخدومين من تبويب أمان الحسابات.',
        createdAt: nowIso,
        isSystem: true,
      },
    ],
  };

  return {
    ownerClaimed: false,
    ownerEmail: 'jovanni.ayman@gmail.com',
    globalUsers,
    workspaces: {
      [sampleWorkspaceId]: {
        workspace: sampleWorkspace,
        students: sampleStudents,
        servants: sampleServants,
        accounts: sampleAccounts,
        monthlySchedules: sampleSchedules,
        visitationSchedules: sampleVisitations,
        announcements: sampleAnnouncements,
        changeRequests: sampleChangeRequests,
        servantLogs: sampleServantLogs,
      },
    },
    chatChannels,
    chatMessages,
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
      console.error('Failed to read DB state from disk, initializing fresh state:', err);
    }
    const fresh = buildInitialState();
    this.saveToDisk(fresh);
    return fresh;
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
