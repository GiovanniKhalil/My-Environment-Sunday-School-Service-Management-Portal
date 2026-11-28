import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  MessageCircle,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Shuffle,
  X,
} from 'lucide-react';
import type { Gender, UserRole, Workspace, WorkspaceAccount } from '../types';
import { buildWhatsAppUrl, getWorkspaceStageNames } from '../utils/api';
import {
  addServantInFirestore,
  addStudentInFirestore,
  generateSecureTempPassword,
  resetWorkspaceAccountPasswordInFirestore,
  updateWorkspaceAccountUsernameInFirestore,
} from '../services/firestoreService';

interface AccountsSecurityPanelProps {
  workspace: Workspace;
  accounts: WorkspaceAccount[];
  currentUserRole: UserRole;
  loading?: boolean;
  onChanged?: () => Promise<void> | void;
}

type AccountFilter = 'all' | 'servants' | 'students' | 'temp';

const ROLE_ARABIC: Record<string, string> = {
  head_servant: 'أمين الفصل',
  assistant_head: 'أمين مساعد',
  servant: 'خادم',
  student: 'مخدوم',
};

export const AccountsSecurityPanel: React.FC<AccountsSecurityPanelProps> = ({
  workspace,
  accounts,
  currentUserRole,
  loading = false,
  onChanged,
}) => {
  const stageNames = useMemo(() => getWorkspaceStageNames(workspace), [workspace]);
  const canManageAll =
    currentUserRole === 'environment_owner' || currentUserRole === 'head_servant';
  const canManageWorkspace = canManageAll || currentUserRole === 'assistant_head';

  const [filter, setFilter] = useState<AccountFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  // Inline password reset state
  const [resetTargetId, setResetTargetId] = useState('');
  const [tempPassInput, setTempPassInput] = useState('');
  const [savingPass, setSavingPass] = useState(false);

  // Inline username edit state
  const [editUserTargetId, setEditUserTargetId] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);

  // Keep session-issued temporary passwords keyed by account.id for immediate copy / WhatsApp sharing
  const [issuedPasswords, setIssuedPasswords] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState('');

  // Add account modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [addingAccount, setAddingAccount] = useState(false);
  const [addForm, setAddForm] = useState({
    role: 'servant' as 'head_servant' | 'assistant_head' | 'servant' | 'student',
    fullName: '',
    phone: '',
    parentPhone: '',
    grade: stageNames[0] || '',
    gender: 'ذكر' as Gender,
    username: '',
    tempPassword: generateSecureTempPassword(8),
  });

  const stats = useMemo(() => {
    const total = accounts.length;
    const servants = accounts.filter((a) => a.role !== 'student').length;
    const students = accounts.filter((a) => a.role === 'student').length;
    const tempCount = accounts.filter((a) => a.mustChangePassword).length;
    return { total, servants, students, tempCount };
  }, [accounts]);

  const filteredAccounts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return accounts
      .filter((acc) => {
        if (filter === 'servants' && acc.role === 'student') return false;
        if (filter === 'students' && acc.role !== 'student') return false;
        if (filter === 'temp' && !acc.mustChangePassword) return false;
        if (!q) return true;
        return (
          (acc.fullName || '').toLowerCase().includes(q) ||
          (acc.username || '').toLowerCase().includes(q) ||
          (acc.phone || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const weight = (r: UserRole) =>
          r === 'head_servant' ? 0 : r === 'assistant_head' ? 1 : r === 'servant' ? 2 : 3;
        const diff = weight(a.role) - weight(b.role);
        if (diff !== 0) return diff;
        return (a.fullName || '').localeCompare(b.fullName || '', 'ar');
      });
  }, [accounts, filter, searchQuery]);

  const canModifyAccount = (acc: WorkspaceAccount): boolean => {
    if (!canManageWorkspace) return false;
    if (acc.role === 'head_servant' && !canManageAll) return false;
    return true;
  };

  const handleOpenReset = (acc: WorkspaceAccount) => {
    setError('');
    setEditUserTargetId('');
    setResetTargetId(acc.id);
    setTempPassInput(generateSecureTempPassword(8));
  };

  const handleSaveResetPassword = async (acc: WorkspaceAccount) => {
    const clean = tempPassInput.trim();
    if (clean.length < 4) {
      setError('كلمة المرور المؤقتة يجب أن لا تقل عن 4 أحرف.');
      return;
    }
    setError('');
    setSavingPass(true);
    try {
      await resetWorkspaceAccountPasswordInFirestore(workspace.id, acc, clean);
      setIssuedPasswords((prev) => ({ ...prev, [acc.id]: clean }));
      setResetTargetId('');
      setFeedback(
        `تم توليد وتشفير كلمة مرور مؤقتة (SHA-256) لحساب ${acc.fullName} بنجاح. يمكنك مشاركتها عبر واتساب الآن.`
      );
      await onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تعيين كلمة المرور المؤقتة.');
    } finally {
      setSavingPass(false);
    }
  };

  const handleOpenEditUsername = (acc: WorkspaceAccount) => {
    setError('');
    setResetTargetId('');
    setEditUserTargetId(acc.id);
    setUsernameInput(acc.username);
  };

  const handleSaveUsername = async (acc: WorkspaceAccount) => {
    setError('');
    setSavingUsername(true);
    try {
      await updateWorkspaceAccountUsernameInFirestore(workspace.id, acc, usernameInput);
      setEditUserTargetId('');
      setFeedback(`تم تحديث اسم المستخدم لحساب ${acc.fullName} بنجاح.`);
      await onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحديث اسم المستخدم.');
    } finally {
      setSavingUsername(false);
    }
  };

  const handleCopyCredentials = async (acc: WorkspaceAccount) => {
    const issued = issuedPasswords[acc.id];
    const lines = [
      `بيانات دخول بوابة ${workspace.className} (${workspace.churchName})`,
      `الاسم: ${acc.fullName}`,
      `اسم المستخدم: ${acc.username}`,
      issued ? `كلمة المرور المؤقتة: ${issued}` : 'حالة كلمة المرور: مشفرة (SHA-256)',
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopiedId(acc.id);
      setTimeout(() => setCopiedId((prev) => (prev === acc.id ? '' : prev)), 2000);
    } catch {
      setError('تعذر النسخ إلى الحافظة.');
    }
  };

  const handleOpenAddModal = () => {
    setError('');
    setAddForm({
      role: 'servant',
      fullName: '',
      phone: '',
      parentPhone: '',
      grade: stageNames[0] || '',
      gender: 'ذكر',
      username: '',
      tempPassword: generateSecureTempPassword(8),
    });
    setShowAddModal(true);
  };

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setAddingAccount(true);
    try {
      let createdAccountId = '';
      if (addForm.role === 'student') {
        createdAccountId = await addStudentInFirestore(
          workspace.id,
          {
            fullName: addForm.fullName,
            grade: addForm.grade || stageNames[0] || 'المرحلة الأولى',
            gender: addForm.gender,
            birthDate: '',
            phone: addForm.phone,
            parentPhone: addForm.parentPhone || addForm.phone,
            address: '',
            username: addForm.username,
            tempPassword: addForm.tempPassword,
          },
          workspace
        );
      } else {
        createdAccountId = await addServantInFirestore(
          workspace.id,
          {
            fullName: addForm.fullName,
            role: addForm.role,
            phone: addForm.phone,
            assignedGrade: addForm.grade || stageNames[0] || '',
            username: addForm.username,
            tempPassword: addForm.tempPassword,
            bio: '',
          },
          workspace
        );
      }
      if (createdAccountId) {
        setIssuedPasswords((prev) => ({ ...prev, [createdAccountId]: addForm.tempPassword }));
      }
      setShowAddModal(false);
      setFeedback(
        `تم إنشاء حساب ${addForm.fullName} وتشفير كلمة المرور المؤقتة (${addForm.tempPassword}) بنظام SHA-256.`
      );
      await onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء الحساب.');
    } finally {
      setAddingAccount(false);
    }
  };

  const buildAccountWhatsAppMessage = (acc: WorkspaceAccount): string => {
    const issued = issuedPasswords[acc.id];
    if (issued) {
      return `سلام ونعمة ${acc.fullName}، إليك بيانات دخولك إلى بوابة ${workspace.className} (${workspace.churchName}):\nاسم المستخدم: ${acc.username}\nكلمة المرور المؤقتة: ${issued}\n(سيُطلب منك تغييرها عند أول تسجيل دخول)`;
    }
    return `سلام ونعمة ${acc.fullName}، بيانات دخولك إلى بوابة ${workspace.className} (${workspace.churchName}):\nاسم المستخدم: ${acc.username}`;
  };

  return (
    <div className="space-y-5">
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

      {/* Summary Counters */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-4">
          <p className="text-xs font-semibold text-[#755953]">إجمالي الحسابات</p>
          <p className="text-2xl font-black font-mono tabular-nums text-[#2C1813] mt-1">
            {stats.total}
          </p>
        </div>
        <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-4">
          <p className="text-xs font-semibold text-[#755953]">القيادة والخدام</p>
          <p className="text-2xl font-black font-mono tabular-nums text-[#7A1523] mt-1">
            {stats.servants}
          </p>
        </div>
        <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-4">
          <p className="text-xs font-semibold text-[#755953]">المخدومين</p>
          <p className="text-2xl font-black font-mono tabular-nums text-[#2C1813] mt-1">
            {stats.students}
          </p>
        </div>
        <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-4">
          <p className="text-xs font-semibold text-[#755953]">كلمات مؤقتة بانتظار التغيير</p>
          <p className="text-2xl font-black font-mono tabular-nums text-[#A46714] mt-1">
            {stats.tempCount}
          </p>
        </div>
      </div>

      {/* Main Accounts Table Card */}
      <section className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#EAE0D5] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h3 className="font-extrabold text-base text-[#2C1813] flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[#7A1523]" />
              لوحة إدارة الحسابات والأمان ({workspace.className})
            </h3>
            <p className="text-xs text-[#755953] mt-0.5">
              تشفير كامل لكلمات المرور بخوارزمية SHA-256 · عزل تام لحسابات الفصل
            </p>
          </div>

          {canManageWorkspace && (
            <button
              type="button"
              onClick={handleOpenAddModal}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] text-white text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              إضافة حساب جديد
            </button>
          )}
        </div>

        {/* Filters & Search */}
        <div className="px-5 py-3.5 bg-[#FAF6EE]/70 border-b border-[#EAE0D5] flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-[#FFFDF9] border border-[#EAE0D5] rounded-xl w-fit">
            {[
              { key: 'all', label: `الكل (${stats.total})` },
              { key: 'servants', label: `الخدام (${stats.servants})` },
              { key: 'students', label: `المخدومين (${stats.students})` },
              { key: 'temp', label: `كلمات مؤقتة (${stats.tempCount})` },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key as AccountFilter)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap transition-colors ${
                  filter === item.key
                    ? 'bg-[#7A1523] text-white'
                    : 'text-[#755953] hover:text-[#2C1813]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="relative w-full md:w-72">
            <Search className="w-4 h-4 text-[#755953] absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث بالاسم أو اسم المستخدم أو الهاتف..."
              className="w-full bg-[#FFFDF9] border border-[#EAE0D5] focus:border-[#7A1523] focus:outline-none rounded-xl pr-9 pl-3 py-2 text-xs"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-[#FAF6EE] rounded-xl animate-pulse" />
            ))}
          </div>
        ) : filteredAccounts.length === 0 ? (
          <div className="p-10 text-center text-sm text-[#755953]">
            لا توجد حسابات مطابقة للتصفية الحالية.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-[#FAF6EE] border-b border-[#EAE0D5] text-xs text-[#755953]">
                <tr>
                  <th className="py-3 px-4 font-bold">الاسم والهاتف</th>
                  <th className="py-3 px-4 font-bold">الدور</th>
                  <th className="py-3 px-4 font-bold">اسم المستخدم</th>
                  <th className="py-3 px-4 font-bold">حالة كلمة المرور</th>
                  <th className="py-3 px-4 font-bold text-left">إجراءات الأمان</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE0D5]">
                {filteredAccounts.map((acc) => {
                  const editable = canModifyAccount(acc);
                  const issued = issuedPasswords[acc.id];
                  return (
                    <tr key={acc.id} className="hover:bg-[#FAF6EE]/40">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-[#2C1813]">{acc.fullName}</div>
                        {acc.phone && (
                          <div className="text-xs font-mono tabular-nums text-[#755953] mt-0.5">
                            {acc.phone}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-xs font-semibold text-[#755953]">
                        {ROLE_ARABIC[acc.role] || acc.role}
                      </td>
                      <td className="py-3.5 px-4">
                        {editUserTargetId === acc.id ? (
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
                              onClick={() => void handleSaveUsername(acc)}
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
                            <span className="text-xs font-mono text-[#2C1813]">{acc.username}</span>
                            {editable && (
                              <button
                                type="button"
                                onClick={() => handleOpenEditUsername(acc)}
                                className="p-1 rounded-lg text-[#755953] hover:text-[#7A1523] hover:bg-[#FAF6EE] cursor-pointer"
                                title="تعديل اسم المستخدم"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-xs">
                        {acc.mustChangePassword ? (
                          <div>
                            <span className="font-bold text-[#A46714]">كلمة مؤقتة لم تُغيّر</span>
                            {issued && (
                              <div className="font-mono text-[11px] text-[#2C1813] mt-0.5">
                                المؤقتة الحالية: <strong>{issued}</strong>
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
                        {!editable ? (
                          <span className="text-xs text-[#755953]">محمي لأمين الفصل</span>
                        ) : resetTargetId === acc.id ? (
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
                              onClick={() => void handleSaveResetPassword(acc)}
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
                              onClick={() => handleOpenReset(acc)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-[#EAE0D5] hover:bg-[#FAF6EE] text-xs font-bold text-[#2C1813] cursor-pointer"
                            >
                              <KeyRound className="w-3.5 h-3.5 text-[#7A1523]" />
                              كلمة مؤقتة SHA-256
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleCopyCredentials(acc)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-[#EAE0D5] hover:bg-[#FAF6EE] text-xs font-bold text-[#755953] cursor-pointer"
                              title="نسخ بيانات الدخول"
                            >
                              {copiedId === acc.id ? (
                                <Check className="w-3.5 h-3.5 text-emerald-700" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                            {acc.phone && (
                              <a
                                href={buildWhatsAppUrl(acc.phone, buildAccountWhatsAppMessage(acc))}
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
      </section>

      {/* Add Account Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-[#2C1813]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-extrabold text-[#2C1813]">
                  إضافة حساب جديد في {workspace.className}
                </h3>
                <p className="text-xs text-[#755953]">
                  يُحفظ الحساب مع تشفير كلمة المرور المؤقتة فوراً بخوارزمية SHA-256
                </p>
              </div>
              <button type="button" onClick={() => setShowAddModal(false)} className="cursor-pointer">
                <X className="w-5 h-5 text-[#755953]" />
              </button>
            </div>

            <form onSubmit={handleAddAccount} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">الدور في الفصل</label>
                  <select
                    value={addForm.role}
                    onChange={(e) =>
                      setAddForm({
                        ...addForm,
                        role: e.target.value as 'head_servant' | 'assistant_head' | 'servant' | 'student',
                      })
                    }
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2.5 text-sm"
                  >
                    {currentUserRole === 'environment_owner' && (
                      <option value="head_servant">أمين الفصل</option>
                    )}
                    <option value="assistant_head">أمين مساعد</option>
                    <option value="servant">خادم</option>
                    <option value="student">مخدوم</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">المرحلة</label>
                  <select
                    value={addForm.grade}
                    onChange={(e) => setAddForm({ ...addForm, grade: e.target.value })}
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2.5 text-sm"
                  >
                    {stageNames.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">الاسم الكامل</label>
                <input
                  type="text"
                  required
                  value={addForm.fullName}
                  onChange={(e) => setAddForm({ ...addForm, fullName: e.target.value })}
                  placeholder="الاسم الكامل"
                  className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">رقم الهاتف</label>
                  <input
                    type="tel"
                    dir="ltr"
                    value={addForm.phone}
                    onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })}
                    placeholder="01xxxxxxxxx"
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm font-mono text-left"
                  />
                </div>
                {addForm.role === 'student' && (
                  <div>
                    <label className="block text-xs font-bold mb-1">الجنس</label>
                    <select
                      value={addForm.gender}
                      onChange={(e) => setAddForm({ ...addForm, gender: e.target.value as Gender })}
                      className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2.5 text-sm"
                    >
                      <option value="ذكر">ذكر</option>
                      <option value="أنثى">أنثى</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">اسم المستخدم (حساس للأحرف)</label>
                  <input
                    type="text"
                    required
                    dir="ltr"
                    value={addForm.username}
                    onChange={(e) => setAddForm({ ...addForm, username: e.target.value })}
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
                      value={addForm.tempPassword}
                      onChange={(e) => setAddForm({ ...addForm, tempPassword: e.target.value })}
                      className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2.5 text-sm font-mono text-left"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setAddForm((prev) => ({
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
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl border border-[#EAE0D5] text-xs font-bold text-[#755953] cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={addingAccount}
                  className="px-5 py-2.5 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] text-white text-xs font-bold cursor-pointer"
                >
                  {addingAccount ? 'جاري الإنشاء...' : 'إنشاء وتشفير الحساب'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
