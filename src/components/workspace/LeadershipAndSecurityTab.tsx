import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  KeyRound,
  MessageCircle,
  MessageSquare,
  Plus,
  Settings,
  Shield,
  Upload,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import type {
  Servant,
  SessionUser,
  WorkspaceBundle,
  WorkspaceStage,
} from '../../types';
import {
  buildWhatsAppUrl,
  compressImageToDataUrl,
  DEFAULT_PLATFORM_EMBLEM,
  formatArabicDate,
  getWorkspaceStageNames,
  getWorkspaceStages,
  resolveLogoUrl,
} from '../../utils/api';
import {
  addServantInFirestore,
  resetWorkspaceAccountPasswordInFirestore,
  reviewChangeRequestInFirestore,
  updateServantInFirestore,
  updateWorkspaceSettingsInFirestore,
} from '../../services/firestoreService';
import { StageBuilder } from '../StageBuilder';
import { UnifiedChatHub } from '../UnifiedChatHub';

interface LeadershipAndSecurityTabProps {
  bundle: WorkspaceBundle;
  currentUser: SessionUser;
  onRefresh: () => Promise<void>;
}

const ROLE_ARABIC: Record<string, string> = {
  head_servant: 'أمين الفصل',
  assistant_head: 'أمين مساعد',
  servant: 'خادم',
  student: 'مخدوم',
};

