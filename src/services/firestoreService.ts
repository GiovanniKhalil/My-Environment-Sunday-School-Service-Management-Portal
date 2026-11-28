import type { User } from 'firebase/auth';
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  onSnapshot,
  type DocumentReference,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  auth,
  db,
  ensureAnonymousFirebaseAuth,
  handleFirestoreError,
  OperationType,
  signInOwnerWithGoogle,
  signOutFirebase,
} from '../firebase';
import type {
  AccountStatus,
  ActiveSession,
  Announcement,
  AnnouncementTarget,
  AttendanceRecord,
  ChangeRequest,
  EnvironmentChatChannel,
  EnvironmentChatMessage,
  Gender,
  GlobalUser,
  HeadServantSummary,
  LoginDirectoryEntry,
  MonthlySchedule,
  Servant,
  ServantLog,
  SessionUser,
  Student,
  UserRole,
  VisitationRecord,
  VisitationStatus,
  Workspace,
  WorkspaceAccount,
  WorkspaceBundle,
  WorkspaceStage,
  WorkspaceStatus,
} from '../types';
import { formatLiveArabicDate, type ImportedStudentRow } from '../utils/api';

export const OWNER_EMAIL = 'jovanni.ayman@gmail.com';
export const DEFAULT_WORKSPACE_VERSE =
  '«اخْدِمُوا الرَّبَّ بِفَرَحٍ، ادْخُلُوا إِلَى حَضْرَتِهِ بِتَرَنُّمٍ» (مز ١٠٠: ٢)';

export function sanitizeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function toLoginKey(username: string): string {
  const bytes = new TextEncoder().encode(username.trim());
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64url = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `u_${base64url}`;
}

export function randomSalt(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function normalizePhone(phone: string): string {
  const digits = (phone || '').replace(/\D+/g, '');
  return digits.length >= 4 ? digits : (phone || '').trim();
}

export async function computeCredentialHashes(
  password: string,
  userId: string,
  phone: string,
  existingSalt?: string
): Promise<{
  salt: string;
  passwordHash: string;
  claimProof: string;
  claimVerifier: string;
  phoneProofVerifier: string;
}> {
  const salt = existingSalt || randomSalt();
  const passwordHash = await sha256Hex(`${salt}:${password}`);
  const claimProof = await sha256Hex(`${salt}:${password}:claim:${userId}`);
  const claimVerifier = await sha256Hex(claimProof);
  const normPhone = normalizePhone(phone);
  const phoneProofVerifier = normPhone
    ? await sha256Hex(await sha256Hex(`${salt}:${normPhone}:phone-proof`))
    : '';
  return { salt, passwordHash, claimProof, claimVerifier, phoneProofVerifier };
}

type BatchOp =
  | { type: 'set'; ref: DocumentReference; data: Record<string, unknown> }
  | { type: 'update'; ref: DocumentReference; data: Record<string, unknown> }
  | { type: 'delete'; ref: DocumentReference };

async function commitBatchOps(ops: BatchOp[], chunkSize = 400): Promise<void> {
  for (let i = 0; i < ops.length; i += chunkSize) {
    const chunk = ops.slice(i, i + chunkSize);
    const batch = writeBatch(db);
    for (const op of chunk) {
      if (op.type === 'set') batch.set(op.ref, op.data);
      else if (op.type === 'update') batch.update(op.ref, op.data);
      else batch.delete(op.ref);
    }
    await batch.commit();
  }
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

function buildSessionUserFromParts(
  gUser: Record<string, unknown>,
  privData?: Record<string, unknown>
): SessionUser {
  return {
    id: String(gUser.id || ''),
    username: String(gUser.username || ''),
    role: gUser.role as UserRole,
    workspaceId: String(gUser.workspaceId || ''),
    fullName: String(gUser.fullName || ''),
    phone: String(privData?.phone || ''),
    email: privData?.email ? String(privData.email) : undefined,
    status: (gUser.status as AccountStatus) || 'active',
    mustChangePassword: Boolean(
      gUser.mustChangePassword !== undefined ? gUser.mustChangePassword : privData?.mustChangePassword
    ),
    linkedProfileId: String(gUser.linkedProfileId || privData?.linkedProfileId || gUser.id || ''),
    ownerUid: gUser.ownerUid ? String(gUser.ownerUid) : undefined,
    proposedChurchName: privData?.proposedChurchName ? String(privData.proposedChurchName) : undefined,
    proposedClassName: privData?.proposedClassName ? String(privData.proposedClassName) : undefined,
    proposedStageConfig: privData?.proposedStageConfig ? String(privData.proposedStageConfig) : undefined,
    serviceVision: privData?.serviceVision ? String(privData.serviceVision) : undefined,
    approvedWorkspaceId: gUser.approvedWorkspaceId ? String(gUser.approvedWorkspaceId) : undefined,
    createdAt: String(gUser.createdAt || ''),
    updatedAt: String(gUser.updatedAt || gUser.createdAt || ''),
  };
}

// ============================================================================
// AUTHENTICATION, BOOTSTRAP & SESSION RESTORATION
// ============================================================================

export async function ensureOwnerBootstrapInFirestore(firebaseUser: User): Promise<SessionUser> {
  const nowIso = new Date().toISOString();
  const ownerRef = doc(db, 'globalUsers', 'owner_root');
  const ownerPrivRef = doc(db, 'globalUsers', 'owner_root', 'private', 'info');
  const broadcastRef = doc(db, 'environmentChat', 'global_leaders');

  let existingOwner: Record<string, unknown> | undefined;
  try {
    const snap = await getDoc(ownerRef);
    if (snap.exists()) existingOwner = snap.data() as Record<string, unknown>;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, 'globalUsers/owner_root');
  }

  const displayName =
    firebaseUser.displayName && firebaseUser.displayName.trim()
      ? firebaseUser.displayName.trim()
      : String(existingOwner?.fullName || 'صاحب الـ Environment');

  if (!existingOwner) {
    try {
      const batch = writeBatch(db);
      batch.set(ownerRef, {
        id: 'owner_root',
        username: 'owner',
        role: 'environment_owner',
        workspaceId: '',
        fullName: displayName,
        status: 'active',
        mustChangePassword: false,
        linkedProfileId: 'owner_root',
        ownerUid: firebaseUser.uid,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      batch.set(ownerPrivRef, {
        userId: 'owner_root',
        phone: '',
        email: OWNER_EMAIL,
        mustChangePassword: false,
        linkedProfileId: 'owner_root',
      });
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'globalUsers/owner_root');
    }
  }

  try {
    const broadcastSnap = await getDoc(broadcastRef);
    if (!broadcastSnap.exists()) {
      const welcomeMsgId = 'msg_welcome_global';
      const batch = writeBatch(db);
      batch.set(broadcastRef, {
        id: 'global_leaders',
        type: 'group',
        title: 'إشعارات وتنبيهات المنصة',
        isBroadcast: true,
        isCustomGroup: false,
        createdBy: 'owner_root',
        createdAt: nowIso,
        lastMessage: 'قناة الإشعارات والتنبيهات الرسمية لإدارة المنصة إلى أمناء الفصول.',
        lastMessageAt: nowIso,
      });
      batch.set(doc(db, 'environmentChat', 'global_leaders', 'messages', welcomeMsgId), {
        id: welcomeMsgId,
        channelId: 'global_leaders',
        senderUid: firebaseUser.uid,
        senderId: 'owner_root',
        senderName: displayName,
        senderRole: 'environment_owner',
        senderWorkspaceName: 'الإدارة المركزية للمنصة',
        text: 'سلام ونعمة لكم جميعاً أمناء الفصول. هذه القناة مخصصة لإشعارات وتنبيهات إدارة المنصة.',
        createdAt: nowIso,
        isSystem: true,
      });
      await batch.commit();
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'environmentChat/global_leaders');
  }

  return {
    id: 'owner_root',
    username: 'owner',
    role: 'environment_owner',
    workspaceId: '',
    fullName: displayName,
    phone: '',
    email: OWNER_EMAIL,
    status: 'active',
    mustChangePassword: false,
    linkedProfileId: 'owner_root',
    ownerUid: firebaseUser.uid,
    createdAt: String(existingOwner?.createdAt || nowIso),
    updatedAt: nowIso,
  };
}

export async function loginWithGoogleOwner(): Promise<SessionUser> {
  const { user, email } = await signInOwnerWithGoogle();
  if (!email || email.toLowerCase() !== OWNER_EMAIL.toLowerCase() || !user.emailVerified) {
    await signOutFirebase();
    throw new Error('هذا البريد الإلكتروني غير مصرح له بالدخول كصاحب الـ Environment.');
  }
  return ensureOwnerBootstrapInFirestore(user);
}

export async function restoreSessionFromFirebaseAuth(
  firebaseUser: User | null
): Promise<{ user: SessionUser | null; workspace: Workspace | null }> {
  if (!firebaseUser) {
    return { user: null, workspace: null };
  }

  if (!firebaseUser.isAnonymous) {
    if (
      firebaseUser.email?.toLowerCase() === OWNER_EMAIL.toLowerCase() &&
      firebaseUser.emailVerified
    ) {
      const ownerUser = await ensureOwnerBootstrapInFirestore(firebaseUser);
      return { user: ownerUser, workspace: null };
    }
    await signOutFirebase();
    return { user: null, workspace: null };
  }

  // Anonymous user: restore from activeSessions/{uid}
  const sessionPath = `activeSessions/${firebaseUser.uid}`;
  let sessionData: ActiveSession | null = null;
  try {
    const snap = await getDoc(doc(db, 'activeSessions', firebaseUser.uid));
    if (!snap.exists()) return { user: null, workspace: null };
    sessionData = snap.data() as ActiveSession;
  } catch {
    return { user: null, workspace: null };
  }

  let gUserData: Record<string, unknown> | undefined;
  let privData: Record<string, unknown> | undefined;
  try {
    const [gSnap, pSnap] = await Promise.all([
      getDoc(doc(db, 'globalUsers', sessionData.userId)),
      getDoc(doc(db, 'globalUsers', sessionData.userId, 'private', 'info')),
    ]);
    if (!gSnap.exists()) return { user: null, workspace: null };
    gUserData = gSnap.data() as Record<string, unknown>;
    if (pSnap.exists()) privData = pSnap.data() as Record<string, unknown>;
  } catch {
    return { user: null, workspace: null };
  }

  const user = buildSessionUserFromParts(gUserData, privData);
  if (user.status === 'suspended' || user.status === 'rejected') {
    await logoutFromFirestore(user);
    return { user: null, workspace: null };
  }

  // If applicant was approved into a workspace, make sure member binding exists
  if (user.workspaceId) {
    try {
      const memberRef = doc(db, 'workspaces', user.workspaceId, 'members', firebaseUser.uid);
      const memberSnap = await getDoc(memberRef);
      if (!memberSnap.exists()) {
        await setDoc(memberRef, {
          uid: firebaseUser.uid,
          workspaceId: user.workspaceId,
          role: user.role,
          linkedProfileId: user.linkedProfileId,
          userId: user.id,
          loginKey: sessionData.loginKey,
          claimProof: sessionData.claimProof,
          createdAt: new Date().toISOString(),
        });
      }
      const wsSnap = await getDoc(doc(db, 'workspaces', user.workspaceId));
      if (!wsSnap.exists()) return { user: null, workspace: null };
      const ws = wsSnap.data() as Workspace;
      if (ws.status !== 'active') {
        await logoutFromFirestore(user);
        return { user: null, workspace: null };
      }
      return { user, workspace: ws };
    } catch {
      return { user: null, workspace: null };
    }
  }

  return { user, workspace: null };
}

export async function loginWithCredentials(
  username: string,
  password: string
): Promise<{ user: SessionUser; workspace: Workspace | null }> {
  const cleanUsername = username.trim();
  const cleanPassword = String(password || '');
  if (!cleanUsername || !cleanPassword) {
    throw new Error('يرجى إدخال اسم المستخدم وكلمة المرور.');
  }

  const fbUser = await ensureAnonymousFirebaseAuth();
  const loginKey = toLoginKey(cleanUsername);
  const dirRef = doc(db, 'loginDirectory', loginKey);

  let entry: LoginDirectoryEntry | null = null;
  try {
    const snap = await getDoc(dirRef);
    if (!snap.exists()) {
      throw new Error('بيانات الدخول غير صحيحة أو لم يتم تعيين كلمة مرور للحساب بعد.');
    }
    entry = snap.data() as LoginDirectoryEntry;
  } catch (err) {
    if (err instanceof Error && err.message.includes('بيانات الدخول')) throw err;
    handleFirestoreError(err, OperationType.GET, `loginDirectory/${loginKey}`);
  }

  if (!entry || !entry.passwordHash || !entry.salt) {
    throw new Error('بيانات الدخول غير صحيحة أو لم يتم تعيين كلمة مرور للحساب بعد.');
  }

  const actualHash = await sha256Hex(`${entry.salt}:${cleanPassword}`);
  if (actualHash !== entry.passwordHash) {
    throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة.');
  }

  if (entry.status === 'suspended' || entry.status === 'rejected') {
    throw new Error('تم تعليق هذا الحساب. تواصل مع أمين الفصل أو إدارة المنصة.');
  }

  const claimProof = await sha256Hex(`${entry.salt}:${cleanPassword}:claim:${entry.userId}`);
  const nowIso = new Date().toISOString();

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'activeSessions', fbUser.uid), {
      uid: fbUser.uid,
      userId: entry.userId,
      loginKey,
      role: entry.role,
      workspaceId: entry.workspaceId || '',
      fullName: entry.fullName,
      linkedProfileId: entry.linkedProfileId || entry.userId,
      claimProof,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    if (entry.workspaceId) {
      batch.set(doc(db, 'workspaces', entry.workspaceId, 'members', fbUser.uid), {
        uid: fbUser.uid,
        workspaceId: entry.workspaceId,
        role: entry.role,
        linkedProfileId: entry.linkedProfileId || entry.userId,
        userId: entry.userId,
        loginKey,
        claimProof,
        createdAt: nowIso,
      });
    }
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `activeSessions/${fbUser.uid}`);
  }

  let workspace: Workspace | null = null;
  if (entry.workspaceId) {
    try {
      const wsSnap = await getDoc(doc(db, 'workspaces', entry.workspaceId));
      if (!wsSnap.exists()) {
        throw new Error('مساحة الخدمة المرتبطة بالحساب غير موجودة.');
      }
      workspace = wsSnap.data() as Workspace;
      if (workspace.status !== 'active') {
        await deleteDoc(doc(db, 'activeSessions', fbUser.uid)).catch(() => {});
        await deleteDoc(doc(db, 'workspaces', entry.workspaceId, 'members', fbUser.uid)).catch(() => {});
        throw new Error('مساحة خدمة هذا الفصل معلقة حالياً من صاحب المنصة.');
      }
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes('معلقة') || err.message.includes('غير موجودة'))
      ) {
        throw err;
      }
      handleFirestoreError(err, OperationType.GET, `workspaces/${entry.workspaceId}`);
    }
  }

  let gUserData: Record<string, unknown> = {};
  let privData: Record<string, unknown> | undefined;
  try {
    const [gSnap, pSnap] = await Promise.all([
      getDoc(doc(db, 'globalUsers', entry.userId)),
      getDoc(doc(db, 'globalUsers', entry.userId, 'private', 'info')),
    ]);
    if (gSnap.exists()) gUserData = gSnap.data() as Record<string, unknown>;
    if (pSnap.exists()) privData = pSnap.data() as Record<string, unknown>;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `globalUsers/${entry.userId}`);
  }

  const sessionUser = buildSessionUserFromParts(
    Object.keys(gUserData).length > 0
      ? gUserData
      : {
          id: entry.userId,
          username: entry.username,
          role: entry.role,
          workspaceId: entry.workspaceId,
          fullName: entry.fullName,
          status: entry.status,
          mustChangePassword: entry.mustChangePassword,
          linkedProfileId: entry.linkedProfileId,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        },
    privData
  );

  return { user: sessionUser, workspace };
}

