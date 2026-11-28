import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  MessageCircle,
  Pencil,
  Plus,
  Search,
  Shield,
  ShieldCheck,
  Shuffle,
  Users,
  X,
} from 'lucide-react';
import type { SessionUser, Workspace, WorkspaceAccount } from '../types';
import {
  buildWhatsAppUrl,
  getWorkspaceStageNames,
  resolveLogoUrl,
} from '../utils/api';
import {
  addServantInFirestore,
  generateSecureTempPassword,
  getOwnerCredentialsInFirestore,
  type OwnerLeaderAccountItem,
  resetWorkspaceAccountPasswordInFirestore,
  subscribeOwnerLeaderAccounts,
  subscribeWorkspaceAccounts,
  updateOwnerCredentialsInFirestore,
  updateWorkspaceAccountUsernameInFirestore,
} from '../services/firestoreService';
import { AccountsSecurityPanel } from './AccountsSecurityPanel';

interface OwnerSecurityHubProps {
  currentUser: SessionUser;
  workspaces: Workspace[];
}

type SecuritySubTab = 'leaders' | 'workspaces';
type LeaderFilter = 'all' | 'head_servant' | 'assistant_head' | 'temp';

const ROLE_ARABIC: Record<string, string> = {
  head_servant: 'أمين الفصل',
  assistant_head: 'أمين مساعد',
};