export const LeadershipAndSecurityTab: React.FC<LeadershipAndSecurityTabProps> = ({
  bundle,
  currentUser,
  onRefresh,
}) => {
  const { workspace, servants, accounts, changeRequests, servantLogs } = bundle;
  const stageNames = useMemo(() => getWorkspaceStageNames(workspace), [workspace]);
  const isAdmin =
    currentUser.role === 'environment_owner' ||
    currentUser.role === 'head_servant' ||
    currentUser.role === 'assistant_head';
  const canAccessChat = currentUser.role !== 'student';

  const [subTab, setSubTab] = useState<'servants' | 'approvals' | 'security' | 'branding' | 'chat'>('servants');
  const [showAddServant, setShowAddServant] = useState(false);
  const [editingServant, setEditingServant] = useState<Servant | null>(null);
  const [resetTargetId, setResetTargetId] = useState<string>('');
  const [tempPassInput, setTempPassInput] = useState('123456');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  const [newServantForm, setNewServantForm] = useState({
    fullName: '',
    role: 'servant' as 'servant' | 'assistant_head',
    phone: '',
    assignedGrade: stageNames[0] || '',
    username: '',
    tempPassword: '',
    bio: '',
  });

  const [brandingForm, setBrandingForm] = useState<{
    churchName: string;
    className: string;
    stages: WorkspaceStage[];
    verse: string;
    logoUrl: string;
  }>({
    churchName: workspace.churchName,
    className: workspace.className,
    stages: getWorkspaceStages(workspace),
    verse: workspace.verse,
    logoUrl: resolveLogoUrl(workspace.logoUrl),
  });

  useEffect(() => {
    setBrandingForm({
      churchName: workspace.churchName,
      className: workspace.className,
      stages: getWorkspaceStages(workspace),
      verse: workspace.verse,
      logoUrl: resolveLogoUrl(workspace.logoUrl),
    });
  }, [workspace]);

  useEffect(() => {
    setNewServantForm((prev) =>
      stageNames.includes(prev.assignedGrade)
        ? prev
        : { ...prev, assignedGrade: stageNames[0] || '' }
    );
  }, [stageNames]);

  const handleAddServant = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await addServantInFirestore(workspace.id, newServantForm, workspace);
      setShowAddServant(false);
      setNewServantForm({
        fullName: '',
        role: 'servant',
        phone: '',
        assignedGrade: stageNames[0] || '',
        username: '',
        tempPassword: '',
        bio: '',
      });
      setFeedback('تمت إضافة الخادم وإنشاء حسابه بنجاح.');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إضافة الخادم.');
    }
  };

  const handleSaveServantProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingServant) return;
    setError('');
    try {
      await updateServantInFirestore(workspace.id, editingServant, currentUser, isAdmin);
      setEditingServant(null);
      setFeedback('تم تحديث بيانات الخادم وتسجيل التعديل في سجل التدقيق.');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر التحديث.');
    }
  };

  const handleReviewChangeRequest = async (id: string, status: 'approved' | 'rejected') => {
    const cr = changeRequests.find((c) => c.id === id);
    if (!cr) return;
    const stu = bundle.students.find((s) => s.id === cr.studentId);
    await reviewChangeRequestInFirestore(workspace.id, cr, status, currentUser.fullName, stu);
    setFeedback(status === 'approved' ? 'تم اعتماد وتطبيق التعديل.' : 'تم رفض الطلب.');
    await onRefresh();
  };

  const handleResetAccountPassword = async (accountId: string) => {
    setError('');
    try {
      const account = accounts.find((a) => a.id === accountId);
      if (!account) return;
      await resetWorkspaceAccountPasswordInFirestore(workspace.id, account, tempPassInput);
      setResetTargetId('');
      setFeedback('تم تعيين كلمة المرور المؤقتة بنجاح. يمكنك إرسالها عبر واتساب الآن.');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تعيين كلمة المرور.');
    }
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const validStages = brandingForm.stages
        .map((s, idx) => ({ id: s.id || `stg_${idx + 1}`, name: s.name.trim() }))
        .filter((s) => s.name.length > 0);
      if (validStages.length === 0) {
        setError('يرجى الإبقاء على مرحلة دراسية واحدة على الأقل.');
        return;
      }
      const grades = validStages.map((s) => s.name);
      const stageConfig = grades.join('، ');
      await updateWorkspaceSettingsInFirestore(workspace.id, {
        churchName: brandingForm.churchName,
        className: brandingForm.className,
        stageConfig,
        grades,
        stages: validStages,
        verse: brandingForm.verse,
        logoUrl: brandingForm.logoUrl,
      });
      setFeedback('تم تحديث هوية وشعار ومراحل الفصل وحفظها سحابياً بنجاح.');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحديث الإعدادات.');
    }
  };

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const compressed = await compressImageToDataUrl(file, 280, 0.8, 58 * 1024);
      setBrandingForm((prev) => ({ ...prev, logoUrl: compressed }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر ضغط الشعار.');
    }
  };

  const pendingChangesCount = changeRequests.filter((c) => c.status === 'pending').length;

  return (
    <div className="space-y-5">
      {feedback && (
        <div className="px-4 py-3 rounded-2xl bg-[#FBF2D8] border border-[#D4AF37]/40 text-xs font-bold text-[#2C1813] flex items-center justify-between">
          <span>{feedback}</span>
          <button type="button" onClick={() => setFeedback('')} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {error && (
        <div className="px-4 py-3 rounded-2xl bg-[#FDF2F4] border border-[#7A1523]/25 text-xs font-bold text-[#7A1523] flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Navigation */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl w-fit">
        <button
          type="button"
          onClick={() => setSubTab('servants')}
          className={`px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer ${
            subTab === 'servants' ? 'bg-[#7A1523] text-white' : 'text-[#755953]'
          }`}
        >
          الخدام ({servants.length})
        </button>
        {isAdmin && (
          <>
            <button
              type="button"
              onClick={() => setSubTab('approvals')}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer ${
                subTab === 'approvals' ? 'bg-[#7A1523] text-white' : 'text-[#755953]'
              }`}
            >
              الاعتمادات وسجل التدقيق ({pendingChangesCount})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('security')}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer ${
                subTab === 'security' ? 'bg-[#7A1523] text-white' : 'text-[#755953]'
              }`}
            >
              أمان الحسابات
            </button>
            <button
              type="button"
              onClick={() => setSubTab('branding')}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer ${
                subTab === 'branding' ? 'bg-[#7A1523] text-white' : 'text-[#755953]'
              }`}
            >
              هوية الفصل
            </button>
          </>
        )}
        {canAccessChat && (
          <button
            type="button"
            onClick={() => setSubTab('chat')}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer flex items-center gap-1.5 ${
              subTab === 'chat' ? 'bg-[#7A1523] text-white' : 'text-[#755953]'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            التواصل والشات
          </button>
        )}
      </div>

      {/* Subtab: Servants Directory */}
      {subTab === 'servants' && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-extrabold text-base text-[#2C1813] flex items-center gap-2">
              <Users className="w-5 h-5 text-[#7A1523]" />
              هيئة خدام الفصل
            </h2>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setShowAddServant(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#7A1523] text-white text-xs font-bold cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                إضافة خادم
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {servants.map((srv) => {
              const canEdit = isAdmin || srv.id === currentUser.linkedProfileId;
              return (
                <article
                  key={srv.id}
                  className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-5 flex flex-col justify-between gap-3"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-extrabold text-sm text-[#2C1813]">{srv.fullName}</h3>
                      <span className="text-[11px] font-bold text-[#A46714]">
                        {ROLE_ARABIC[srv.role]}
                      </span>
                    </div>
                    <p className="text-xs text-[#755953]">
                      {srv.assignedGrade} · <span className="font-mono">@{srv.username}</span>
                    </p>
                    {srv.phone && (
                      <p className="text-xs font-mono tabular-nums text-[#2C1813]">{srv.phone}</p>
                    )}
                    {srv.bio && <p className="text-xs text-[#755953] pt-1">{srv.bio}</p>}
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setEditingServant({ ...srv })}
                      className="w-full py-2 rounded-xl border border-[#EAE0D5] hover:bg-[#FAF6EE] text-xs font-bold cursor-pointer"
                    >
                      تعديل الملف الشخصي
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* Subtab: Approvals & Audit Logs */}
      {subTab === 'approvals' && isAdmin && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-5 space-y-4">
            <h3 className="font-extrabold text-base text-[#2C1813] flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-[#7A1523]" />
              طلبات تعديل بيانات المخدومين
            </h3>
            {changeRequests.length === 0 ? (
              <p className="text-sm text-[#755953]">لا توجد طلبات تعديل.</p>
            ) : (
              <div className="divide-y divide-[#EAE0D5]">
                {changeRequests.map((cr) => (
                  <div key={cr.id} className="py-3.5 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-[#2C1813]">{cr.studentName}</span>
                      <span
                        className={`font-bold ${
                          cr.status === 'approved'
                            ? 'text-emerald-700'
                            : cr.status === 'rejected'
                            ? 'text-[#7A1523]'
                            : 'text-[#A46714]'
                        }`}
                      >
                        {cr.status === 'approved' ? 'معتمد' : cr.status === 'rejected' ? 'مرفوض' : 'بانتظار المراجعة'}
                      </span>
                    </div>
                    <p className="text-xs text-[#755953]">
                      {cr.field}: <span className="line-through">{cr.oldValue || '—'}</span> ←{' '}
                      <strong className="text-[#2C1813]">{cr.newValue}</strong>
                    </p>
                    {cr.status === 'pending' && (
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleReviewChangeRequest(cr.id, 'approved')}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          اعتماد وتطبيق
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReviewChangeRequest(cr.id, 'rejected')}
                          className="px-3 py-1.5 rounded-xl border border-[#EAE0D5] text-[#7A1523] text-xs font-bold cursor-pointer"
                        >
                          رفض
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-5 space-y-4">
            <h3 className="font-extrabold text-base text-[#2C1813] flex items-center gap-2">
              <Shield className="w-5 h-5 text-[#A46714]" />
              سجل تدقيق تعديلات الخدام
            </h3>
            {servantLogs.length === 0 ? (
              <p className="text-sm text-[#755953]">لا توجد حركات مسجلة.</p>
            ) : (
              <div className="divide-y divide-[#EAE0D5] max-h-96 overflow-y-auto">
                {servantLogs.map((log) => (
                  <div key={log.id} className="py-3 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#7A1523]">{log.action}</span>
                      <span className="font-mono tabular-nums text-[#755953]">
                        {formatArabicDate(log.createdAt)}
                      </span>
                    </div>
                    <p className="text-[#2C1813]">{log.details}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Subtab: Account Security Console */}
      {subTab === 'security' && isAdmin && (
        <section className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#EAE0D5] flex items-center justify-between">
            <div>
              <h3 className="font-extrabold text-base text-[#2C1813] flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-[#7A1523]" />
                إدارة كلمات المرور المؤقتة وإرسالها عبر واتساب
              </h3>
              <p className="text-xs text-[#755953] mt-0.5">
                عند تعيين كلمة مرور مؤقتة، يُطلب من المستخدم تغييرها إجبارياً في أول تسجيل دخول
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-[#FAF6EE] border-b border-[#EAE0D5] text-xs text-[#755953]">
                <tr>
                  <th className="py-3 px-4 font-bold">الاسم</th>
                  <th className="py-3 px-4 font-bold">الدور</th>
                  <th className="py-3 px-4 font-bold">اسم المستخدم</th>
                  <th className="py-3 px-4 font-bold">الحالة</th>
                  <th className="py-3 px-4 font-bold text-left">إجراءات الأمان</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE0D5]">
                {accounts.map((acc) => (
                  <tr key={acc.id}>
                    <td className="py-3 px-4 font-bold text-[#2C1813]">{acc.fullName}</td>
                    <td className="py-3 px-4 text-xs text-[#755953]">{ROLE_ARABIC[acc.role]}</td>
                    <td className="py-3 px-4 text-xs font-mono text-[#2C1813]">{acc.username}</td>
                    <td className="py-3 px-4 text-xs">
                      {acc.mustChangePassword ? (
                        <span className="font-bold text-[#A46714]">بانتظار تغيير كلمة المرور</span>
                      ) : (
                        <span className="text-emerald-700 font-bold">نشط</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-left">
                      {resetTargetId === acc.id ? (
                        <div className="inline-flex items-center gap-2">
                          <input
                            type="text"
                            dir="ltr"
                            value={tempPassInput}
                            onChange={(e) => setTempPassInput(e.target.value)}
                            className="w-28 bg-[#FAF6EE] border border-[#EAE0D5] rounded-lg px-2 py-1 text-xs font-mono"
                          />
                          <button
                            type="button"
                            onClick={() => handleResetAccountPassword(acc.id)}
                            className="px-3 py-1 rounded-lg bg-[#7A1523] text-white text-xs font-bold cursor-pointer"
                          >
                            حفظ
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
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setTempPassInput('123456');
                              setResetTargetId(acc.id);
                            }}
                            className="px-3 py-1.5 rounded-xl border border-[#EAE0D5] hover:bg-[#FAF6EE] text-xs font-bold cursor-pointer"
                          >
                            تعيين كلمة مرور
                          </button>
                          {acc.phone && (
                            <a
                              href={buildWhatsAppUrl(
                                acc.phone,
                                `سلام ونعمة ${acc.fullName}، بيانات دخولكم لبوابة ${workspace.className}:\nاسم المستخدم: ${acc.username}\nكلمة المرور المؤقتة: ${tempPassInput}`
                              )}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              واتساب
                            </a>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Subtab: Workspace Branding Settings */}
      {subTab === 'branding' && isAdmin && (
        <section className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-6 max-w-2xl space-y-5">
          <h3 className="font-extrabold text-base text-[#2C1813] flex items-center gap-2">
            <Settings className="w-5 h-5 text-[#7A1523]" />
            إعدادات هوية الفصل والشعار
          </h3>
          <form onSubmit={handleSaveBranding} className="space-y-4">
            <div className="flex flex-wrap items-center gap-4 p-4 rounded-2xl bg-[#FAF6EE] border border-[#EAE0D5]">
              <img
                src={resolveLogoUrl(brandingForm.logoUrl)}
                alt="شعار الفصل"
                referrerPolicy="no-referrer"
                className="w-16 h-16 rounded-2xl object-cover border border-[#EAE0D5] bg-[#FFFDF9]"
              />
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#FFFDF9] border border-[#EAE0D5] hover:border-[#7A1523] text-xs font-bold cursor-pointer">
                  <Upload className="w-4 h-4 text-[#7A1523]" />
                  تغيير الشعار
                  <input type="file" accept="image/*" onChange={handleLogoChange} className="hidden" />
                </label>
                <button
                  type="button"
                  onClick={() => setBrandingForm((prev) => ({ ...prev, logoUrl: DEFAULT_PLATFORM_EMBLEM }))}
                  className="px-3 py-2 rounded-xl border border-[#EAE0D5] bg-[#FFFDF9] hover:bg-[#FBF2D8]/60 text-xs font-bold text-[#755953] cursor-pointer"
                >
                  استعادة الشعار الافتراضي
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">اسم الكنيسة</label>
              <input
                type="text"
                required
                value={brandingForm.churchName}
                onChange={(e) => setBrandingForm({ ...brandingForm, churchName: e.target.value })}
                className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">اسم الفصل / الخدمة</label>
              <input
                type="text"
                required
                value={brandingForm.className}
                onChange={(e) => setBrandingForm({ ...brandingForm, className: e.target.value })}
                className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm"
              />
            </div>
            <StageBuilder
              stages={brandingForm.stages}
              onChange={(nextStages) =>
                setBrandingForm((prev) => ({ ...prev, stages: nextStages }))
              }
            />
            <div>
              <label className="block text-xs font-bold mb-1">آية وشعار الفصل</label>
              <input
                type="text"
                value={brandingForm.verse}
                onChange={(e) => setBrandingForm({ ...brandingForm, verse: e.target.value })}
                className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm"
              />
            </div>
            <button
              type="submit"
              className="px-6 py-2.5 rounded-xl bg-[#7A1523] text-white text-xs font-bold cursor-pointer"
            >
              حفظ التعديلات
            </button>
          </form>
        </section>
      )}

      {/* Subtab: Workspace & Platform 4-Tier Chat */}
      {subTab === 'chat' && canAccessChat && (
        <UnifiedChatHub currentUser={currentUser} workspaceId={workspace.id} />
      )}

      {/* Add Servant Modal */}
      {showAddServant && (
        <div className="fixed inset-0 z-50 bg-[#2C1813]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-[#2C1813]">إضافة خادم جديد</h3>
              <button type="button" onClick={() => setShowAddServant(false)} className="cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddServant} className="space-y-3">
              <input
                type="text"
                required
                value={newServantForm.fullName}
                onChange={(e) => setNewServantForm({ ...newServantForm, fullName: e.target.value })}
                placeholder="الاسم الكامل للخادم"
                className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm"
              />
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={newServantForm.role}
                  onChange={(e) =>
                    setNewServantForm({ ...newServantForm, role: e.target.value as 'servant' | 'assistant_head' })
                  }
                  className="bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-sm"
                >
                  <option value="servant">خادم</option>
                  <option value="assistant_head">أمين مساعد</option>
                </select>
                <select
                  value={newServantForm.assignedGrade}
                  onChange={(e) => setNewServantForm({ ...newServantForm, assignedGrade: e.target.value })}
                  className="bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-sm"
                >
                  {stageNames.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>
              <input
                type="tel"
                dir="ltr"
                value={newServantForm.phone}
                onChange={(e) => setNewServantForm({ ...newServantForm, phone: e.target.value })}
                placeholder="رقم الهاتف"
                className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm font-mono text-left"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  dir="ltr"
                  value={newServantForm.username}
                  onChange={(e) => setNewServantForm({ ...newServantForm, username: e.target.value })}
                  placeholder="username"
                  className="bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-sm font-mono text-left"
                />
                <input
                  type="text"
                  required
                  dir="ltr"
                  value={newServantForm.tempPassword}
                  onChange={(e) => setNewServantForm({ ...newServantForm, tempPassword: e.target.value })}
                  placeholder="كلمة مرور مؤقتة"
                  className="bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-sm font-mono text-left"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-[#7A1523] text-white text-xs font-bold cursor-pointer"
              >
                حفظ وإضافة الخادم
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Edit Servant Self-Profile Modal */}
      {editingServant && (
        <div className="fixed inset-0 z-50 bg-[#2C1813]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-[#2C1813]">تعديل ملف الخادم</h3>
              <button type="button" onClick={() => setEditingServant(null)} className="cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveServantProfile} className="space-y-3">
              <input
                type="text"
                required
                value={editingServant.fullName}
                onChange={(e) => setEditingServant({ ...editingServant, fullName: e.target.value })}
                className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm"
              />
              <input
                type="tel"
                dir="ltr"
                value={editingServant.phone}
                onChange={(e) => setEditingServant({ ...editingServant, phone: e.target.value })}
                className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm font-mono text-left"
              />
              {isAdmin && (
                <div>
                  <label className="block text-xs font-bold mb-1">المرحلة المسئول عنها</label>
                  <select
                    value={editingServant.assignedGrade}
                    onChange={(e) =>
                      setEditingServant({ ...editingServant, assignedGrade: e.target.value })
                    }
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2 text-sm"
                  >
                    {stageNames.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                    {!stageNames.includes(editingServant.assignedGrade) &&
                      editingServant.assignedGrade && (
                        <option value={editingServant.assignedGrade}>
                          {editingServant.assignedGrade}
                        </option>
                      )}
                  </select>
                </div>
              )}
              <textarea
                rows={3}
                value={editingServant.bio}
                onChange={(e) => setEditingServant({ ...editingServant, bio: e.target.value })}
                placeholder="نبذة عن الخدمة..."
                className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm"
              />
              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-[#7A1523] text-white text-xs font-bold cursor-pointer"
              >
                حفظ وتسجيل في سجل التدقيق
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