export async function registerApplicantInFirestore(regForm: {
  fullName: string;
  phone: string;
  proposedChurchName: string;
  proposedClassName: string;
  proposedStageConfig: string;
  serviceVision: string;
  username: string;
  password: string;
}): Promise<SessionUser> {
  const cleanName = regForm.fullName.trim();
  const cleanPhone = regForm.phone.trim();
  const cleanChurch = regForm.proposedChurchName.trim();
  const cleanClass = regForm.proposedClassName.trim();
  const cleanStage = regForm.proposedStageConfig.trim() || 'مراحل مخصصة';
  const cleanVision = regForm.serviceVision.trim();
  const cleanUsername = regForm.username.trim();
  const cleanPass = String(regForm.password || '');

  if (!cleanName || !cleanPhone || !cleanChurch || !cleanClass || !cleanUsername || cleanPass.length < 6) {
    throw new Error('يرجى استيفاء جميع البيانات المطلوبة وكلمة مرور لا تقل عن 6 أحرف.');
  }

  const fbUser = await ensureAnonymousFirebaseAuth();
  const uid = fbUser.uid;
  const loginKey = toLoginKey(cleanUsername);

  try {
    const existingDir = await getDoc(doc(db, 'loginDirectory', loginKey));
    if (existingDir.exists()) {
      throw new Error('اسم المستخدم محجوز بالفعل.');
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('محجوز')) throw err;
    handleFirestoreError(err, OperationType.GET, `loginDirectory/${loginKey}`);
  }

  const nowIso = new Date().toISOString();
  const creds = await computeCredentialHashes(cleanPass, uid, cleanPhone);
  const channelId = `direct_${uid}`;
  const welcomeMsgId = sanitizeId('msg');
  const welcomeText = `طلب تأسيس غرفة خدمة جديد من ${cleanName} (${cleanChurch} — ${cleanClass}).`;

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'globalUsers', uid), {
      id: uid,
      username: cleanUsername,
      role: 'applicant',
      workspaceId: '',
      fullName: cleanName,
      status: 'pending',
      mustChangePassword: false,
      linkedProfileId: uid,
      ownerUid: uid,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    batch.set(doc(db, 'globalUsers', uid, 'private', 'info'), {
      userId: uid,
      phone: cleanPhone,
      passwordHash: creds.passwordHash,
      salt: creds.salt,
      proposedChurchName: cleanChurch,
      proposedClassName: cleanClass,
      proposedStageConfig: cleanStage,
      serviceVision: cleanVision,
      mustChangePassword: false,
      linkedProfileId: uid,
    });
    batch.set(doc(db, 'loginDirectory', loginKey), {
      loginKey,
      userId: uid,
      username: cleanUsername,
      role: 'applicant',
      workspaceId: '',
      fullName: cleanName,
      status: 'pending',
      mustChangePassword: false,
      linkedProfileId: uid,
      salt: creds.salt,
      passwordHash: creds.passwordHash,
      claimVerifier: creds.claimVerifier,
      phoneProofVerifier: creds.phoneProofVerifier,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    batch.set(doc(db, 'activeSessions', uid), {
      uid,
      userId: uid,
      loginKey,
      role: 'applicant',
      workspaceId: '',
      fullName: cleanName,
      linkedProfileId: uid,
      claimProof: creds.claimProof,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    batch.set(doc(db, 'environmentChat', channelId), {
      id: channelId,
      type: 'applicant_direct',
      title: `طلب خدمة: ${cleanName} (${cleanChurch})`,
      participantUid: uid,
      participantUserId: uid,
      participantName: cleanName,
      participantRole: 'applicant',
      churchName: cleanChurch,
      className: cleanClass,
      lastMessage: welcomeText,
      lastMessageAt: nowIso,
    });
    batch.set(doc(db, 'environmentChat', channelId, 'messages', welcomeMsgId), {
      id: welcomeMsgId,
      channelId,
      senderUid: uid,
      senderId: uid,
      senderName: cleanName,
      senderRole: 'applicant',
      senderWorkspaceName: `${cleanChurch} — ${cleanClass}`,
      text: welcomeText,
      createdAt: nowIso,
      isSystem: true,
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `globalUsers/${uid}`);
  }

  return {
    id: uid,
    username: cleanUsername,
    role: 'applicant',
    workspaceId: '',
    fullName: cleanName,
    phone: cleanPhone,
    status: 'pending',
    mustChangePassword: false,
    linkedProfileId: uid,
    ownerUid: uid,
    proposedChurchName: cleanChurch,
    proposedClassName: cleanClass,
    proposedStageConfig: cleanStage,
    serviceVision: cleanVision,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export async function resetPasswordWithPhoneInFirestore(
  username: string,
  phone: string,
  newPassword: string
): Promise<void> {
  const cleanUsername = username.trim();
  const cleanPhone = normalizePhone(phone);
  const cleanPass = String(newPassword || '');
  if (!cleanUsername || !cleanPhone || cleanPass.length < 6) {
    throw new Error('يرجى إدخال اسم المستخدم ورقم الهاتف وكلمة مرور جديدة (6 أحرف فأكثر).');
  }

  await ensureAnonymousFirebaseAuth();
  const loginKey = toLoginKey(cleanUsername);
  const dirRef = doc(db, 'loginDirectory', loginKey);

  let entry: LoginDirectoryEntry | null = null;
  try {
    const snap = await getDoc(dirRef);
    if (!snap.exists()) {
      throw new Error('لم يتم العثور على حساب مطابق لاسم المستخدم.');
    }
    entry = snap.data() as LoginDirectoryEntry;
  } catch (err) {
    if (err instanceof Error && err.message.includes('لم يتم العثور')) throw err;
    handleFirestoreError(err, OperationType.GET, `loginDirectory/${loginKey}`);
  }

  if (!entry) throw new Error('لم يتم العثور على الحساب.');

  const phoneProof = await sha256Hex(`${entry.salt}:${cleanPhone}:phone-proof`);
  const phoneProofVerifierAttempt = await sha256Hex(phoneProof);
  if (!entry.phoneProofVerifier || phoneProofVerifierAttempt !== entry.phoneProofVerifier) {
    throw new Error('رقم الهاتف غير مطابق للمسجل بالحساب.');
  }

  const nextCreds = await computeCredentialHashes(cleanPass, entry.userId, cleanPhone);
  const nowIso = new Date().toISOString();

  try {
    await updateDoc(dirRef, {
      salt: nextCreds.salt,
      passwordHash: nextCreds.passwordHash,
      claimVerifier: nextCreds.claimVerifier,
      phoneProofVerifier: nextCreds.phoneProofVerifier,
      lastResetProof: phoneProof,
      mustChangePassword: false,
      updatedAt: nowIso,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `loginDirectory/${loginKey}`);
  }
}

export async function changeOwnPasswordInFirestore(
  currentUser: SessionUser,
  newPassword: string
): Promise<SessionUser> {
  const cleanPass = String(newPassword || '');
  if (cleanPass.length < 6) {
    throw new Error('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل.');
  }

  const fbUser = auth.currentUser;
  if (!fbUser) throw new Error('الجلسة غير نشطة.');

  const loginKey = toLoginKey(currentUser.username);
  const nowIso = new Date().toISOString();
  const creds = await computeCredentialHashes(cleanPass, currentUser.id, currentUser.phone || '');

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'loginDirectory', loginKey), {
      salt: creds.salt,
      passwordHash: creds.passwordHash,
      claimVerifier: creds.claimVerifier,
      mustChangePassword: false,
      updatedAt: nowIso,
    });
    batch.update(doc(db, 'globalUsers', currentUser.id), {
      mustChangePassword: false,
      updatedAt: nowIso,
    });
    batch.update(doc(db, 'globalUsers', currentUser.id, 'private', 'info'), {
      salt: creds.salt,
      passwordHash: creds.passwordHash,
      mustChangePassword: false,
    });
    if (fbUser.isAnonymous) {
      batch.update(doc(db, 'activeSessions', fbUser.uid), {
        claimProof: creds.claimProof,
        updatedAt: nowIso,
      });
    }
    if (currentUser.workspaceId && currentUser.linkedProfileId) {
      batch.update(
        doc(db, 'workspaces', currentUser.workspaceId, 'accounts', `acc_${currentUser.linkedProfileId}`),
        {
          mustChangePassword: false,
          updatedAt: nowIso,
        }
      );
      if (fbUser.isAnonymous) {
        batch.update(doc(db, 'workspaces', currentUser.workspaceId, 'members', fbUser.uid), {
          claimProof: creds.claimProof,
        });
      }
    }
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `loginDirectory/${loginKey}`);
  }

  return {
    ...currentUser,
    mustChangePassword: false,
    updatedAt: nowIso,
  };
}

export async function logoutFromFirestore(currentUser: SessionUser | null): Promise<void> {
  const fbUser = auth.currentUser;
  if (fbUser && fbUser.isAnonymous) {
    await deleteDoc(doc(db, 'activeSessions', fbUser.uid)).catch(() => {});
    if (currentUser?.workspaceId) {
      await deleteDoc(doc(db, 'workspaces', currentUser.workspaceId, 'members', fbUser.uid)).catch(() => {});
    }
  }
  await signOutFirebase();
}

// ============================================================================
// OWNER DASHBOARD SUBSCRIPTIONS & MUTATIONS
// ============================================================================

export function subscribeOwnerWorkspaces(
  onData: (workspaces: Workspace[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  return onSnapshot(
    collection(db, 'workspaces'),
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as Workspace)
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      onData(list);
    },
    (err) => {
      if (onError) onError(err);
      handleFirestoreError(err, OperationType.LIST, 'workspaces');
    }
  );
}

export function subscribeOwnerApplicants(
  onData: (applicants: SessionUser[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const q = query(collection(db, 'globalUsers'), where('role', '==', 'applicant'));
  return onSnapshot(
    q,
    (snap) => {
      void (async () => {
        try {
          const items = await Promise.all(
            snap.docs.map(async (d) => {
              const gData = d.data() as Record<string, unknown>;
              let privData: Record<string, unknown> | undefined;
              try {
                const pSnap = await getDoc(doc(db, 'globalUsers', d.id, 'private', 'info'));
                if (pSnap.exists()) privData = pSnap.data() as Record<string, unknown>;
              } catch {
                // ignore missing private doc
              }
              return buildSessionUserFromParts(gData, privData);
            })
          );
          items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
          onData(items);
        } catch (err) {
          if (onError) onError(err);
          handleFirestoreError(err, OperationType.GET, 'globalUsers/applicants');
        }
      })();
    },
    (err) => {
      if (onError) onError(err);
      handleFirestoreError(err, OperationType.LIST, 'globalUsers');
    }
  );
}

export async function createWorkspaceInFirestore(payload: {
  applicantId?: string;
  churchName: string;
  className: string;
  stages: WorkspaceStage[];
  logoUrl: string;
  verse: string;
  headFullName: string;
  headUsername: string;
  headPhone: string;
  headTempPassword: string;
}): Promise<Workspace> {
  const cleanChurch = payload.churchName.trim();
  const cleanClass = payload.className.trim();
  const cleanHeadName = payload.headFullName.trim();
  const cleanHeadUser = payload.headUsername.trim();
  const cleanHeadPhone = payload.headPhone.trim();
  const cleanHeadPass = String(payload.headTempPassword || '');

  if (!cleanChurch || !cleanClass || !cleanHeadName || !cleanHeadUser || cleanHeadPass.length < 4) {
    throw new Error('يرجى استيفاء بيانات الكنيسة والفصل وأمين الفصل وكلمة المرور المؤقتة.');
  }

  const validStages = payload.stages
    .map((s, idx) => ({ id: (s.id || '').trim() || `stg_${idx + 1}`, name: s.name.trim() }))
    .filter((s) => s.name.length > 0);
  if (validStages.length === 0) {
    throw new Error('يرجى إضافة مرحلة دراسية واحدة على الأقل.');
  }

  const grades = validStages.map((s) => s.name);
  const stageConfig = grades.join('، ');
  const cleanVerse = payload.verse.trim() || DEFAULT_WORKSPACE_VERSE;

  const loginKey = toLoginKey(cleanHeadUser);
  try {
    const dirSnap = await getDoc(doc(db, 'loginDirectory', loginKey));
    if (dirSnap.exists()) {
      const existingDir = dirSnap.data() as LoginDirectoryEntry;
      if (!payload.applicantId || existingDir.userId !== payload.applicantId) {
        throw new Error('اسم المستخدم الخاص بأمين الفصل مستخدم بالفعل.');
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('مستخدم بالفعل')) throw err;
    handleFirestoreError(err, OperationType.GET, `loginDirectory/${loginKey}`);
  }

  const nowIso = new Date().toISOString();
  const workspaceId = sanitizeId('ws');
  const headServantId = sanitizeId('srv');
  const headUserId = payload.applicantId ? payload.applicantId : `usr_${headServantId}`;
  const ownerUid = auth.currentUser?.uid || 'owner_root';

  let oldApplicantLoginKey: string | null = null;
  if (payload.applicantId) {
    try {
      const appSnap = await getDoc(doc(db, 'globalUsers', payload.applicantId));
      if (appSnap.exists()) {
        const oldUsername = String(appSnap.data().username || '');
        if (oldUsername && oldUsername !== cleanHeadUser) {
          oldApplicantLoginKey = toLoginKey(oldUsername);
        }
      }
    } catch {
      // ignore
    }
  }

  const creds = await computeCredentialHashes(cleanHeadPass, headUserId, cleanHeadPhone);

  const newWorkspace: Workspace = {
    id: workspaceId,
    churchName: cleanChurch,
    className: cleanClass,
    stageConfig,
    grades,
    stages: validStages,
    logoUrl: payload.logoUrl || '',
    verse: cleanVerse,
    status: 'active',
    headServantId,
    headServantName: cleanHeadName,
    ownerUid,
    studentCount: 0,
    servantCount: 1,
    customGroupIds: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const headServant: Servant = {
    id: headServantId,
    workspaceId,
    fullName: cleanHeadName,
    role: 'head_servant',
    phone: cleanHeadPhone,
    assignedGrade: grades[0],
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

  const wsChatId = `ws_chat_${workspaceId}`;
  const wsChatMsgId = sanitizeId('msg');
  const directChatId = `direct_${headUserId}`;
  const directMsgId = sanitizeId('msg');

  const ops: BatchOp[] = [
    { type: 'set', ref: doc(db, 'workspaces', workspaceId), data: { ...newWorkspace } },
    {
      type: 'set',
      ref: doc(db, 'workspaces', workspaceId, 'servants', headServantId),
      data: { ...headServant },
    },
    {
      type: 'set',
      ref: doc(db, 'workspaces', workspaceId, 'accounts', headAccount.id),
      data: { ...headAccount },
    },
    {
      type: 'set',
      ref: doc(db, 'globalUsers', headUserId),
      data: {
        id: headUserId,
        username: cleanHeadUser,
        role: 'head_servant',
        workspaceId,
        fullName: cleanHeadName,
        status: 'active',
        mustChangePassword: true,
        linkedProfileId: headServantId,
        approvedWorkspaceId: workspaceId,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    },
    {
      type: 'set',
      ref: doc(db, 'globalUsers', headUserId, 'private', 'info'),
      data: {
        userId: headUserId,
        phone: cleanHeadPhone,
        passwordHash: creds.passwordHash,
        salt: creds.salt,
        mustChangePassword: true,
        linkedProfileId: headServantId,
      },
    },
    {
      type: 'set',
      ref: doc(db, 'loginDirectory', loginKey),
      data: {
        loginKey,
        userId: headUserId,
        username: cleanHeadUser,
        role: 'head_servant',
        workspaceId,
        fullName: cleanHeadName,
        status: 'active',
        mustChangePassword: true,
        linkedProfileId: headServantId,
        salt: creds.salt,
        passwordHash: creds.passwordHash,
        claimVerifier: creds.claimVerifier,
        phoneProofVerifier: creds.phoneProofVerifier,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    },
    {
      type: 'set',
      ref: doc(db, 'environmentChat', wsChatId),
      data: {
        id: wsChatId,
        type: 'workspace_internal',
        title: `شات خدام: ${cleanClass}`,
        workspaceId,
        churchName: cleanChurch,
        className: cleanClass,
        lastMessage: `تم افتتاح قناة التواصل الداخلية لفريق خدمة ${cleanClass}.`,
        lastMessageAt: nowIso,
      },
    },
    {
      type: 'set',
      ref: doc(db, 'environmentChat', wsChatId, 'messages', wsChatMsgId),
      data: {
        id: wsChatMsgId,
        channelId: wsChatId,
        senderUid: ownerUid,
        senderId: 'owner_root',
        senderName: 'إدارة المنصة',
        senderRole: 'environment_owner',
        senderWorkspaceName: cleanClass,
        text: `أهلاً بكم خدام ${cleanClass} (${cleanChurch}). هذه القناة مخصصة للتنسيق الداخلي بين أمين الفصل والخدام.`,
        createdAt: nowIso,
        isSystem: true,
      },
    },
    {
      type: 'set',
      ref: doc(db, 'environmentChat', directChatId),
      data: {
        id: directChatId,
        type: 'direct',
        title: `${cleanHeadName} — ${cleanChurch}`,
        participantUid: payload.applicantId || headUserId,
        participantUserId: headUserId,
        participantName: cleanHeadName,
        participantRole: 'head_servant',
        workspaceId,
        churchName: cleanChurch,
        className: cleanClass,
        lastMessage: `تم تدشين مساحة «${cleanClass}» وتعيين كلمة المرور المؤقتة.`,
        lastMessageAt: nowIso,
      },
    },
    {
      type: 'set',
      ref: doc(db, 'environmentChat', directChatId, 'messages', directMsgId),
      data: {
        id: directMsgId,
        channelId: directChatId,
        senderUid: ownerUid,
        senderId: 'owner_root',
        senderName: 'صاحب الـ Environment',
        senderRole: 'environment_owner',
        senderWorkspaceName: 'الإدارة المركزية للمنصة',
        text: `تم إطلاق مساحة خدمة «${cleanClass}» بنجاح. اسم المستخدم: ${cleanHeadUser}`,
        createdAt: nowIso,
        isSystem: true,
      },
    },
  ];

  if (oldApplicantLoginKey) {
    ops.push({ type: 'delete', ref: doc(db, 'loginDirectory', oldApplicantLoginKey) });
  }

  try {
    await commitBatchOps(ops);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `workspaces/${workspaceId}`);
  }

  return newWorkspace;
}

export async function toggleWorkspaceStatusInFirestore(
  workspaceId: string,
  nextStatus: WorkspaceStatus
): Promise<void> {
  try {
    await updateDoc(doc(db, 'workspaces', workspaceId), {
      status: nextStatus,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `workspaces/${workspaceId}`);
  }
}

export async function updateApplicantStatusInFirestore(
  applicantId: string,
  status: AccountStatus
): Promise<void> {
  const nowIso = new Date().toISOString();
  try {
    const gSnap = await getDoc(doc(db, 'globalUsers', applicantId));
    if (!gSnap.exists()) return;
    const username = String(gSnap.data().username || '');
    const ops: BatchOp[] = [
      {
        type: 'update',
        ref: doc(db, 'globalUsers', applicantId),
        data: { status, updatedAt: nowIso },
      },
    ];
    if (username) {
      ops.push({
        type: 'update',
        ref: doc(db, 'loginDirectory', toLoginKey(username)),
        data: { status, updatedAt: nowIso },
      });
    }
    await commitBatchOps(ops);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `globalUsers/${applicantId}`);
  }
}

export async function deleteWorkspaceCascadeInFirestore(workspaceId: string): Promise<void> {
  const subcollections = [
    'students',
    'servants',
    'accounts',
    'monthlySchedules',
    'visitationSchedules',
    'announcements',
    'changeRequests',
    'servantLogs',
    'members',
  ];

  const ops: BatchOp[] = [];
  try {
    for (const sub of subcollections) {
      const snap = await getDocs(collection(db, 'workspaces', workspaceId, sub));
      snap.docs.forEach((d) => ops.push({ type: 'delete', ref: d.ref }));
    }

    const usersSnap = await getDocs(
      query(collection(db, 'globalUsers'), where('workspaceId', '==', workspaceId))
    );
    for (const uDoc of usersSnap.docs) {
      const uData = uDoc.data();
      const username = String(uData.username || '');
      if (username) {
        ops.push({ type: 'delete', ref: doc(db, 'loginDirectory', toLoginKey(username)) });
      }
      ops.push({ type: 'delete', ref: doc(db, 'globalUsers', uDoc.id, 'private', 'info') });
      ops.push({ type: 'delete', ref: uDoc.ref });
      if (uData.role === 'head_servant') {
        const directId = `direct_${uDoc.id}`;
        const directMsgs = await getDocs(collection(db, 'environmentChat', directId, 'messages'));
        directMsgs.docs.forEach((m) => ops.push({ type: 'delete', ref: m.ref }));
        ops.push({ type: 'delete', ref: doc(db, 'environmentChat', directId) });
      }
    }

    const wsChatId = `ws_chat_${workspaceId}`;
    const wsMsgs = await getDocs(collection(db, 'environmentChat', wsChatId, 'messages'));
    wsMsgs.docs.forEach((m) => ops.push({ type: 'delete', ref: m.ref }));
    ops.push({ type: 'delete', ref: doc(db, 'environmentChat', wsChatId) });
    ops.push({ type: 'delete', ref: doc(db, 'workspaces', workspaceId) });

    await commitBatchOps(ops);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `workspaces/${workspaceId}`);
  }
}

// ============================================================================
// WORKSPACE REAL-TIME SUBSCRIPTION (BUNDLE)
// ============================================================================

export function subscribeWorkspaceBundle(
  workspaceId: string,
  currentUser: SessionUser,
  onBundle: (bundle: WorkspaceBundle) => void,
  onError: (message: string) => void
): Unsubscribe {
  const isStudent = currentUser.role === 'student';
  const isAdmin =
    currentUser.role === 'environment_owner' ||
    currentUser.role === 'head_servant' ||
    currentUser.role === 'assistant_head';

  let currentWorkspace: Workspace | null = null;
  let students: Student[] = [];
  let servants: Servant[] = [];
  let accounts: WorkspaceAccount[] = [];
  let monthlySchedules: MonthlySchedule[] = [];
  let visitationSchedules: VisitationRecord[] = [];
  let announcements: Announcement[] = [];
  let changeRequests: ChangeRequest[] = [];
  let servantLogs: ServantLog[] = [];

  const emitIfReady = () => {
    if (!currentWorkspace) return;
    onBundle({
      workspace: currentWorkspace,
      students,
      servants,
      accounts,
      monthlySchedules,
      visitationSchedules,
      announcements,
      changeRequests,
      servantLogs,
    });
  };

  const unsubs: Unsubscribe[] = [];

  unsubs.push(
    onSnapshot(
      doc(db, 'workspaces', workspaceId),
      (snap) => {
        if (!snap.exists()) {
          onError('مساحة الخدمة غير موجودة أو تم حذفها.');
          return;
        }
        currentWorkspace = snap.data() as Workspace;
        emitIfReady();
      },
      (err) => {
        onError('تعذر مزامنة بيانات الفصل.');
        handleFirestoreError(err, OperationType.GET, `workspaces/${workspaceId}`);
      }
    )
  );

  unsubs.push(
    onSnapshot(
      collection(db, 'workspaces', workspaceId, 'servants'),
      (snap) => {
        servants = snap.docs.map((d) => d.data() as Servant);
        emitIfReady();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `workspaces/${workspaceId}/servants`)
    )
  );

  unsubs.push(
    onSnapshot(
      collection(db, 'workspaces', workspaceId, 'monthlySchedules'),
      (snap) => {
        monthlySchedules = snap.docs
          .map((d) => d.data() as MonthlySchedule)
          .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        emitIfReady();
      },
      (err) =>
        handleFirestoreError(err, OperationType.LIST, `workspaces/${workspaceId}/monthlySchedules`)
    )
  );

  const annQuery = isStudent
    ? query(
        collection(db, 'workspaces', workspaceId, 'announcements'),
        where('target', 'in', ['all', 'students_only'])
      )
    : collection(db, 'workspaces', workspaceId, 'announcements');

  unsubs.push(
    onSnapshot(
      annQuery,
      (snap) => {
        announcements = snap.docs
          .map((d) => d.data() as Announcement)
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        emitIfReady();
      },
      (err) =>
        handleFirestoreError(err, OperationType.LIST, `workspaces/${workspaceId}/announcements`)
    )
  );

  if (isStudent && currentUser.linkedProfileId) {
    unsubs.push(
      onSnapshot(
        doc(db, 'workspaces', workspaceId, 'students', currentUser.linkedProfileId),
        (snap) => {
          students = snap.exists() ? [snap.data() as Student] : [];
          emitIfReady();
        },
        (err) =>
          handleFirestoreError(
            err,
            OperationType.GET,
            `workspaces/${workspaceId}/students/${currentUser.linkedProfileId}`
          )
      )
    );
    unsubs.push(
      onSnapshot(
        query(
          collection(db, 'workspaces', workspaceId, 'changeRequests'),
          where('studentId', '==', currentUser.linkedProfileId)
        ),
        (snap) => {
          changeRequests = snap.docs
            .map((d) => d.data() as ChangeRequest)
            .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
          emitIfReady();
        },
        (err) =>
          handleFirestoreError(err, OperationType.LIST, `workspaces/${workspaceId}/changeRequests`)
      )
    );
  } else {
    unsubs.push(
      onSnapshot(
        collection(db, 'workspaces', workspaceId, 'students'),
        (snap) => {
          students = snap.docs
            .map((d) => d.data() as Student)
            .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar'));
          emitIfReady();
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `workspaces/${workspaceId}/students`)
      )
    );
    unsubs.push(
      onSnapshot(
        collection(db, 'workspaces', workspaceId, 'visitationSchedules'),
        (snap) => {
          visitationSchedules = snap.docs.map((d) => d.data() as VisitationRecord);
          emitIfReady();
        },
        (err) =>
          handleFirestoreError(
            err,
            OperationType.LIST,
            `workspaces/${workspaceId}/visitationSchedules`
          )
      )
    );
    unsubs.push(
      onSnapshot(
        collection(db, 'workspaces', workspaceId, 'changeRequests'),
        (snap) => {
          changeRequests = snap.docs
            .map((d) => d.data() as ChangeRequest)
            .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
          emitIfReady();
        },
        (err) =>
          handleFirestoreError(err, OperationType.LIST, `workspaces/${workspaceId}/changeRequests`)
      )
    );
  }

  if (isAdmin) {
    unsubs.push(
      onSnapshot(
        collection(db, 'workspaces', workspaceId, 'accounts'),
        (snap) => {
          accounts = snap.docs.map((d) => d.data() as WorkspaceAccount);
          emitIfReady();
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `workspaces/${workspaceId}/accounts`)
      )
    );
    unsubs.push(
      onSnapshot(
        collection(db, 'workspaces', workspaceId, 'servantLogs'),
        (snap) => {
          servantLogs = snap.docs
            .map((d) => d.data() as ServantLog)
            .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
          emitIfReady();
        },
        (err) =>
          handleFirestoreError(err, OperationType.LIST, `workspaces/${workspaceId}/servantLogs`)
      )
    );
  }

  return () => {
    for (const u of unsubs) u();
  };
}

// ============================================================================
// STUDENTS, ATTENDANCE, POINTS & ANNOUNCEMENTS
// ============================================================================

export async function recordBulkAttendanceInFirestore(
  workspaceId: string,
  date: string,
  sessionType: 'mass' | 'sunday_school',
  records: Array<{ studentId: string; status: 'present' | 'absent' }>,
  recordedBy: string,
  currentStudents: Student[]
): Promise<void> {
  const nowIso = new Date().toISOString();
  const byId = new Map(currentStudents.map((s) => [s.id, s]));
  const ops: BatchOp[] = [];

  for (const rec of records) {
    const stu = byId.get(rec.studentId);
    if (!stu) continue;
    const filtered = stu.attendanceHistory.filter(
      (a) => !(a.date === date && a.sessionType === sessionType)
    );
    const nextHistory: AttendanceRecord[] = [
      ...filtered,
      { date, sessionType, status: rec.status, recordedBy },
    ].slice(-200);
    const presentCount = nextHistory.filter((a) => a.status === 'present').length;
    const attendanceRate =
      nextHistory.length > 0 ? Math.round((presentCount / nextHistory.length) * 100) : 100;
    ops.push({
      type: 'update',
      ref: doc(db, 'workspaces', workspaceId, 'students', stu.id),
      data: {
        attendanceHistory: nextHistory,
        evaluations: { ...stu.evaluations, attendanceRate },
        updatedAt: nowIso,
      },
    });
  }

  try {
    await commitBatchOps(ops);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `workspaces/${workspaceId}/students`);
  }
}

export async function recordBulkPointsInFirestore(
  workspaceId: string,
  studentIds: string[],
  amount: number,
  mode: 'bonus' | 'penalty',
  reason: string,
  recordedBy: string,
  currentStudents: Student[]
): Promise<void> {
  const delta = mode === 'penalty' ? -Math.abs(amount) : Math.abs(amount);
  const nowIso = new Date().toISOString();
  const dateStr = nowIso.slice(0, 10);
  const byId = new Map(currentStudents.map((s) => [s.id, s]));
  const ops: BatchOp[] = [];

  for (const id of studentIds) {
    const stu = byId.get(id);
    if (!stu) continue;
    const nextPoints = Math.max(0, (stu.points || 0) + delta);
    const nextHistory = [
      {
        id: sanitizeId('pt'),
        amount: delta,
        reason,
        date: dateStr,
        recordedBy,
      },
      ...(stu.pointsHistory || []),
    ].slice(0, 200);
    ops.push({
      type: 'update',
      ref: doc(db, 'workspaces', workspaceId, 'students', stu.id),
      data: {
        points: nextPoints,
        pointsHistory: nextHistory,
        updatedAt: nowIso,
      },
    });
  }

  try {
    await commitBatchOps(ops);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `workspaces/${workspaceId}/students`);
  }
}

export async function createAnnouncementInFirestore(
  workspaceId: string,
  data: { title: string; body: string; target: AnnouncementTarget; isUrgent: boolean },
  currentUser: SessionUser
): Promise<void> {
  const id = sanitizeId('ann');
  const nowIso = new Date().toISOString();
  const roleLabel =
    currentUser.role === 'head_servant'
      ? 'أمين الفصل'
      : currentUser.role === 'assistant_head'
      ? 'الأمين المساعد'
      : currentUser.role === 'environment_owner'
      ? 'إدارة المنصة'
      : 'خادم';

  const announcement: Announcement = {
    id,
    workspaceId,
    title: data.title.trim(),
    body: data.body.trim(),
    target: data.target,
    isUrgent: Boolean(data.isUrgent),
    authorName: currentUser.fullName,
    authorRole: roleLabel,
    createdAt: nowIso,
  };

  try {
    await setDoc(doc(db, 'workspaces', workspaceId, 'announcements', id), announcement);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `workspaces/${workspaceId}/announcements/${id}`);
  }
}

export async function deleteAnnouncementInFirestore(
  workspaceId: string,
  announcementId: string
): Promise<void> {
  try {
    await deleteDoc(doc(db, 'workspaces', workspaceId, 'announcements', announcementId));
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.DELETE,
      `workspaces/${workspaceId}/announcements/${announcementId}`
    );
  }
}

export async function addStudentInFirestore(
  workspaceId: string,
  form: {
    fullName: string;
    grade: string;
    gender: Gender;
    birthDate: string;
    phone: string;
    parentPhone: string;
    address: string;
    username: string;
    tempPassword: string;
  },
  workspace: Workspace
): Promise<void> {
  const cleanName = form.fullName.trim();
  const cleanUser = form.username.trim();
  const cleanPass = String(form.tempPassword || '123456').trim();
  if (!cleanName || !cleanUser || cleanPass.length < 4) {
    throw new Error('يرجى إدخال اسم المخدوم واسم المستخدم وكلمة مرور (4 أحرف فأكثر).');
  }

  const loginKey = toLoginKey(cleanUser);
  try {
    const dirSnap = await getDoc(doc(db, 'loginDirectory', loginKey));
    if (dirSnap.exists()) {
      throw new Error('اسم المستخدم مسجل مسبقاً.');
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('مسجل مسبقاً')) throw err;
    handleFirestoreError(err, OperationType.GET, `loginDirectory/${loginKey}`);
  }

  const nowIso = new Date().toISOString();
  const stuId = sanitizeId('stu');
  const userId = `usr_${stuId}`;
  const phoneForReset = form.parentPhone.trim() || form.phone.trim();
  const creds = await computeCredentialHashes(cleanPass, userId, phoneForReset);

  const student: Student = {
    id: stuId,
    workspaceId,
    fullName: cleanName,
    grade: form.grade || workspace.grades?.[0] || 'المرحلة الأولى',
    gender: form.gender || 'ذكر',
    birthDate: form.birthDate.trim(),
    phone: form.phone.trim(),
    parentPhone: form.parentPhone.trim(),
    address: form.address.trim(),
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

  const account: WorkspaceAccount = {
    id: `acc_${stuId}`,
    workspaceId,
    username: cleanUser,
    role: 'student',
    fullName: cleanName,
    phone: phoneForReset,
    linkedProfileId: stuId,
    mustChangePassword: true,
    isActive: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const ops: BatchOp[] = [
    { type: 'set', ref: doc(db, 'workspaces', workspaceId, 'students', stuId), data: { ...student } },
    { type: 'set', ref: doc(db, 'workspaces', workspaceId, 'accounts', account.id), data: { ...account } },
    {
      type: 'set',
      ref: doc(db, 'globalUsers', userId),
      data: {
        id: userId,
        username: cleanUser,
        role: 'student',
        workspaceId,
        fullName: cleanName,
        status: 'active',
        mustChangePassword: true,
        linkedProfileId: stuId,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    },
    {
      type: 'set',
      ref: doc(db, 'globalUsers', userId, 'private', 'info'),
      data: {
        userId,
        phone: phoneForReset,
        passwordHash: creds.passwordHash,
        salt: creds.salt,
        mustChangePassword: true,
        linkedProfileId: stuId,
      },
    },
    {
      type: 'set',
      ref: doc(db, 'loginDirectory', loginKey),
      data: {
        loginKey,
        userId,
        username: cleanUser,
        role: 'student',
        workspaceId,
        fullName: cleanName,
        status: 'active',
        mustChangePassword: true,
        linkedProfileId: stuId,
        salt: creds.salt,
        passwordHash: creds.passwordHash,
        claimVerifier: creds.claimVerifier,
        phoneProofVerifier: creds.phoneProofVerifier,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    },
    {
      type: 'update',
      ref: doc(db, 'workspaces', workspaceId),
      data: { studentCount: increment(1), updatedAt: nowIso },
    },
  ];

  try {
    await commitBatchOps(ops);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `workspaces/${workspaceId}/students/${stuId}`);
  }
}

export async function importStudentsInFirestore(
  workspaceId: string,
  rows: ImportedStudentRow[],
  workspace: Workspace,
  existingStudents: Student[]
): Promise<{ importedCount: number; skippedCount: number }> {
  const existingNames = new Set(existingStudents.map((s) => s.fullName.trim().toLowerCase()));
  const existingUsers = new Set(existingStudents.map((s) => s.username.trim()));
  const defaultGrade = workspace.grades?.[0] || 'المرحلة الأولى';
  const nowIso = new Date().toISOString();

  let importedCount = 0;
  let skippedCount = 0;
  const ops: BatchOp[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cleanName = row.fullName.trim();
    if (cleanName.length < 2 || existingNames.has(cleanName.toLowerCase())) {
      skippedCount++;
      continue;
    }
    let cleanUser = (row.username || '').trim();
    if (!cleanUser) {
      cleanUser = `stu_${Date.now().toString(36)}_${i + 1}`;
    }
    if (existingUsers.has(cleanUser)) {
      skippedCount++;
      continue;
    }

    const loginKey = toLoginKey(cleanUser);
    try {
      const dirSnap = await getDoc(doc(db, 'loginDirectory', loginKey));
      if (dirSnap.exists()) {
        skippedCount++;
        continue;
      }
    } catch {
      skippedCount++;
      continue;
    }

    existingNames.add(cleanName.toLowerCase());
    existingUsers.add(cleanUser);

    const stuId = sanitizeId('stu');
    const userId = `usr_${stuId}`;
    const phoneForReset = (row.parentPhone || row.phone || '').trim();
    const pass = (row.tempPassword || '123456').trim();
    const creds = await computeCredentialHashes(pass.length >= 4 ? pass : '123456', userId, phoneForReset);

    const student: Student = {
      id: stuId,
      workspaceId,
      fullName: cleanName,
      grade: row.grade.trim() || defaultGrade,
      gender: row.gender || 'ذكر',
      birthDate: row.birthDate.trim(),
      phone: row.phone.trim(),
      parentPhone: row.parentPhone.trim(),
      address: row.address.trim(),
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

    const account: WorkspaceAccount = {
      id: `acc_${stuId}`,
      workspaceId,
      username: cleanUser,
      role: 'student',
      fullName: cleanName,
      phone: phoneForReset,
      linkedProfileId: stuId,
      mustChangePassword: true,
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    ops.push({ type: 'set', ref: doc(db, 'workspaces', workspaceId, 'students', stuId), data: { ...student } });
    ops.push({ type: 'set', ref: doc(db, 'workspaces', workspaceId, 'accounts', account.id), data: { ...account } });
    ops.push({
      type: 'set',
      ref: doc(db, 'globalUsers', userId),
      data: {
        id: userId,
        username: cleanUser,
        role: 'student',
        workspaceId,
        fullName: cleanName,
        status: 'active',
        mustChangePassword: true,
        linkedProfileId: stuId,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    });
    ops.push({
      type: 'set',
      ref: doc(db, 'globalUsers', userId, 'private', 'info'),
      data: {
        userId,
        phone: phoneForReset,
        passwordHash: creds.passwordHash,
        salt: creds.salt,
        mustChangePassword: true,
        linkedProfileId: stuId,
      },
    });
    ops.push({
      type: 'set',
      ref: doc(db, 'loginDirectory', loginKey),
      data: {
        loginKey,
        userId,
        username: cleanUser,
        role: 'student',
        workspaceId,
        fullName: cleanName,
        status: 'active',
        mustChangePassword: true,
        linkedProfileId: stuId,
        salt: creds.salt,
        passwordHash: creds.passwordHash,
        claimVerifier: creds.claimVerifier,
        phoneProofVerifier: creds.phoneProofVerifier,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    });
    importedCount++;
  }

  if (importedCount > 0) {
    ops.push({
      type: 'update',
      ref: doc(db, 'workspaces', workspaceId),
      data: { studentCount: increment(importedCount), updatedAt: nowIso },
    });
    try {
      await commitBatchOps(ops);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `workspaces/${workspaceId}/students`);
    }
  }

  return { importedCount, skippedCount };
}

export async function updateStudentInFirestore(
  workspaceId: string,
  student: Student
): Promise<void> {
  const nowIso = new Date().toISOString();
  const payload = stripUndefined({
    fullName: student.fullName.trim(),
    grade: student.grade,
    gender: student.gender,
    birthDate: student.birthDate,
    phone: student.phone,
    parentPhone: student.parentPhone,
    address: student.address,
    avatarUrl: student.avatarUrl,
    points: student.points,
    badges: student.badges,
    evaluations: student.evaluations,
    attendanceHistory: student.attendanceHistory,
    pointsHistory: student.pointsHistory,
    username: student.username,
    updatedAt: nowIso,
  });

  try {
    await updateDoc(doc(db, 'workspaces', workspaceId, 'students', student.id), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `workspaces/${workspaceId}/students/${student.id}`);
  }
}

export async function deleteStudentInFirestore(
  workspaceId: string,
  student: Student,
  currentTotalStudents: number,
  visitations: VisitationRecord[]
): Promise<void> {
  const nowIso = new Date().toISOString();
  const userId = `usr_${student.id}`;
  const ops: BatchOp[] = [
    { type: 'delete', ref: doc(db, 'workspaces', workspaceId, 'students', student.id) },
    { type: 'delete', ref: doc(db, 'workspaces', workspaceId, 'accounts', `acc_${student.id}`) },
    { type: 'delete', ref: doc(db, 'globalUsers', userId, 'private', 'info') },
    { type: 'delete', ref: doc(db, 'globalUsers', userId) },
    {
      type: 'update',
      ref: doc(db, 'workspaces', workspaceId),
      data: { studentCount: Math.max(0, currentTotalStudents - 1), updatedAt: nowIso },
    },
  ];
  if (student.username) {
    ops.push({ type: 'delete', ref: doc(db, 'loginDirectory', toLoginKey(student.username)) });
  }
  for (const vis of visitations) {
    if (vis.studentId === student.id) {
      ops.push({ type: 'delete', ref: doc(db, 'workspaces', workspaceId, 'visitationSchedules', vis.id) });
    }
  }

  try {
    await commitBatchOps(ops);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `workspaces/${workspaceId}/students/${student.id}`);
  }
}

export async function runBatchStudentsActionInFirestore(
  workspaceId: string,
  action: 'promote_grade' | 'delete_grade' | 'reset_points',
  fromGrade: string,
  toGrade: string,
  confirmKeyword: string,
  students: Student[],
  visitations: VisitationRecord[]
): Promise<void> {
  const nowIso = new Date().toISOString();
  const ops: BatchOp[] = [];

  if (action === 'promote_grade') {
    if (!fromGrade || !toGrade) throw new Error('يرجى تحديد المرحلة الحالية والمرحلة المستهدفة.');
    for (const s of students) {
      if (s.grade === fromGrade) {
        ops.push({
          type: 'update',
          ref: doc(db, 'workspaces', workspaceId, 'students', s.id),
          data: { grade: toGrade, updatedAt: nowIso },
        });
      }
    }
  } else if (action === 'delete_grade') {
    if (!fromGrade) throw new Error('يرجى تحديد المرحلة المراد حذفها.');
    if (confirmKeyword !== 'تأكيد' && confirmKeyword !== 'تأكيد الحذف') {
      throw new Error('يرجى كتابة كلمة «تأكيد» للمتابعة.');
    }
    const toDelete = students.filter((s) => s.grade === fromGrade);
    for (const s of toDelete) {
      const userId = `usr_${s.id}`;
      ops.push({ type: 'delete', ref: doc(db, 'workspaces', workspaceId, 'students', s.id) });
      ops.push({ type: 'delete', ref: doc(db, 'workspaces', workspaceId, 'accounts', `acc_${s.id}`) });
      ops.push({ type: 'delete', ref: doc(db, 'globalUsers', userId, 'private', 'info') });
      ops.push({ type: 'delete', ref: doc(db, 'globalUsers', userId) });
      if (s.username) {
        ops.push({ type: 'delete', ref: doc(db, 'loginDirectory', toLoginKey(s.username)) });
      }
      for (const vis of visitations) {
        if (vis.studentId === s.id) {
          ops.push({ type: 'delete', ref: doc(db, 'workspaces', workspaceId, 'visitationSchedules', vis.id) });
        }
      }
    }
    ops.push({
      type: 'update',
      ref: doc(db, 'workspaces', workspaceId),
      data: { studentCount: Math.max(0, students.length - toDelete.length), updatedAt: nowIso },
    });
  } else if (action === 'reset_points') {
    if (confirmKeyword !== 'تأكيد' && confirmKeyword !== 'تصفير النقاط') {
      throw new Error('يرجى كتابة كلمة «تأكيد» للمتابعة.');
    }
    for (const s of students) {
      ops.push({
        type: 'update',
        ref: doc(db, 'workspaces', workspaceId, 'students', s.id),
        data: { points: 0, pointsHistory: [], updatedAt: nowIso },
      });
    }
  }

  if (ops.length === 0) return;
  try {
    await commitBatchOps(ops);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `workspaces/${workspaceId}/students`);
  }
}

// ============================================================================
// WEEKLY SCHEDULES & VISITATION BOARD
// ============================================================================

export async function saveMonthlyScheduleInFirestore(
  workspaceId: string,
  payload: Omit<MonthlySchedule, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt'> & { id?: string },
  existingSchedules: MonthlySchedule[]
): Promise<void> {
  const nowIso = new Date().toISOString();
  const existing = payload.id ? existingSchedules.find((s) => s.id === payload.id) : undefined;
  const id = existing?.id || sanitizeId('sch');

  const docData: MonthlySchedule = stripUndefined({
    id,
    workspaceId,
    date: payload.date,
    dateLabel: payload.dateLabel || formatLiveArabicDate(payload.date),
    grade: payload.grade,
    lessonTitle: payload.lessonTitle,
    memoryVerse: payload.memoryVerse || '',
    primaryTeacherId: payload.primaryTeacherId || '',
    primaryTeacherName: payload.primaryTeacherName || '',
    backupTeacherId: payload.backupTeacherId || '',
    backupTeacherName: payload.backupTeacherName || '-- بدون خادم احتياطي --',
    stageLessons: payload.stageLessons,
    segments: payload.segments,
    segmentDetails: payload.segmentDetails,
    notes: payload.notes || '',
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
  });

  try {
    await setDoc(doc(db, 'workspaces', workspaceId, 'monthlySchedules', id), docData);
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.WRITE,
      `workspaces/${workspaceId}/monthlySchedules/${id}`
    );
  }
}

export async function pruneExpiredSchedulesInFirestore(
  workspaceId: string,
  existingSchedules: MonthlySchedule[]
): Promise<number> {
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const expired = existingSchedules.filter((s) => s.date && s.date < cutoff);
  if (expired.length === 0) return 0;

  const ops: BatchOp[] = expired.map((s) => ({
    type: 'delete',
    ref: doc(db, 'workspaces', workspaceId, 'monthlySchedules', s.id),
  }));

  try {
    await commitBatchOps(ops);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `workspaces/${workspaceId}/monthlySchedules`);
  }
  return expired.length;
}

export async function swapMonthlyScheduleTeachersInFirestore(
  workspaceId: string,
  sch: MonthlySchedule,
  stageIndex = 0
): Promise<void> {
  const nowIso = new Date().toISOString();
  let nextStageLessons = sch.stageLessons ? [...sch.stageLessons] : undefined;
  let nextPrimaryId = sch.primaryTeacherId;
  let nextPrimaryName = sch.primaryTeacherName;
  let nextBackupId = sch.backupTeacherId;
  let nextBackupName = sch.backupTeacherName;

  if (nextStageLessons && nextStageLessons[stageIndex]) {
    const sl = { ...nextStageLessons[stageIndex] };
    const pId = sl.primaryTeacherId;
    const pName =
      sl.primaryTeacherId === '__custom__'
        ? sl.customPrimaryTeacherName || sl.primaryTeacherName
        : sl.primaryTeacherName;
    const bId = sl.backupTeacherId;
    const bName = sl.backupTeacherName === '-- بدون خادم احتياطي --' ? '' : sl.backupTeacherName;

    sl.primaryTeacherId = bId;
    sl.primaryTeacherName = bName;
    sl.customPrimaryTeacherName = '';
    sl.backupTeacherId = pId;
    sl.backupTeacherName = pName || '-- بدون خادم احتياطي --';
    nextStageLessons[stageIndex] = sl;

    if (stageIndex === 0) {
      nextPrimaryId = sl.primaryTeacherId;
      nextPrimaryName = sl.primaryTeacherName;
      nextBackupId = sl.backupTeacherId;
      nextBackupName = sl.backupTeacherName;
    }
  } else {
    nextPrimaryId = sch.backupTeacherId;
    nextPrimaryName = sch.backupTeacherName === '-- بدون خادم احتياطي --' ? '' : sch.backupTeacherName;
    nextBackupId = sch.primaryTeacherId;
    nextBackupName = sch.primaryTeacherName || '-- بدون خادم احتياطي --';
  }

  try {
    await updateDoc(
      doc(db, 'workspaces', workspaceId, 'monthlySchedules', sch.id),
      stripUndefined({
        primaryTeacherId: nextPrimaryId,
        primaryTeacherName: nextPrimaryName,
        backupTeacherId: nextBackupId,
        backupTeacherName: nextBackupName,
        stageLessons: nextStageLessons,
        updatedAt: nowIso,
      })
    );
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.UPDATE,
      `workspaces/${workspaceId}/monthlySchedules/${sch.id}`
    );
  }
}

export async function deleteMonthlyScheduleInFirestore(
  workspaceId: string,
  scheduleId: string
): Promise<void> {
  try {
    await deleteDoc(doc(db, 'workspaces', workspaceId, 'monthlySchedules', scheduleId));
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.DELETE,
      `workspaces/${workspaceId}/monthlySchedules/${scheduleId}`
    );
  }
}

export async function autoDistributeVisitationInFirestore(
  workspaceId: string,
  weekLabel: string,
  students: Student[],
  servants: Servant[],
  existingVisitations: VisitationRecord[]
): Promise<void> {
  if (servants.length === 0) throw new Error('لا يوجد خدام لتوزيع الافتقاد عليهم.');
  if (students.length === 0) throw new Error('لا يوجد مخدومون لتوزيعهم حالياً.');

  const nowIso = new Date().toISOString();
  const ops: BatchOp[] = existingVisitations.map((v) => ({
    type: 'delete',
    ref: doc(db, 'workspaces', workspaceId, 'visitationSchedules', v.id),
  }));

  students.forEach((stu, idx) => {
    const srv = servants[idx % servants.length];
    const id = sanitizeId('vis');
    const rec: VisitationRecord = {
      id,
      workspaceId,
      studentId: stu.id,
      studentName: stu.fullName,
      studentGrade: stu.grade,
      studentPhone: stu.phone,
      parentPhone: stu.parentPhone,
      servantId: srv.id,
      servantName: srv.fullName,
      status: 'pending',
      weekLabel,
      notes: '',
      lastUpdatedAt: nowIso,
    };
    ops.push({ type: 'set', ref: doc(db, 'workspaces', workspaceId, 'visitationSchedules', id), data: { ...rec } });
  });

  try {
    await commitBatchOps(ops);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `workspaces/${workspaceId}/visitationSchedules`);
  }
}

export async function resetVisitationStatusesInFirestore(
  workspaceId: string,
  weekLabel: string,
  existingVisitations: VisitationRecord[]
): Promise<void> {
  if (existingVisitations.length === 0) return;
  const nowIso = new Date().toISOString();
  const ops: BatchOp[] = existingVisitations.map((v) => ({
    type: 'update',
    ref: doc(db, 'workspaces', workspaceId, 'visitationSchedules', v.id),
    data: { status: 'pending', weekLabel, notes: '', lastUpdatedAt: nowIso },
  }));

  try {
    await commitBatchOps(ops);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `workspaces/${workspaceId}/visitationSchedules`);
  }
}

export async function updateVisitationInFirestore(
  workspaceId: string,
  visitId: string,
  status: VisitationStatus,
  notes?: string
): Promise<void> {
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = { status, lastUpdatedAt: nowIso };
  if (notes !== undefined) patch.notes = notes;
  try {
    await updateDoc(doc(db, 'workspaces', workspaceId, 'visitationSchedules', visitId), patch);
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.UPDATE,
      `workspaces/${workspaceId}/visitationSchedules/${visitId}`
    );
  }
}

export async function bulkAssignVisitationInFirestore(
  workspaceId: string,
  servant: Servant,
  studentIds: string[],
  weekLabel: string,
  students: Student[],
  existingVisitations: VisitationRecord[]
): Promise<void> {
  const nowIso = new Date().toISOString();
  const selectedSet = new Set(studentIds);
  const ops: BatchOp[] = [];

  for (const vis of existingVisitations) {
    if (vis.servantId === servant.id && !selectedSet.has(vis.studentId)) {
      ops.push({
        type: 'delete',
        ref: doc(db, 'workspaces', workspaceId, 'visitationSchedules', vis.id),
      });
    } else if (vis.servantId !== servant.id && selectedSet.has(vis.studentId)) {
      ops.push({
        type: 'update',
        ref: doc(db, 'workspaces', workspaceId, 'visitationSchedules', vis.id),
        data: {
          servantId: servant.id,
          servantName: servant.fullName,
          weekLabel,
          lastUpdatedAt: nowIso,
        },
      });
    }
  }

  const existingByStudentId = new Set(existingVisitations.map((v) => v.studentId));
  const studentById = new Map(students.map((s) => [s.id, s]));

  for (const stuId of studentIds) {
    if (existingByStudentId.has(stuId)) continue;
    const stu = studentById.get(stuId);
    if (!stu) continue;
    const id = sanitizeId('vis');
    const rec: VisitationRecord = {
      id,
      workspaceId,
      studentId: stu.id,
      studentName: stu.fullName,
      studentGrade: stu.grade,
      studentPhone: stu.phone,
      parentPhone: stu.parentPhone,
      servantId: servant.id,
      servantName: servant.fullName,
      status: 'pending',
      weekLabel,
      notes: '',
      lastUpdatedAt: nowIso,
    };
    ops.push({ type: 'set', ref: doc(db, 'workspaces', workspaceId, 'visitationSchedules', id), data: { ...rec } });
  }

  if (ops.length === 0) return;
  try {
    await commitBatchOps(ops);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `workspaces/${workspaceId}/visitationSchedules`);
  }
}