export const OwnerSecurityHub: React.FC<OwnerSecurityHubProps> = ({
  currentUser,
  workspaces,
}) => {
  const [subTab, setSubTab] = useState<SecuritySubTab>('leaders');

  // Tab 1: Leaders Directory
  const [leaderItems, setLeaderItems] = useState<OwnerLeaderAccountItem[]>([]);
  const [leadersLoading, setLeadersLoading] = useState(true);
  const [leaderFilter, setLeaderFilter] = useState<LeaderFilter>('all');
  const [leaderSearch, setLeaderSearch] = useState('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  // Environment Owner Profile state
  const [ownerUsername, setOwnerUsername] = useState('owner');
  const [ownerHasPassword, setOwnerHasPassword] = useState(false);
  const [editingOwner, setEditingOwner] = useState(false);
  const [ownerUsernameInput, setOwnerUsernameInput] = useState('');
  const [ownerPasswordInput, setOwnerPasswordInput] = useState('');
  const [savingOwner, setSavingOwner] = useState(false);
  const [ownerIssuedPass, setOwnerIssuedPass] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const info = await getOwnerCredentialsInFirestore();
        setOwnerUsername(info.username);
        setOwnerHasPassword(info.hasPassword);
        setOwnerUsernameInput(info.username);
      } catch {
        // ignore
      }
    })();
  }, []);

  const handleSaveOwnerCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSavingOwner(true);
    try {
      const cleanUser = ownerUsernameInput.trim();
      const cleanPass = ownerPasswordInput.trim();
      if (!cleanUser || cleanPass.length < 4) {
        throw new Error('يرجى إدخال اسم المستخدم وكلمة مرور (4 أحرف فأكثر).');
      }
      await updateOwnerCredentialsInFirestore(cleanUser, cleanPass);
      setOwnerUsername(cleanUser);
      setOwnerHasPassword(true);
      setOwnerIssuedPass(cleanPass);
      setEditingOwner(false);
      setOwnerPasswordInput('');
      setFeedback('تم تحديث بيانات دخول صاحب المنصة وتشفير كلمة المرور بخوارزمية SHA-256 بنجاح.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحديث بيانات صاحب المنصة.');
    } finally {
      setSavingOwner(false);
    }
  };

  // Inline password reset & username edit in Tab 1
  const [resetTargetId, setResetTargetId] = useState('');
  const [tempPassInput, setTempPassInput] = useState('');
  const [savingPass, setSavingPass] = useState(false);

  const [editUserTargetId, setEditUserTargetId] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);

  const [issuedPasswords, setIssuedPasswords] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState('');

  // Add new leader modal in Tab 1
  const [showAddLeader, setShowAddLeader] = useState(false);
  const [addingLeader, setAddingLeader] = useState(false);
  const [leaderForm, setLeaderForm] = useState({
    workspaceId: workspaces[0]?.id || '',
    role: 'assistant_head' as 'head_servant' | 'assistant_head',
    fullName: '',
    phone: '',
    assignedGrade: '',
    username: '',
    tempPassword: generateSecureTempPassword(8),
  });

  // Tab 2: Workspace Accounts Browser
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(workspaces[0]?.id || '');
  const [wsSearch, setWsSearch] = useState('');
  const [wsAccounts, setWsAccounts] = useState<WorkspaceAccount[]>([]);
  const [wsAccountsLoading, setWsAccountsLoading] = useState(false);

  useEffect(() => {
    if (!selectedWorkspaceId && workspaces.length > 0) {
      setSelectedWorkspaceId(workspaces[0].id);
    } else if (selectedWorkspaceId && !workspaces.some((w) => w.id === selectedWorkspaceId)) {
      setSelectedWorkspaceId(workspaces[0]?.id || '');
    }
  }, [workspaces, selectedWorkspaceId]);

  useEffect(() => {
    setLeadersLoading(true);
    const unsub = subscribeOwnerLeaderAccounts(
      workspaces,
      (items) => {
        setLeaderItems(items);
        setLeadersLoading(false);
      },
      (err) => {
        setError(err instanceof Error ? err.message : 'تعذر تحميل حسابات أمناء الفصول.');
        setLeadersLoading(false);
      }
    );
    return () => unsub();
  }, [workspaces]);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setWsAccounts([]);
      return;
    }
    setWsAccountsLoading(true);
    const unsub = subscribeWorkspaceAccounts(
      selectedWorkspaceId,
      (list) => {
        setWsAccounts(list);
        setWsAccountsLoading(false);
      },
      (err) => {
        setError(err instanceof Error ? err.message : 'تعذر تحميل حسابات الفصل المحدد.');
        setWsAccountsLoading(false);
      }
    );
    return () => unsub();
  }, [selectedWorkspaceId]);

  const leaderStats = useMemo(() => {
    const total = leaderItems.length;
    const heads = leaderItems.filter((i) => i.account.role === 'head_servant').length;
    const assistants = leaderItems.filter((i) => i.account.role === 'assistant_head').length;
    const temp = leaderItems.filter((i) => i.account.mustChangePassword).length;
    return { total, heads, assistants, temp };
  }, [leaderItems]);

  const filteredLeaders = useMemo(() => {
    const q = leaderSearch.trim().toLowerCase();
    return leaderItems.filter(({ account, workspace }) => {
      if (leaderFilter === 'head_servant' && account.role !== 'head_servant') return false;
      if (leaderFilter === 'assistant_head' && account.role !== 'assistant_head') return false;
      if (leaderFilter === 'temp' && !account.mustChangePassword) return false;
      if (!q) return true;
      return (
        (account.fullName || '').toLowerCase().includes(q) ||
        (account.username || '').toLowerCase().includes(q) ||
        (account.phone || '').toLowerCase().includes(q) ||
        (workspace.className || '').toLowerCase().includes(q) ||
        (workspace.churchName || '').toLowerCase().includes(q)
      );
    });
  }, [leaderItems, leaderFilter, leaderSearch]);

  const filteredWorkspaces = useMemo(() => {
    const q = wsSearch.trim().toLowerCase();
    if (!q) return workspaces;
    return workspaces.filter(
      (ws) =>
        ws.className.toLowerCase().includes(q) ||
        ws.churchName.toLowerCase().includes(q) ||
        ws.headServantName.toLowerCase().includes(q)
    );
  }, [workspaces, wsSearch]);

  const selectedWorkspace = useMemo(
    () => workspaces.find((w) => w.id === selectedWorkspaceId) || null,
    [workspaces, selectedWorkspaceId]
  );

  const selectedAddLeaderWorkspace = useMemo(
    () => workspaces.find((w) => w.id === leaderForm.workspaceId) || workspaces[0] || null,
    [workspaces, leaderForm.workspaceId]
  );

  const handleOpenAddLeader = () => {
    const defaultWs = workspaces[0];
    const stageNames = defaultWs ? getWorkspaceStageNames(defaultWs) : [];
    setError('');
    setLeaderForm({
      workspaceId: defaultWs?.id || '',
      role: 'assistant_head',
      fullName: '',
      phone: '',
      assignedGrade: stageNames[0] || '',
      username: '',
      tempPassword: generateSecureTempPassword(8),
    });
    setShowAddLeader(true);
  };

  const handleCreateLeader = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetWs = workspaces.find((w) => w.id === leaderForm.workspaceId);
    if (!targetWs) {
      setError('يرجى اختيار الفصل المستهدف.');
      return;
    }
    setError('');
    setAddingLeader(true);
    try {
      const stages = getWorkspaceStageNames(targetWs);
      const createdAccountId = await addServantInFirestore(
        targetWs.id,
        {
          fullName: leaderForm.fullName,
          role: leaderForm.role,
          phone: leaderForm.phone,
          assignedGrade: leaderForm.assignedGrade || stages[0] || '',
          username: leaderForm.username,
          tempPassword: leaderForm.tempPassword,
          bio: `${ROLE_ARABIC[leaderForm.role]} — ${targetWs.className}`,
        },
        targetWs
      );
      if (createdAccountId) {
        setIssuedPasswords((prev) => ({ ...prev, [createdAccountId]: leaderForm.tempPassword }));
      }
      setShowAddLeader(false);
      setFeedback(
        `تم إنشاء حساب ${leaderForm.fullName} في «${targetWs.className}» بكلمة مرور مؤقتة مشفرة SHA-256 (${leaderForm.tempPassword}).`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء حساب الأمين.');
    } finally {
      setAddingLeader(false);
    }
  };

  const handleSaveLeaderPassword = async (item: OwnerLeaderAccountItem) => {
    const clean = tempPassInput.trim();
    if (clean.length < 4) {
      setError('كلمة المرور المؤقتة يجب أن لا تقل عن 4 أحرف.');
      return;
    }
    setError('');
    setSavingPass(true);
    try {
      await resetWorkspaceAccountPasswordInFirestore(item.workspace.id, item.account, clean);
      setIssuedPasswords((prev) => ({ ...prev, [item.account.id]: clean }));
      setResetTargetId('');
      setFeedback(
        `تم توليد وتشفير كلمة مرور مؤقتة (SHA-256) لحساب ${item.account.fullName} بنجاح.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تعيين كلمة المرور المؤقتة.');
    } finally {
      setSavingPass(false);
    }
  };

  const handleSaveLeaderUsername = async (item: OwnerLeaderAccountItem) => {
    setError('');
    setSavingUsername(true);
    try {
      await updateWorkspaceAccountUsernameInFirestore(
        item.workspace.id,
        item.account,
        usernameInput
      );
      setEditUserTargetId('');
      setFeedback(`تم تحديث اسم المستخدم لحساب ${item.account.fullName} بنجاح.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحديث اسم المستخدم.');
    } finally {
      setSavingUsername(false);
    }
  };

  const handleCopyLeaderCredentials = async (item: OwnerLeaderAccountItem) => {
    const issued = issuedPasswords[item.account.id];
    const lines = [
      `بيانات قيادة فصل ${item.workspace.className} (${item.workspace.churchName})`,
      `الاسم: ${item.account.fullName}`,
      `اسم المستخدم: ${item.account.username}`,
      issued ? `كلمة المرور المؤقتة: ${issued}` : 'حالة كلمة المرور: مشفرة (SHA-256)',
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopiedId(item.account.id);
      setTimeout(() => setCopiedId((prev) => (prev === item.account.id ? '' : prev)), 2000);
    } catch {
      setError('تعذر النسخ إلى الحافظة.');
    }
  };

  const buildLeaderWhatsAppText = (item: OwnerLeaderAccountItem): string => {
    const issued = issuedPasswords[item.account.id];
    if (issued) {
      return `سلام ونعمة ${item.account.fullName}، بيانات دخولك لإدارة فصل «${item.workspace.className}» (${item.workspace.churchName}):\nاسم المستخدم: ${item.account.username}\nكلمة المرور المؤقتة: ${issued}\n(يُرجى تغييرها عند أول تسجيل دخول)`;
    }
    return `سلام ونعمة ${item.account.fullName}، بيانات دخولك لإدارة فصل «${item.workspace.className}» (${item.workspace.churchName}):\nاسم المستخدم: ${item.account.username}`;
  };

  return (
    <section className="space-y-5">
      {/* Header & Owner Google Auth Assurance */}
      <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-extrabold text-[#2C1813] flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-[#7A1523]" />
            إدارة الحسابات والأمان المركزية
          </h1>
          <p className="text-xs text-[#755953] mt-1">
            تحكم كامل في حسابات أمناء الفصول ومساعديهم وحسابات كل فصل مع عزل Firestore التام وتشفير SHA-256
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-[#755953] bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5">
          <Shield className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>
            صلاحية المالك عبر Google Sign-In فقط:{' '}
            <strong className="font-mono text-[#2C1813]">{currentUser.email || 'Google Auth'}</strong>
          </span>
        </div>
      </div>

      {/* Two-Tab Switcher */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl w-fit">
        <button
          type="button"
          onClick={() => setSubTab('leaders')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
            subTab === 'leaders'
              ? 'bg-[#7A1523] text-white'
              : 'text-[#755953] hover:text-[#2C1813]'
          }`}
        >
          <Users className="w-4 h-4" />
          إدارة حسابات الأمناء ({leaderItems.length})
        </button>
        <button
          type="button"
          onClick={() => setSubTab('workspaces')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
            subTab === 'workspaces'
              ? 'bg-[#7A1523] text-white'
              : 'text-[#755953] hover:text-[#2C1813]'
          }`}
        >
          <Building2 className="w-4 h-4" />
          إدارة حسابات الفصول ({workspaces.length})
        </button>
      </div>

      {feedback && (
        <div className="px-4 py-3 rounded-2xl bg-[#FBF2D8] border border-[#D4AF37]/40 text-xs font-bold text-[#2C1813] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#A46714] shrink-0" />
            <span>{feedback}</span>
          </div>
          <button type="button" onClick={() => setFeedback('')} className="cursor-pointer shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="px-4 py-3 rounded-2xl bg-[#FDF2F4] border border-[#7A1523]/25 text-xs font-bold text-[#7A1523] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button type="button" onClick={() => setError('')} className="cursor-pointer shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* TAB 1: Unified Class Leaders & Assistants Directory */}
      {subTab === 'leaders' && (
        <div className="space-y-4">
          {/* Pinned Environment Owner Profile Card */}
          <div className="bg-gradient-to-l from-[#FAF6EE] to-[#FFFDF9] border border-[#D4AF37]/50 rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-[#7A1523] text-white flex items-center justify-center font-black text-lg shadow-sm">
                  👑
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-extrabold text-base sm:text-lg text-[#2C1813]">
                      حساب صاحب المنصة الرئيسي (Environment Owner)
                    </h2>
                    <span className="px-2 py-0.5 rounded-md bg-[#7A1523] text-white text-[10px] font-bold">
                      Super Admin
                    </span>
                  </div>
                  <p className="text-xs text-[#755953] font-mono mt-0.5">
                    {currentUser.email || 'jovanni.ayman@gmail.com'} · الدخول المزدوج (Google + اسم المستخدم وكلمة مرور SHA-256)
                  </p>
                </div>
              </div>

              {!editingOwner && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingOwner(true);
                    setOwnerUsernameInput(ownerUsername);
                    setOwnerPasswordInput('');
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                >
                  <KeyRound className="w-4 h-4" />
                  تعديل اسم المستخدم وكلمة المرور
                </button>
              )}
            </div>

            {!editingOwner ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-[#EAE0D5] text-xs">
                <div>
                  <span className="text-[#755953] block">اسم المستخدم المخصص للدخول:</span>
                  <strong className="text-[#2C1813] font-mono text-sm mt-0.5 block">
                    {ownerUsername}
                  </strong>
                </div>
                <div>
                  <span className="text-[#755953] block">حالة كلمة المرور المشفرة (SHA-256):</span>
                  <span
                    className={`font-bold mt-0.5 block ${
                      ownerHasPassword ? 'text-emerald-700' : 'text-[#A46714]'
                    }`}
                  >
                    {ownerHasPassword ? 'مفعلة ومشفرة بنجاح' : 'غير مسجلة (يُرجى تعيين كلمة مرور)'}
                  </span>
                  {ownerIssuedPass && (
                    <span className="text-[11px] font-mono text-[#2C1813] mt-1 block">
                      كلمة المرور المؤقتة الحالية: <strong>{ownerIssuedPass}</strong>
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <form onSubmit={handleSaveOwnerCredentials} className="space-y-4 pt-3 border-t border-[#EAE0D5]">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold mb-1">اسم المستخدم (Username)</label>
                    <input
                      type="text"
                      required
                      dir="ltr"
                      value={ownerUsernameInput}
                      onChange={(e) => setOwnerUsernameInput(e.target.value)}
                      placeholder="owner"
                      className="w-full bg-[#FFFDF9] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm font-mono text-left focus:outline-none focus:border-[#7A1523]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">كلمة المرور الجديدة (SHA-256)</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        required
                        minLength={4}
                        dir="ltr"
                        value={ownerPasswordInput}
                        onChange={(e) => setOwnerPasswordInput(e.target.value)}
                        placeholder="أدخل كلمة مرور قوية"
                        className="w-full bg-[#FFFDF9] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm font-mono text-left focus:outline-none focus:border-[#7A1523]"
                      />
                      <button
                        type="button"
                        onClick={() => setOwnerPasswordInput(generateSecureTempPassword(10))}
                        className="p-2.5 rounded-xl border border-[#EAE0D5] bg-[#FFFDF9] hover:bg-[#FAF6EE] text-[#A46714] cursor-pointer shrink-0"
                        title="توليد كلمة مرور قوية"
                      >
                        <Shuffle className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingOwner(false)}
                    className="px-4 py-2 rounded-xl border border-[#EAE0D5] text-xs font-bold text-[#755953] cursor-pointer"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={savingOwner}
                    className="px-5 py-2 rounded-xl bg-[#7A1523] text-white text-xs font-bold cursor-pointer"
                  >
                    {savingOwner ? 'جاري الحفظ والتشفير...' : 'حفظ وتشفير (SHA-256)'}
                  </button>
                </div>
              </form>
            )}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-4">
              <p className="text-xs font-semibold text-[#755953]">إجمالي حسابات القيادة</p>
              <p className="text-2xl font-black font-mono tabular-nums text-[#2C1813] mt-1">
                {leaderStats.total}
              </p>
            </div>
            <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-4">
              <p className="text-xs font-semibold text-[#755953]">أمناء الفصول</p>
              <p className="text-2xl font-black font-mono tabular-nums text-[#7A1523] mt-1">
                {leaderStats.heads}
              </p>
            </div>
            <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-4">
              <p className="text-xs font-semibold text-[#755953]">مساعدو الأمناء</p>
              <p className="text-2xl font-black font-mono tabular-nums text-[#2C1813] mt-1">
                {leaderStats.assistants}
              </p>
            </div>
            <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-4">
              <p className="text-xs font-semibold text-[#755953]">كلمات مؤقتة لم تُغيّر</p>
              <p className="text-2xl font-black font-mono tabular-nums text-[#A46714] mt-1">
                {leaderStats.temp}
              </p>
            </div>
          </div>

          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#EAE0D5] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <h2 className="font-extrabold text-base text-[#2C1813]">
                  دليل حسابات أمناء الفصول ومساعديهم
                </h2>
                <p className="text-xs text-[#755953] mt-0.5">
                  تعديل أسماء المستخدمين، إضافة قيادات جديدة، وتوليد كلمات مرور مؤقتة مشفرة SHA-256 مع إرسال واتساب
                </p>
              </div>
              {workspaces.length > 0 && (
                <button
                  type="button"
                  onClick={handleOpenAddLeader}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  إضافة أمين / مساعد
                </button>
              )}
            </div>

            <div className="px-5 py-3.5 bg-[#FAF6EE]/70 border-b border-[#EAE0D5] flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1 p-1 bg-[#FFFDF9] border border-[#EAE0D5] rounded-xl w-fit">
                {[
                  { key: 'all', label: `الكل (${leaderStats.total})` },
                  { key: 'head_servant', label: `أمناء الفصول (${leaderStats.heads})` },
                  { key: 'assistant_head', label: `المساعدون (${leaderStats.assistants})` },
                  { key: 'temp', label: `كلمات مؤقتة (${leaderStats.temp})` },
                ].map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setLeaderFilter(f.key as LeaderFilter)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap transition-colors ${
                      leaderFilter === f.key
                        ? 'bg-[#7A1523] text-white'
                        : 'text-[#755953] hover:text-[#2C1813]'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div className="relative w-full md:w-80">
                <Search className="w-4 h-4 text-[#755953] absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={leaderSearch}
                  onChange={(e) => setLeaderSearch(e.target.value)}
                  placeholder="ابحث بالاسم أو الفصل أو اسم المستخدم أو الهاتف..."
                  className="w-full bg-[#FFFDF9] border border-[#EAE0D5] focus:border-[#7A1523] focus:outline-none rounded-xl pr-9 pl-3 py-2 text-xs"
                />
              </div>
            </div>

            {leadersLoading ? (
              <div className="p-8 space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 bg-[#FAF6EE] rounded-xl animate-pulse" />
                ))}
              </div>
            ) : workspaces.length === 0 ? (
              <div className="p-12 text-center text-sm text-[#755953]">
                لا توجد فصول منشأة بعد. أنشئ فصلاً جديداً لإدارة حسابات أمنائه من هنا.
              </div>
            ) : filteredLeaders.length === 0 ? (
              <div className="p-12 text-center text-sm text-[#755953]">
                لا توجد حسابات أمناء مطابقة للبحث أو التصفية.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <thead className="bg-[#FAF6EE] border-b border-[#EAE0D5] text-xs text-[#755953]">
                    <tr>
                      <th className="py-3 px-4 font-bold">الاسم والهاتف</th>
                      <th className="py-3 px-4 font-bold">الفصل والكنيسة</th>
                      <th className="py-3 px-4 font-bold">الدور</th>
                      <th className="py-3 px-4 font-bold">اسم المستخدم</th>
                      <th className="py-3 px-4 font-bold">حالة كلمة المرور</th>
                      <th className="py-3 px-4 font-bold text-left">إجراءات الأمان</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAE0D5]">
                    {filteredLeaders.map((item) => {
                      const { account, workspace } = item;
                      const issued = issuedPasswords[account.id];
                      return (
                        <tr key={`${workspace.id}_${account.id}`} className="hover:bg-[#FAF6EE]/40">
                          <td className="py-3.5 px-4">
                            <div className="font-bold text-[#2C1813]">{account.fullName}</div>
                            {account.phone && (
                              <div className="text-xs font-mono tabular-nums text-[#755953] mt-0.5">
                                {account.phone}
                              </div>
                            )}
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="font-bold text-xs text-[#2C1813]">
                              {workspace.className}
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedWorkspaceId(workspace.id);
                                setSubTab('workspaces');
                              }}
                              className="text-[11px] text-[#7A1523] hover:underline cursor-pointer mt-0.5"
                            >
                              {workspace.churchName} · فتح حسابات الفصل
                            </button>
                          </td>
                          <td className="py-3.5 px-4 text-xs font-semibold text-[#A46714]">
                            {ROLE_ARABIC[account.role] || account.role}
                          </td>
                          <td className="py-3.5 px-4">
                            {editUserTargetId === account.id ? (
                              <div className="inline-flex items-center gap-1.5">
                                <input
                                  type="text"
                                  dir="ltr"
                                  value={usernameInput}
                                  onChange={(e) => setUsernameInput(e.target.value)}
                                  className="w-32 bg-[#FAF6EE] border border-[#7A1523]/40 rounded-lg px-2 py-1 text-xs font-mono text-left focus:outline-none"
                                />
                                <button
                                  type="button"
                                  disabled={savingUsername}
                                  onClick={() => void handleSaveLeaderUsername(item)}
                                  className="px-2.5 py-1 rounded-lg bg-[#7A1523] text-white text-xs font-bold cursor-pointer"
                                >
                                  {savingUsername ? '...' : 'حفظ'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditUserTargetId('')}
                                  className="px-2 py-1 text-xs text-[#755953] cursor-pointer"
                                >
                                  إلغاء
                                </button>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-2">
                                <span className="text-xs font-mono text-[#2C1813]">
                                  {account.username}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setError('');
                                    setResetTargetId('');
                                    setEditUserTargetId(account.id);
                                    setUsernameInput(account.username);
                                  }}
                                  className="p-1 rounded-lg text-[#755953] hover:text-[#7A1523] hover:bg-[#FAF6EE] cursor-pointer"
                                  title="تعديل اسم المستخدم"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-xs">
                            {account.mustChangePassword ? (
                              <div>
                                <span className="font-bold text-[#A46714]">كلمة مؤقتة لم تُغيّر</span>
                                {issued && (
                                  <div className="font-mono text-[11px] text-[#2C1813] mt-0.5">
                                    المؤقتة: <strong>{issued}</strong>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="font-bold text-emerald-700">
                                كلمة دائمة مشفرة SHA-256
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-left">
                            {resetTargetId === account.id ? (
                              <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                                <input
                                  type="text"
                                  dir="ltr"
                                  value={tempPassInput}
                                  onChange={(e) => setTempPassInput(e.target.value)}
                                  className="w-28 bg-[#FAF6EE] border border-[#EAE0D5] rounded-lg px-2 py-1 text-xs font-mono text-left"
                                />
                                <button
                                  type="button"
                                  onClick={() => setTempPassInput(generateSecureTempPassword(8))}
                                  className="p-1.5 rounded-lg border border-[#EAE0D5] bg-[#FFFDF9] hover:bg-[#FAF6EE] text-[#A46714] cursor-pointer"
                                  title="توليد كلمة مرور عشوائية"
                                >
                                  <Shuffle className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={savingPass}
                                  onClick={() => void handleSaveLeaderPassword(item)}
                                  className="px-3 py-1 rounded-lg bg-[#7A1523] text-white text-xs font-bold cursor-pointer"
                                >
                                  {savingPass ? 'جاري...' : 'تشفير وحفظ'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setResetTargetId('')}
                                  className="px-2 py-1 text-xs text-[#755953] cursor-pointer"
                                >
                                  إلغاء
                                </button>
                              </div>
                            ) : (
                              <div className="inline-flex flex-wrap items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setError('');
                                    setEditUserTargetId('');
                                    setResetTargetId(account.id);
                                    setTempPassInput(generateSecureTempPassword(8));
                                  }}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-[#EAE0D5] hover:bg-[#FAF6EE] text-xs font-bold text-[#2C1813] cursor-pointer"
                                >
                                  <KeyRound className="w-3.5 h-3.5 text-[#7A1523]" />
                                  كلمة مؤقتة SHA-256
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleCopyLeaderCredentials(item)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-[#EAE0D5] hover:bg-[#FAF6EE] text-xs font-bold text-[#755953] cursor-pointer"
                                  title="نسخ بيانات الدخول"
                                >
                                  {copiedId === account.id ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-700" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                </button>
                                {account.phone && (
                                  <a
                                    href={buildWhatsAppUrl(
                                      account.phone,
                                      buildLeaderWhatsAppText(item)
                                    )}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-800 text-xs font-bold"
                                  >
                                    <MessageCircle className="w-3.5 h-3.5" />
                                    واتساب
                                  </a>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: Workspace Accounts Browser */}
      {subTab === 'workspaces' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Workspace Selector List */}
          <aside className="lg:col-span-4 bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-[#EAE0D5] space-y-3">
              <div>
                <h2 className="font-extrabold text-sm text-[#2C1813]">اختر الفصل لعرض حساباته</h2>
                <p className="text-[11px] text-[#755953] mt-0.5">
                  تتم القراءة مباشرة من مسار الفصل المعزول في Firestore
                </p>
              </div>
              <div className="relative">
                <Search className="w-4 h-4 text-[#755953] absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={wsSearch}
                  onChange={(e) => setWsSearch(e.target.value)}
                  placeholder="ابحث عن فصل أو كنيسة..."
                  className="w-full bg-[#FAF6EE] border border-[#EAE0D5] focus:border-[#7A1523] focus:outline-none rounded-xl pr-9 pl-3 py-2 text-xs"
                />
              </div>
            </div>

            {filteredWorkspaces.length === 0 ? (
              <div className="p-6 text-center text-xs text-[#755953]">
                لا توجد فصول مطابقة.
              </div>
            ) : (
              <div className="divide-y divide-[#EAE0D5] max-h-[560px] overflow-y-auto">
                {filteredWorkspaces.map((ws) => {
                  const active = ws.id === selectedWorkspaceId;
                  return (
                    <button
                      key={ws.id}
                      type="button"
                      onClick={() => setSelectedWorkspaceId(ws.id)}
                      className={`w-full text-right px-4 py-3.5 flex items-center gap-3 transition-colors cursor-pointer ${
                        active ? 'bg-[#FDF2F4]' : 'hover:bg-[#FAF6EE]/70'
                      }`}
                    >
                      <img
                        src={resolveLogoUrl(ws.logoUrl)}
                        alt={ws.className}
                        referrerPolicy="no-referrer"
                        className="w-10 h-10 rounded-xl object-cover border border-[#EAE0D5] shrink-0 bg-[#FAF6EE]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`font-extrabold text-xs truncate ${
                              active ? 'text-[#7A1523]' : 'text-[#2C1813]'
                            }`}
                          >
                            {ws.className}
                          </span>
                          <span
                            className={`text-[11px] font-bold shrink-0 ${
                              ws.status === 'active' ? 'text-emerald-700' : 'text-[#7A1523]'
                            }`}
                          >
                            {ws.status === 'active' ? 'نشط' : 'معلق'}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#755953] truncate mt-0.5">
                          {ws.churchName} · {ws.headServantName}
                        </p>
                        <p className="text-[11px] font-mono tabular-nums text-[#755953] mt-0.5">
                          {ws.servantCount} خادم · {ws.studentCount} مخدوم
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </aside>

          {/* Selected Workspace Full Accounts & Security Panel */}
          <div className="lg:col-span-8">
            {selectedWorkspace ? (
              <AccountsSecurityPanel
                key={selectedWorkspace.id}
                workspace={selectedWorkspace}
                accounts={wsAccounts}
                currentUserRole={currentUser.role}
                loading={wsAccountsLoading}
              />
            ) : (
              <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-12 text-center text-sm text-[#755953]">
                اختر فصلاً من القائمة لعرض وإدارة حساباته.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Leader Modal */}
      {showAddLeader && (
        <div className="fixed inset-0 z-50 bg-[#2C1813]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-extrabold text-[#2C1813]">
                  إضافة حساب أمين فصل أو أمين مساعد
                </h3>
                <p className="text-xs text-[#755953]">
                  تشفير كلمة المرور المؤقتة فوراً بخوارزمية SHA-256 وربطه بالفصل المحدد
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddLeader(false)}
                className="cursor-pointer"
              >
                <X className="w-5 h-5 text-[#755953]" />
              </button>
            </div>

            <form onSubmit={handleCreateLeader} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold mb-1">الفصل المستهدف</label>
                <select
                  required
                  value={leaderForm.workspaceId}
                  onChange={(e) => {
                    const ws = workspaces.find((w) => w.id === e.target.value);
                    const stages = ws ? getWorkspaceStageNames(ws) : [];
                    setLeaderForm((prev) => ({
                      ...prev,
                      workspaceId: e.target.value,
                      assignedGrade: stages[0] || '',
                    }));
                  }}
                  className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm"
                >
                  {workspaces.map((ws) => (
                    <option key={ws.id} value={ws.id}>
                      {ws.className} — {ws.churchName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">الدور القيادي</label>
                  <select
                    value={leaderForm.role}
                    onChange={(e) =>
                      setLeaderForm({
                        ...leaderForm,
                        role: e.target.value as 'head_servant' | 'assistant_head',
                      })
                    }
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2.5 text-sm"
                  >
                    <option value="head_servant">أمين الفصل</option>
                    <option value="assistant_head">أمين مساعد</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold mb-1">المرحلة المسئول عنها</label>
                  <select
                    value={leaderForm.assignedGrade}
                    onChange={(e) =>
                      setLeaderForm({ ...leaderForm, assignedGrade: e.target.value })
                    }
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2.5 text-sm"
                  >
                    {(selectedAddLeaderWorkspace
                      ? getWorkspaceStageNames(selectedAddLeaderWorkspace)
                      : []
                    ).map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">الاسم الكامل</label>
                  <input
                    type="text"
                    required
                    value={leaderForm.fullName}
                    onChange={(e) => setLeaderForm({ ...leaderForm, fullName: e.target.value })}
                    placeholder="الاسم الكامل"
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">رقم الهاتف</label>
                  <input
                    type="tel"
                    dir="ltr"
                    value={leaderForm.phone}
                    onChange={(e) => setLeaderForm({ ...leaderForm, phone: e.target.value })}
                    placeholder="01xxxxxxxxx"
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm font-mono text-left"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">اسم المستخدم (حساس للأحرف)</label>
                  <input
                    type="text"
                    required
                    dir="ltr"
                    value={leaderForm.username}
                    onChange={(e) => setLeaderForm({ ...leaderForm, username: e.target.value })}
                    placeholder="username"
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm font-mono text-left"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">كلمة المرور المؤقتة (SHA-256)</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      required
                      minLength={4}
                      dir="ltr"
                      value={leaderForm.tempPassword}
                      onChange={(e) =>
                        setLeaderForm({ ...leaderForm, tempPassword: e.target.value })
                      }
                      className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2.5 text-sm font-mono text-left"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setLeaderForm((prev) => ({
                          ...prev,
                          tempPassword: generateSecureTempPassword(8),
                        }))
                      }
                      className="p-2.5 rounded-xl border border-[#EAE0D5] bg-[#FAF6EE] hover:bg-[#FBF2D8] text-[#A46714] cursor-pointer shrink-0"
                      title="توليد كلمة مرور عشوائية"
                    >
                      <Shuffle className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddLeader(false)}
                  className="px-4 py-2 rounded-xl border border-[#EAE0D5] text-xs font-bold text-[#755953] cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={addingLeader}
                  className="px-5 py-2.5 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] text-white text-xs font-bold cursor-pointer"
                >
                  {addingLeader ? 'جاري الإنشاء...' : 'إنشاء وتشفير الحساب'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
};
