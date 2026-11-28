import React, { useEffect, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  Eye,
  LogOut,
  MessageSquare,
  PauseCircle,
  PlayCircle,
  Plus,
  Search,
  Trash2,
  Upload,
  Users,
  X,
  UserCheck,
  AlertCircle,
} from 'lucide-react';
import type {
  EnvironmentChatChannel,
  SessionUser,
  Workspace,
} from '../types';
import {
  apiFetch,
  compressImageToDataUrl,
  DEFAULT_PLATFORM_EMBLEM,
  formatArabicDate,
  resolveLogoUrl,
} from '../utils/api';
import { fetchFirestoreWorkspaceLogos, syncWorkspaceToFirestore } from '../firebase';
import { UnifiedChatHub } from './UnifiedChatHub';

interface OwnerDashboardProps {
  currentUser: SessionUser;
  onEnterWorkspace: (workspace: Workspace) => void;
  onLogout: () => void;
}

type OwnerTab = 'workspaces' | 'requests' | 'chat';

export const OwnerDashboard: React.FC<OwnerDashboardProps> = ({
  currentUser,
  onEnterWorkspace,
  onLogout,
}) => {
  const [activeTab, setActiveTab] = useState<OwnerTab>('workspaces');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [applicants, setApplicants] = useState<SessionUser[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [bannerMsg, setBannerMsg] = useState('');
  const [selectedChatChannelId, setSelectedChatChannelId] = useState<string>('');

  // Create Workspace Wizard Modal
  const [showWizard, setShowWizard] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null);
  const [wizardForm, setWizardForm] = useState({
    applicantId: '',
    churchName: '',
    className: '',
    stageConfig: 'أولى ابتدائي، تانية ابتدائي',
    logoUrl: DEFAULT_PLATFORM_EMBLEM,
    verse: '«اخْدِمُوا الرَّبَّ بِفَرَحٍ، ادْخُلُوا إِلَى حَضْرَتِهِ بِتَرَنُّمٍ» (مز ١٠٠: ٢)',
    headFullName: '',
    headUsername: '',
    headPhone: '',
    headTempPassword: '',
  });

  const loadOverview = async () => {
    try {
      setLoading(true);
      const [res, firestoreLogos] = await Promise.all([
        apiFetch<{
          workspaces: Workspace[];
          applicants: SessionUser[];
          chatChannels: EnvironmentChatChannel[];
        }>('/api/owner/overview'),
        fetchFirestoreWorkspaceLogos(),
      ]);
      const mergedWorkspaces = res.workspaces.map((ws) => {
        const fsLogo = firestoreLogos[ws.id];
        if (fsLogo && (!ws.logoUrl || !ws.logoUrl.startsWith('data:image/'))) {
          return { ...ws, logoUrl: fsLogo };
        }
        return ws;
      });
      setWorkspaces(mergedWorkspaces);
      setApplicants(res.applicants);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل لوحة تحكم المنصة.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOverview();
  }, []);

  const openBlankWizard = () => {
    setError('');
    setWizardForm({
      applicantId: '',
      churchName: '',
      className: '',
      stageConfig: 'أولى ابتدائي، تانية ابتدائي',
      logoUrl: DEFAULT_PLATFORM_EMBLEM,
      verse: '«اخْدِمُوا الرَّبَّ بِفَرَحٍ، ادْخُلُوا إِلَى حَضْرَتِهِ بِتَرَنُّمٍ» (مز ١٠٠: ٢)',
      headFullName: '',
      headUsername: '',
      headPhone: '',
      headTempPassword: '',
    });
    setShowWizard(true);
  };

  const openWizardFromApplicant = (applicant: SessionUser) => {
    setError('');
    setWizardForm({
      applicantId: applicant.id,
      churchName: applicant.proposedChurchName || '',
      className: applicant.proposedClassName || '',
      stageConfig: applicant.proposedStageConfig || 'مرحلة مخصصة',
      logoUrl: DEFAULT_PLATFORM_EMBLEM,
      verse: '«اخْدِمُوا الرَّبَّ بِفَرَحٍ، ادْخُلُوا إِلَى حَضْرَتِهِ بِتَرَنُّمٍ» (مز ١٠٠: ٢)',
      headFullName: applicant.fullName,
      headUsername: applicant.username,
      headPhone: applicant.phone,
      headTempPassword: '',
    });
    setShowWizard(true);
  };

  const handleApproveFromChannel = (channel: EnvironmentChatChannel) => {
    const matchedApplicant = applicants.find((a) => a.id === channel.participantUserId);
    if (matchedApplicant) {
      openWizardFromApplicant(matchedApplicant);
      return;
    }
    setWizardForm({
      applicantId: channel.participantUserId || '',
      churchName: channel.churchName || '',
      className: channel.className || '',
      stageConfig: 'مرحلة مخصصة',
      logoUrl: DEFAULT_PLATFORM_EMBLEM,
      verse: '«اخْدِمُوا الرَّبَّ بِفَرَحٍ، ادْخُلُوا إِلَى حَضْرَتِهِ بِتَرَنُّمٍ» (مز ١٠٠: ٢)',
      headFullName: channel.participantName || '',
      headUsername: '',
      headPhone: '',
      headTempPassword: '',
    });
    setShowWizard(true);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageToDataUrl(file, 280, 0.8, 58 * 1024);
      setWizardForm((prev) => ({ ...prev, logoUrl: compressed }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر ضغط الشعار.');
    }
  };

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setCreating(true);
    try {
      const grades = wizardForm.stageConfig
        .split(/[،,/]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await apiFetch<{ workspace: Workspace }>('/api/owner/workspaces', {
        method: 'POST',
        body: JSON.stringify({
          ...wizardForm,
          grades,
        }),
      });
      await syncWorkspaceToFirestore(res.workspace).catch(() => {});
      setShowWizard(false);
      setBannerMsg(`تم إنشاء وتدشين مساحة «${res.workspace.className}» بنجاح.`);
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء الفصل الجديد.');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleWorkspaceStatus = async (ws: Workspace) => {
    const nextStatus = ws.status === 'active' ? 'suspended' : 'active';
    try {
      await apiFetch(`/api/owner/workspaces/${ws.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      setWorkspaces((prev) => prev.map((w) => (w.id === ws.id ? { ...w, status: nextStatus } : w)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تغيير حالة الفصل.');
    }
  };

  const handleConfirmDeleteWorkspace = async () => {
    if (!deleteTarget) return;
    try {
      await apiFetch(`/api/owner/workspaces/${deleteTarget.id}`, { method: 'DELETE' });
      setWorkspaces((prev) => prev.filter((w) => w.id !== deleteTarget.id));
      setBannerMsg(`تم حذف مساحة «${deleteTarget.className}».`);
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حذف الفصل.');
    }
  };

  const handleRejectApplicant = async (applicantId: string) => {
    try {
      await apiFetch(`/api/owner/applicants/${applicantId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'rejected' }),
      });
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحديث حالة الطلب.');
    }
  };

  const pendingApplicants = applicants.filter((a) => a.status === 'pending');
  const totalStudents = workspaces.reduce((sum, w) => sum + (w.studentCount || 0), 0);
  const totalServants = workspaces.reduce((sum, w) => sum + (w.servantCount || 0), 0);
  const activeCount = workspaces.filter((w) => w.status === 'active').length;

  const filteredWorkspaces = workspaces.filter((ws) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      ws.className.toLowerCase().includes(q) ||
      ws.churchName.toLowerCase().includes(q) ||
      ws.headServantName.toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#2C1813]">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 bg-[#FFFDF9]/95 backdrop-blur-xs border-b border-[#EAE0D5]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 shrink-0">
            <img
              src={DEFAULT_PLATFORM_EMBLEM}
              alt="شعار المنصة"
              className="w-9 h-9 rounded-xl object-cover border border-[#EAE0D5]"
            />
            <span className="font-extrabold text-base text-[#2C1813] whitespace-nowrap">
              لوحة تحكم صاحب الـ Environment
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-1 p-1 bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl">
            <button
              type="button"
              onClick={() => setActiveTab('workspaces')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'workspaces'
                  ? 'bg-[#7A1523] text-white'
                  : 'text-[#755953] hover:text-[#2C1813]'
              }`}
            >
              الفصول والمساحات ({workspaces.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('requests')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'requests'
                  ? 'bg-[#7A1523] text-white'
                  : 'text-[#755953] hover:text-[#2C1813]'
              }`}
            >
              طلبات التسجيل ({pendingApplicants.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('chat')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'chat'
                  ? 'bg-[#7A1523] text-white'
                  : 'text-[#755953] hover:text-[#2C1813]'
              }`}
            >
              شات أمناء الفصول
            </button>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={openBlankWizard}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] text-white text-xs font-bold transition-colors whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              إنشاء فصل جديد
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="p-2 rounded-xl border border-[#EAE0D5] hover:bg-[#FAF6EE] text-[#755953] cursor-pointer"
              title="تسجيل الخروج"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Mobile Tab Strip */}
        <div className="flex md:hidden border-t border-[#EAE0D5] px-4 py-2 gap-2 overflow-x-auto bg-[#FAF6EE]">
          <button
            type="button"
            onClick={() => setActiveTab('workspaces')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer ${
              activeTab === 'workspaces' ? 'bg-[#7A1523] text-white' : 'text-[#755953]'
            }`}
          >
            الفصول ({workspaces.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('requests')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer ${
              activeTab === 'requests' ? 'bg-[#7A1523] text-white' : 'text-[#755953]'
            }`}
          >
            الطلبات ({pendingApplicants.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('chat')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer ${
              activeTab === 'chat' ? 'bg-[#7A1523] text-white' : 'text-[#755953]'
            }`}
          >
            شات أمناء الفصول
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {bannerMsg && (
          <div className="px-5 py-3.5 rounded-2xl bg-[#FBF2D8] border border-[#D4AF37]/40 text-sm font-semibold text-[#2C1813] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-[#A46714]" />
              <span>{bannerMsg}</span>
            </div>
            <button type="button" onClick={() => setBannerMsg('')} className="text-[#755953] cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {error && (
          <div className="px-5 py-3.5 rounded-2xl bg-[#FDF2F4] border border-[#7A1523]/25 text-sm font-semibold text-[#7A1523] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              <span>{error}</span>
            </div>
            <button type="button" onClick={() => setError('')} className="cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* KPI Metrics Strip */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-5">
            <p className="text-xs font-semibold text-[#755953]">الفصول النشطة</p>
            <p className="text-3xl font-black font-mono tabular-nums text-[#7A1523] mt-1">
              {activeCount} <span className="text-sm font-normal text-[#755953]">/ {workspaces.length}</span>
            </p>
          </div>
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-5">
            <p className="text-xs font-semibold text-[#755953]">طلبات انتظار الاعتماد</p>
            <p className="text-3xl font-black font-mono tabular-nums text-[#A46714] mt-1">
              {pendingApplicants.length}
            </p>
          </div>
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-5">
            <p className="text-xs font-semibold text-[#755953]">إجمالي المخدومين</p>
            <p className="text-3xl font-black font-mono tabular-nums text-[#2C1813] mt-1">
              {totalStudents}
            </p>
          </div>
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-5">
            <p className="text-xs font-semibold text-[#755953]">إجمالي الخدام</p>
            <p className="text-3xl font-black font-mono tabular-nums text-[#2C1813] mt-1">
              {totalServants}
            </p>
          </div>
        </section>

        {/* Tab 1: Workspaces Directory */}
        {activeTab === 'workspaces' && (
          <section className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-extrabold text-[#2C1813]">
                  دليل غرف الخدمة والفصول المعزولة
                </h1>
                <p className="text-xs text-[#755953] mt-0.5">
                  كل غرفة تمتلك قاعدة بيانات معزولة وهوية وشعاراً مستقلاً
                </p>
              </div>
              <div className="relative w-full sm:w-80">
                <Search className="w-4 h-4 text-[#755953] absolute right-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ابحث باسم الكنيسة أو الفصل أو الأمين..."
                  className="w-full bg-[#FFFDF9] border border-[#EAE0D5] focus:border-[#7A1523] focus:outline-none rounded-xl pr-10 pl-4 py-2.5 text-sm"
                />
              </div>
            </div>

            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-56 bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl animate-pulse" />
                ))}
              </div>
            ) : filteredWorkspaces.length === 0 ? (
              <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-12 text-center">
                <Building2 className="w-10 h-10 text-[#D4AF37] mx-auto mb-3" />
                <p className="font-bold text-[#2C1813]">لا توجد غرف خدمة مطابقة للبحث</p>
                <button
                  type="button"
                  onClick={openBlankWizard}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#7A1523] text-white text-xs font-bold cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  إنشاء غرفة خدمة جديدة
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {filteredWorkspaces.map((ws) => (
                  <article
                    key={ws.id}
                    className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-5 flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <img
                            src={resolveLogoUrl(ws.logoUrl)}
                            alt={ws.className}
                            referrerPolicy="no-referrer"
                            className="w-12 h-12 rounded-xl object-cover border border-[#EAE0D5] shrink-0 bg-[#FAF6EE]"
                          />
                          <div className="min-w-0">
                            <h3 className="font-extrabold text-base text-[#2C1813] truncate">
                              {ws.className}
                            </h3>
                            <p className="text-xs text-[#755953] truncate">{ws.churchName}</p>
                          </div>
                        </div>
                        <span
                          className={`text-[11px] font-bold shrink-0 ${
                            ws.status === 'active' ? 'text-emerald-700' : 'text-[#7A1523]'
                          }`}
                        >
                          {ws.status === 'active' ? 'نشط' : 'معلق'}
                        </span>
                      </div>

                      <div className="text-xs text-[#755953] space-y-1 pt-2 border-t border-[#EAE0D5]">
                        <div className="flex items-center justify-between">
                          <span>أمين الفصل:</span>
                          <span className="font-bold text-[#2C1813]">{ws.headServantName}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>المراحل:</span>
                          <span className="truncate max-w-[170px]">{ws.stageConfig}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>الإحصائيات:</span>
                          <span className="font-mono tabular-nums font-bold text-[#2C1813]">
                            {ws.studentCount} مخدوم · {ws.servantCount} خادم
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t border-[#EAE0D5]">
                      <button
                        type="button"
                        onClick={() => onEnterWorkspace(ws)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] text-white text-xs font-bold transition-colors cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        دخول ومعاينة
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleWorkspaceStatus(ws)}
                        className="p-2 rounded-xl border border-[#EAE0D5] hover:bg-[#FAF6EE] text-[#755953] cursor-pointer"
                        title={ws.status === 'active' ? 'تعليق المساحة' : 'تفعيل المساحة'}
                      >
                        {ws.status === 'active' ? (
                          <PauseCircle className="w-4 h-4 text-[#A46714]" />
                        ) : (
                          <PlayCircle className="w-4 h-4 text-emerald-700" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(ws)}
                        className="p-2 rounded-xl border border-[#EAE0D5] hover:bg-[#FDF2F4] text-[#7A1523] cursor-pointer"
                        title="حذف الغرفة"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Tab 2: Onboarding Requests */}
        {activeTab === 'requests' && (
          <section className="space-y-4">
            <div>
              <h1 className="text-xl font-extrabold text-[#2C1813]">طلبات إنشاء غرف خدمة جديدة</h1>
              <p className="text-xs text-[#755953] mt-0.5">
                راجع طلبات الخدام الجدد، ناقشهم عبر الشات المباشر، أو اعتمد الغرفة بنقرة واحدة
              </p>
            </div>

            {applicants.length === 0 ? (
              <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-12 text-center text-sm text-[#755953]">
                لا توجد طلبات تسجيل جديدة حالياً.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {applicants.map((app) => (
                  <article
                    key={app.id}
                    className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-5 space-y-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-extrabold text-base text-[#2C1813]">
                          {app.proposedClassName || 'طلب خدمة جديد'}
                        </h3>
                        <p className="text-xs text-[#755953]">
                          {app.proposedChurchName} · {app.proposedStageConfig}
                        </p>
                      </div>
                      <span
                        className={`text-xs font-bold ${
                          app.status === 'pending'
                            ? 'text-[#A46714]'
                            : app.status === 'approved'
                            ? 'text-emerald-700'
                            : 'text-[#7A1523]'
                        }`}
                      >
                        {app.status === 'pending'
                          ? 'قيد المراجعة'
                          : app.status === 'approved'
                          ? 'تم الاعتماد'
                          : 'مرفوض'}
                      </span>
                    </div>

                    <div className="text-xs text-[#755953] space-y-1">
                      <div>
                        المتقدم: <strong className="text-[#2C1813]">{app.fullName}</strong> ·{' '}
                        <span className="font-mono">{app.phone}</span> ·{' '}
                        <span className="font-mono">@{app.username}</span>
                      </div>
                      <div>تاريخ التقديم: {formatArabicDate(app.createdAt)}</div>
                      {app.serviceVision && (
                        <p className="text-[#2C1813]/85 pt-2 leading-relaxed">{app.serviceVision}</p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[#EAE0D5]">
                      {app.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => openWizardFromApplicant(app)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] text-white text-xs font-bold cursor-pointer"
                        >
                          <UserCheck className="w-4 h-4" />
                          اعتماد وإنشاء مساحة الخدمة
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedChatChannelId(`direct_${app.id}`);
                          setActiveTab('chat');
                        }}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#FAF6EE] hover:bg-[#FBF2D8] border border-[#EAE0D5] text-xs font-bold text-[#2C1813] cursor-pointer"
                      >
                        <MessageSquare className="w-4 h-4 text-[#A46714]" />
                        مراسلة المتقدم
                      </button>
                      {app.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => handleRejectApplicant(app.id)}
                          className="px-3 py-2 rounded-xl border border-[#EAE0D5] hover:bg-[#FDF2F4] text-xs font-bold text-[#7A1523] cursor-pointer"
                        >
                          اعتذار
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Tab 3: Unified Leadership Chat Hub */}
        {activeTab === 'chat' && (
          <section className="space-y-4">
            <div>
              <h1 className="text-xl font-extrabold text-[#2C1813]">
                مركز التواصل وشات أمناء الفصول
              </h1>
              <p className="text-xs text-[#755953] mt-0.5">
                قناة جماعية تجمع كافة أمناء الفصول بالإضافة لمحادثات مباشرة مع كل أمين فصل أو متقدم جديد
              </p>
            </div>
            <UnifiedChatHub
              currentUser={currentUser}
              onApproveFromChannel={handleApproveFromChannel}
              initialChannelId={selectedChatChannelId || undefined}
            />
          </section>
        )}
      </main>

      {/* Workspace Creation Wizard Modal */}
      {showWizard && (
        <div className="fixed inset-0 z-50 bg-[#2C1813]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl max-w-2xl w-full max-h-[92vh] overflow-y-auto p-6 sm:p-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-extrabold text-[#2C1813]">
                  إنشاء فصل / غرفة خدمة جديدة
                </h2>
                <p className="text-xs text-[#755953]">
                  تجهيز مساحة عمل معزولة بالكامل وتعيين حساب أمين الفصل فوراً
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowWizard(false)}
                className="p-2 rounded-xl hover:bg-[#FAF6EE] text-[#755953] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateWorkspace} className="space-y-5">
              {/* Logo & Identity */}
              <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-2xl bg-[#FAF6EE] border border-[#EAE0D5]">
                <img
                  src={wizardForm.logoUrl}
                  alt="شعار الفصل"
                  referrerPolicy="no-referrer"
                  className="w-16 h-16 rounded-2xl object-cover border border-[#EAE0D5] bg-[#FFFDF9]"
                />
                <div className="flex-1 text-center sm:text-right">
                  <p className="text-sm font-bold text-[#2C1813]">شعار الكنيسة أو الفصل</p>
                  <p className="text-xs text-[#755953] mt-0.5">
                    يظهر في الهيدر الرئيسي وبوابة المخدومين الخاصة بهذا الفصل فقط
                  </p>
                </div>
                <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#FFFDF9] border border-[#EAE0D5] hover:border-[#7A1523] text-xs font-bold cursor-pointer">
                  <Upload className="w-4 h-4 text-[#7A1523]" />
                  رفع شعار
                  <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold mb-1">اسم الكنيسة</label>
                  <input
                    type="text"
                    required
                    value={wizardForm.churchName}
                    onChange={(e) => setWizardForm({ ...wizardForm, churchName: e.target.value })}
                    placeholder="كنيسة الشهيد مارجرجس"
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm focus:border-[#7A1523] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">اسم الفصل / الخدمة</label>
                  <input
                    type="text"
                    required
                    value={wizardForm.className}
                    onChange={(e) => setWizardForm({ ...wizardForm, className: e.target.value })}
                    placeholder="أسرة الأنبا موسى الأسود"
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm focus:border-[#7A1523] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">
                  المراحل / الصفوف (افصل بينها بفاصلة)
                </label>
                <input
                  type="text"
                  required
                  value={wizardForm.stageConfig}
                  onChange={(e) => setWizardForm({ ...wizardForm, stageConfig: e.target.value })}
                  placeholder="أولى ابتدائي، تانية ابتدائي"
                  className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm focus:border-[#7A1523] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">شعار أو آية الفصل</label>
                <input
                  type="text"
                  value={wizardForm.verse}
                  onChange={(e) => setWizardForm({ ...wizardForm, verse: e.target.value })}
                  className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm focus:border-[#7A1523] focus:outline-none"
                />
              </div>

              <div className="pt-4 border-t border-[#EAE0D5] space-y-4">
                <div className="flex items-center gap-2 text-sm font-extrabold text-[#7A1523]">
                  <Users className="w-4 h-4" />
                  <span>بيانات أمين الفصل (Head Servant)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold mb-1">الاسم الكامل لأمين الفصل</label>
                    <input
                      type="text"
                      required
                      value={wizardForm.headFullName}
                      onChange={(e) => setWizardForm({ ...wizardForm, headFullName: e.target.value })}
                      className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm focus:border-[#7A1523] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">رقم الهاتف</label>
                    <input
                      type="tel"
                      dir="ltr"
                      value={wizardForm.headPhone}
                      onChange={(e) => setWizardForm({ ...wizardForm, headPhone: e.target.value })}
                      className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm text-left font-mono focus:border-[#7A1523] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">اسم المستخدم (حساس لحالة الأحرف)</label>
                    <input
                      type="text"
                      required
                      dir="ltr"
                      value={wizardForm.headUsername}
                      onChange={(e) => setWizardForm({ ...wizardForm, headUsername: e.target.value })}
                      className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm text-left font-mono focus:border-[#7A1523] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">كلمة المرور المؤقتة</label>
                    <input
                      type="text"
                      required
                      minLength={4}
                      dir="ltr"
                      value={wizardForm.headTempPassword}
                      onChange={(e) => setWizardForm({ ...wizardForm, headTempPassword: e.target.value })}
                      placeholder="Temp1234"
                      className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm text-left font-mono focus:border-[#7A1523] focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowWizard(false)}
                  className="px-4 py-2.5 rounded-xl border border-[#EAE0D5] text-xs font-bold text-[#755953] cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-6 py-2.5 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] text-white text-xs font-bold cursor-pointer"
                >
                  {creating ? 'جاري التجهيز...' : 'تدشين وإطلاق الفصل الآن'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Workspace Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-[#2C1813]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-extrabold text-[#7A1523]">تأكيد حذف مساحة الخدمة</h3>
            <p className="text-sm text-[#755953] leading-relaxed">
              هل أنت متأكد من حذف «{deleteTarget.className}» ({deleteTarget.churchName})؟ سيتم حذف كافة المخدومين والخدام والجداول المرتبطة بهذه الغرفة نهائياً.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-xl border border-[#EAE0D5] text-xs font-bold cursor-pointer"
              >
                تراجع
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteWorkspace}
                className="px-4 py-2 rounded-xl bg-[#7A1523] text-white text-xs font-bold cursor-pointer"
              >
                حذف نهائي
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