// ============================================================================
// LEADERSHIP, SERVANTS, CHANGE REQUESTS, SECURITY & BRANDING
// ============================================================================

export async function addServantInFirestore(
  workspaceId: string,
  form: {
    fullName: string;
    role: 'servant' | 'assistant_head';
    phone: string;
    assignedGrade: string;
    username: string;
    tempPassword: string;
    bio: string;
  },
  workspace: Workspace
): Promise<void> {
  const cleanName = form.fullName.trim();
  const cleanUser = form.username.trim();
  const cleanPhone = form.phone.trim();
  const cleanPass = String(form.tempPassword || '123456').trim();
  if (!cleanName || !cleanUser || cleanPass.length < 4) {
    throw new Error('يرجى إدخال اسم الخادم واسم المستخدم وكلمة المرور المؤقتة.');
  }

  const loginKey = toLoginKey(cleanUser);
  try {
    const dirSnap = await getDoc(doc(db, 'loginDirectory', loginKey));
    if (dirSnap.exists()) {
      throw new Error('اسم المستخدم مستخدم بالفعل.');
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('مستخدم بالفعل')) throw err;
    handleFirestoreError(err, OperationType.GET, `loginDirectory/${loginKey}`);
  }

  const nowIso = new Date().toISOString();
  const srvId = sanitizeId('srv');
  const userId = `usr_${srvId}`;
  const creds = await computeCredentialHashes(cleanPass, userId, cleanPhone);

  const servant: Servant = {
    id: srvId,
    workspaceId,
    fullName: cleanName,
    role: form.role,
    phone: cleanPhone,
    assignedGrade: form.assignedGrade.trim() || workspace.grades?.[0] || '',
    gender: 'ذكر',
    avatarUrl: '',
    username: cleanUser,
    bio: form.bio.trim(),
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const account: WorkspaceAccount = {
    id: `acc_${srvId}`,
    workspaceId,
    username: cleanUser,
    role: form.role,
    fullName: cleanName,
    phone: cleanPhone,
    linkedProfileId: srvId,
    mustChangePassword: true,
    isActive: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const ops: BatchOp[] = [
    { type: 'set', ref: doc(db, 'workspaces', workspaceId, 'servants', srvId), data: { ...servant } },
    { type: 'set', ref: doc(db, 'workspaces', workspaceId, 'accounts', account.id), data: { ...account } },
    {
      type: 'set',
      ref: doc(db, 'globalUsers', userId),
      data: {
        id: userId,
        username: cleanUser,
        role: form.role,
        workspaceId,
        fullName: cleanName,
        status: 'active',
        mustChangePassword: true,
        linkedProfileId: srvId,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    },
    {
      type: 'set',
      ref: doc(db, 'globalUsers', userId, 'private', 'info'),
      data: {
        userId,
        phone: cleanPhone,
        passwordHash: creds.passwordHash,
        salt: creds.salt,
        mustChangePassword: true,
        linkedProfileId: srvId,
      },
    },
    {
      type: 'set',
      ref: doc(db, 'loginDirectory', loginKey),
      data: {
        loginKey,
        userId,
        username: cleanUser,
        role: form.role,
        workspaceId,
        fullName: cleanName,
        status: 'active',
        mustChangePassword: true,
        linkedProfileId: srvId,
        salt: creds.salt,
        passwordHash: creds.passwordHash,
        claimVerifier: creds.claimVerifier,
        phoneProofVerifier: creds.phoneProofVerifier,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    },
    {
      type: 'update',
      ref: doc(db, 'workspaces', workspaceId),
      data: { servantCount: increment(1), updatedAt: nowIso },
    },
  ];

  try {
    await commitBatchOps(ops);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `workspaces/${workspaceId}/servants/${srvId}`);
  }
}

export async function updateServantInFirestore(
  workspaceId: string,
  servant: Servant,
  actor: SessionUser,
  isAdmin: boolean
): Promise<void> {
  const nowIso = new Date().toISOString();
  const logId = sanitizeId('log');
  const patch: Record<string, unknown> = {
    fullName: servant.fullName.trim(),
    phone: servant.phone.trim(),
    avatarUrl: servant.avatarUrl || '',
    bio: servant.bio.trim(),
    updatedAt: nowIso,
  };
  if (isAdmin) {
    patch.assignedGrade = servant.assignedGrade.trim();
    patch.role = servant.role;
  }

  const log: ServantLog = {
    id: logId,
    workspaceId,
    servantId: servant.id,
    servantName: servant.fullName,
    action:
      isAdmin && actor.linkedProfileId !== servant.id
        ? 'تحديث إداري لملف خادم'
        : 'تحديث الملف الشخصي للخادم',
    details: `قام ${actor.fullName} بتحديث بيانات ملف ${servant.fullName}.`,
    createdAt: nowIso,
  };

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'workspaces', workspaceId, 'servants', servant.id), patch);
    batch.set(doc(db, 'workspaces', workspaceId, 'servantLogs', logId), log);
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `workspaces/${workspaceId}/servants/${servant.id}`);
  }
}

export async function resetWorkspaceAccountPasswordInFirestore(
  workspaceId: string,
  account: WorkspaceAccount,
  tempPassword: string
): Promise<void> {
  const cleanPass = tempPassword.trim();
  if (cleanPass.length < 4) {
    throw new Error('كلمة المرور المؤقتة يجب أن لا تقل عن 4 أحرف.');
  }

  const loginKey = toLoginKey(account.username);
  let userId = `usr_${account.linkedProfileId}`;
  try {
    const dirSnap = await getDoc(doc(db, 'loginDirectory', loginKey));
    if (dirSnap.exists()) {
      userId = String(dirSnap.data().userId || userId);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `loginDirectory/${loginKey}`);
  }

  const nowIso = new Date().toISOString();
  const creds = await computeCredentialHashes(cleanPass, userId, account.phone || '');

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'loginDirectory', loginKey), {
      salt: creds.salt,
      passwordHash: creds.passwordHash,
      claimVerifier: creds.claimVerifier,
      phoneProofVerifier: creds.phoneProofVerifier,
      mustChangePassword: true,
      updatedAt: nowIso,
    });
    batch.update(doc(db, 'workspaces', workspaceId, 'accounts', account.id), {
      mustChangePassword: true,
      updatedAt: nowIso,
    });
    batch.update(doc(db, 'globalUsers', userId), {
      mustChangePassword: true,
      updatedAt: nowIso,
    });
    batch.update(doc(db, 'globalUsers', userId, 'private', 'info'), {
      salt: creds.salt,
      passwordHash: creds.passwordHash,
      mustChangePassword: true,
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `loginDirectory/${loginKey}`);
  }
}

export async function reviewChangeRequestInFirestore(
  workspaceId: string,
  changeRequest: ChangeRequest,
  status: 'approved' | 'rejected',
  reviewerName: string,
  student?: Student
): Promise<void> {
  const nowIso = new Date().toISOString();
  const ops: BatchOp[] = [
    {
      type: 'update',
      ref: doc(db, 'workspaces', workspaceId, 'changeRequests', changeRequest.id),
      data: {
        status,
        reviewedBy: reviewerName,
        reviewedAt: nowIso,
      },
    },
  ];

  if (status === 'approved' && student) {
    const fieldMap: Record<string, keyof Student> = {
      'الاسم الكامل': 'fullName',
      'رقم الهاتف': 'phone',
      'رقم ولي الأمر': 'parentPhone',
      'العنوان': 'address',
      'تاريخ الميلاد': 'birthDate',
    };
    const key = fieldMap[changeRequest.field];
    if (key) {
      ops.push({
        type: 'update',
        ref: doc(db, 'workspaces', workspaceId, 'students', student.id),
        data: { [key]: changeRequest.newValue, updatedAt: nowIso },
      });
    }
  }

  try {
    await commitBatchOps(ops);
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.UPDATE,
      `workspaces/${workspaceId}/changeRequests/${changeRequest.id}`
    );
  }
}

export async function submitChangeRequestInFirestore(
  workspaceId: string,
  student: Student,
  reqData: { field: string; oldValue: string; newValue: string; reason: string },
  requesterUsername: string
): Promise<void> {
  const id = sanitizeId('chg');
  const nowIso = new Date().toISOString();
  const uid = auth.currentUser?.uid || '';

  try {
    await setDoc(doc(db, 'workspaces', workspaceId, 'changeRequests', id), {
      id,
      workspaceId,
      studentId: student.id,
      studentName: student.fullName,
      ownerUid: uid,
      requestedByUsername: requesterUsername,
      field: reqData.field,
      oldValue: reqData.oldValue,
      newValue: reqData.newValue.trim(),
      reason: reqData.reason.trim(),
      status: 'pending',
      createdAt: nowIso,
    });
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.CREATE,
      `workspaces/${workspaceId}/changeRequests/${id}`
    );
  }
}

export async function updateWorkspaceSettingsInFirestore(
  workspaceId: string,
  settings: {
    churchName: string;
    className: string;
    stageConfig: string;
    grades: string[];
    stages: WorkspaceStage[];
    verse: string;
    logoUrl: string;
  }
): Promise<void> {
  const nowIso = new Date().toISOString();
  try {
    await updateDoc(doc(db, 'workspaces', workspaceId), {
      churchName: settings.churchName.trim(),
      className: settings.className.trim(),
      stageConfig: settings.stageConfig,
      grades: settings.grades,
      stages: settings.stages,
      verse: settings.verse.trim(),
      logoUrl: settings.logoUrl || '',
      updatedAt: nowIso,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `workspaces/${workspaceId}`);
  }
}

// ============================================================================
// 4-TIER REAL-TIME CHAT HUB
// ============================================================================

export function subscribeChatChannels(
  currentUser: SessionUser,
  workspaceId: string | undefined,
  onChannels: (channels: EnvironmentChatChannel[]) => void,
  onHeadServants: (headServants: HeadServantSummary[]) => void,
  onError: (err: unknown) => void
): Unsubscribe {
  const isOwner = currentUser.role === 'environment_owner';

  if (isOwner) {
    let allChannels: EnvironmentChatChannel[] = [];
    let allWorkspaces: Workspace[] = [];
    let headUsers: Record<string, unknown>[] = [];

    const emitHeadServants = () => {
      const wsMap = new Map(allWorkspaces.map((w) => [w.id, w]));
      const summaries: HeadServantSummary[] = headUsers
        .map((u) => {
          const wsId = String(u.workspaceId || '');
          const ws = wsMap.get(wsId);
          return {
            id: String(u.id || ''),
            fullName: String(u.fullName || ''),
            username: String(u.username || ''),
            phone: '',
            workspaceId: wsId,
            className: ws?.className || '',
            churchName: ws?.churchName || '',
            status: (u.status as AccountStatus) || 'active',
          };
        })
        .filter((h) => h.id && h.workspaceId);
      onHeadServants(summaries);
    };

    const u1 = onSnapshot(
      collection(db, 'environmentChat'),
      (snap) => {
        allChannels = snap.docs
          .map((d) => d.data() as EnvironmentChatChannel)
          .sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''));
        onChannels(allChannels);
      },
      (err) => {
        onError(err);
        handleFirestoreError(err, OperationType.LIST, 'environmentChat');
      }
    );

    const u2 = onSnapshot(
      collection(db, 'workspaces'),
      (snap) => {
        allWorkspaces = snap.docs.map((d) => d.data() as Workspace);
        emitHeadServants();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'workspaces')
    );

    const u3 = onSnapshot(
      query(collection(db, 'globalUsers'), where('role', '==', 'head_servant')),
      (snap) => {
        headUsers = snap.docs.map((d) => d.data() as Record<string, unknown>);
        emitHeadServants();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'globalUsers')
    );

    return () => {
      u1();
      u2();
      u3();
    };
  }

  onHeadServants([]);
  const channelMap = new Map<string, EnvironmentChatChannel>();
  const unsubs: Unsubscribe[] = [];
  const customGroupUnsubs = new Map<string, Unsubscribe>();

  const emitChannels = () => {
    const list = Array.from(channelMap.values()).sort((a, b) =>
      (b.lastMessageAt || '').localeCompare(a.lastMessageAt || '')
    );
    onChannels(list);
  };

  const watchChannelDoc = (channelId: string, storeMap = channelMap) => {
    return onSnapshot(
      doc(db, 'environmentChat', channelId),
      (snap) => {
        if (snap.exists()) {
          storeMap.set(channelId, snap.data() as EnvironmentChatChannel);
        } else {
          storeMap.delete(channelId);
        }
        emitChannels();
      },
      () => {
        // Channel might not exist yet or user was removed from group
        storeMap.delete(channelId);
        emitChannels();
      }
    );
  };

  if (currentUser.role === 'applicant') {
    unsubs.push(watchChannelDoc(`direct_${currentUser.id}`));
  } else if (currentUser.role === 'head_servant') {
    const targetWsId = workspaceId || currentUser.workspaceId;
    unsubs.push(watchChannelDoc('global_leaders'));
    unsubs.push(watchChannelDoc(`direct_${currentUser.id}`));
    if (targetWsId) {
      unsubs.push(watchChannelDoc(`ws_chat_${targetWsId}`));
      unsubs.push(
        onSnapshot(
          doc(db, 'workspaces', targetWsId),
          (wsSnap) => {
            if (!wsSnap.exists()) return;
            const ws = wsSnap.data() as Workspace;
            const groupIds = Array.isArray(ws.customGroupIds) ? ws.customGroupIds : [];
            const nextSet = new Set(groupIds);

            for (const [gid, unsub] of customGroupUnsubs.entries()) {
              if (!nextSet.has(gid)) {
                unsub();
                customGroupUnsubs.delete(gid);
                channelMap.delete(gid);
              }
            }
            for (const gid of groupIds) {
              if (!customGroupUnsubs.has(gid)) {
                customGroupUnsubs.set(gid, watchChannelDoc(gid));
              }
            }
            emitChannels();
          },
          (err) => {
            onError(err);
            handleFirestoreError(err, OperationType.GET, `workspaces/${targetWsId}`);
          }
        )
      );
    }
  } else if (currentUser.role === 'assistant_head' || currentUser.role === 'servant') {
    const targetWsId = workspaceId || currentUser.workspaceId;
    if (targetWsId) {
      unsubs.push(watchChannelDoc(`ws_chat_${targetWsId}`));
    }
  }

  return () => {
    for (const u of unsubs) u();
    for (const u of customGroupUnsubs.values()) u();
  };
}

export function subscribeChannelMessages(
  channelId: string,
  onMessages: (messages: EnvironmentChatMessage[]) => void,
  onError: (err: unknown) => void
): Unsubscribe {
  const q = query(
    collection(db, 'environmentChat', channelId, 'messages'),
    orderBy('createdAt', 'asc')
  );
  return onSnapshot(
    q,
    (snap) => {
      const msgs = snap.docs.map((d) => d.data() as EnvironmentChatMessage);
      onMessages(msgs);
    },
    (err) => {
      onError(err);
      handleFirestoreError(err, OperationType.LIST, `environmentChat/${channelId}/messages`);
    }
  );
}

export async function sendChatMessageInFirestore(
  channel: EnvironmentChatChannel,
  text: string,
  currentUser: SessionUser,
  senderWorkspaceName?: string
): Promise<void> {
  const cleanText = text.trim();
  if (!cleanText) return;
  if ((channel.id === 'global_leaders' || channel.isBroadcast) && currentUser.role !== 'environment_owner') {
    throw new Error('هذه القناة مخصصة لإشعارات وتنبيهات إدارة المنصة فقط.');
  }

  const uid = auth.currentUser?.uid || currentUser.id;
  const msgId = sanitizeId('msg');
  const nowIso = new Date().toISOString();

  const msg: EnvironmentChatMessage & { senderUid: string } = {
    id: msgId,
    channelId: channel.id,
    senderUid: uid,
    senderId: currentUser.id,
    senderName: currentUser.fullName,
    senderRole: currentUser.role,
    senderWorkspaceName:
      senderWorkspaceName ||
      (currentUser.role === 'environment_owner' ? 'الإدارة المركزية للمنصة' : ''),
    text: cleanText,
    createdAt: nowIso,
  };

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'environmentChat', channel.id, 'messages', msgId), msg);
    batch.update(doc(db, 'environmentChat', channel.id), {
      lastMessage: cleanText.slice(0, 500),
      lastMessageAt: nowIso,
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `environmentChat/${channel.id}/messages/${msgId}`);
  }
}

export async function createCustomGroupInFirestore(
  title: string,
  memberIds: string[],
  headServants: HeadServantSummary[],
  currentUser: SessionUser
): Promise<EnvironmentChatChannel> {
  const cleanTitle = title.trim();
  if (!cleanTitle) throw new Error('يرجى إدخال اسم المجموعة.');
  if (memberIds.length === 0) throw new Error('يرجى اختيار أمين فصل واحد على الأقل للمجموعة.');

  const uniqueMemberIds = Array.from(new Set(memberIds));
  const groupId = sanitizeId('ch_grp');
  const msgId = sanitizeId('msg');
  const nowIso = new Date().toISOString();
  const uid = auth.currentUser?.uid || 'owner_root';

  const channel: EnvironmentChatChannel = {
    id: groupId,
    type: 'group',
    title: cleanTitle,
    isBroadcast: false,
    isCustomGroup: true,
    memberIds: uniqueMemberIds,
    createdBy: currentUser.id,
    createdAt: nowIso,
    lastMessage: `تم إنشاء مجموعة «${cleanTitle}» (${uniqueMemberIds.length} أعضاء).`,
    lastMessageAt: nowIso,
  };

  const ops: BatchOp[] = [
    { type: 'set', ref: doc(db, 'environmentChat', groupId), data: { ...channel } },
    {
      type: 'set',
      ref: doc(db, 'environmentChat', groupId, 'messages', msgId),
      data: {
        id: msgId,
        channelId: groupId,
        senderUid: uid,
        senderId: currentUser.id,
        senderName: currentUser.fullName,
        senderRole: 'environment_owner',
        senderWorkspaceName: 'الإدارة المركزية للمنصة',
        text: `تم إنشاء مجموعة «${cleanTitle}» وإضافة أمناء الفصول المختارين.`,
        createdAt: nowIso,
        isSystem: true,
      },
    },
  ];

  const hsById = new Map(headServants.map((h) => [h.id, h]));
  for (const mId of uniqueMemberIds) {
    const hs = hsById.get(mId);
    if (hs?.workspaceId) {
      ops.push({
        type: 'update',
        ref: doc(db, 'workspaces', hs.workspaceId),
        data: { customGroupIds: arrayUnion(groupId), updatedAt: nowIso },
      });
    }
  }

  try {
    await commitBatchOps(ops);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `environmentChat/${groupId}`);
  }

  return channel;
}

export async function updateCustomGroupInFirestore(
  channel: EnvironmentChatChannel,
  updates: { title?: string; memberIds?: string[] },
  headServants: HeadServantSummary[]
): Promise<EnvironmentChatChannel> {
  const nowIso = new Date().toISOString();
  const nextTitle = updates.title !== undefined ? updates.title.trim() : channel.title;
  const prevMembers = Array.isArray(channel.memberIds) ? channel.memberIds : [];
  const nextMembers =
    updates.memberIds !== undefined ? Array.from(new Set(updates.memberIds)) : prevMembers;

  const ops: BatchOp[] = [
    {
      type: 'update',
      ref: doc(db, 'environmentChat', channel.id),
      data: {
        title: nextTitle,
        memberIds: nextMembers,
      },
    },
  ];

  if (updates.memberIds !== undefined) {
    const prevSet = new Set(prevMembers);
    const nextSet = new Set(nextMembers);
    const hsById = new Map(headServants.map((h) => [h.id, h]));

    for (const addedId of nextMembers) {
      if (!prevSet.has(addedId)) {
        const hs = hsById.get(addedId);
        if (hs?.workspaceId) {
          ops.push({
            type: 'update',
            ref: doc(db, 'workspaces', hs.workspaceId),
            data: { customGroupIds: arrayUnion(channel.id), updatedAt: nowIso },
          });
        }
      }
    }
    for (const removedId of prevMembers) {
      if (!nextSet.has(removedId)) {
        const hs = hsById.get(removedId);
        if (hs?.workspaceId) {
          ops.push({
            type: 'update',
            ref: doc(db, 'workspaces', hs.workspaceId),
            data: { customGroupIds: arrayRemove(channel.id), updatedAt: nowIso },
          });
        }
      }
    }
  }

  try {
    await commitBatchOps(ops);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `environmentChat/${channel.id}`);
  }

  return {
    ...channel,
    title: nextTitle,
    memberIds: nextMembers,
  };
}

export async function deleteCustomGroupInFirestore(
  channel: EnvironmentChatChannel,
  headServants: HeadServantSummary[]
): Promise<void> {
  const nowIso = new Date().toISOString();
  const ops: BatchOp[] = [];
  const hsById = new Map(headServants.map((h) => [h.id, h]));

  for (const mId of channel.memberIds || []) {
    const hs = hsById.get(mId);
    if (hs?.workspaceId) {
      ops.push({
        type: 'update',
        ref: doc(db, 'workspaces', hs.workspaceId),
        data: { customGroupIds: arrayRemove(channel.id), updatedAt: nowIso },
      });
    }
  }

  try {
    const msgsSnap = await getDocs(collection(db, 'environmentChat', channel.id, 'messages'));
    msgsSnap.docs.forEach((m) => ops.push({ type: 'delete', ref: m.ref }));
    ops.push({ type: 'delete', ref: doc(db, 'environmentChat', channel.id) });
    await commitBatchOps(ops);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `environmentChat/${channel.id}`);
  }
}
