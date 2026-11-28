import React, { useMemo, useState } from 'react';
import {
  Award,
  Cake,
  CalendarCheck,
  FileSpreadsheet,
  Megaphone,
  MessageCircle,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type {
  AnnouncementTarget,
  SessionUser,
  Student,
  WorkspaceBundle,
} from '../../types';
import {
  buildWhatsAppUrl,
  exportAttendanceToExcel,
  formatArabicDate,
  getWorkspaceStageNames,
  resolveLogoUrl,
} from '../../utils/api';
import {
  createAnnouncementInFirestore,
  deleteAnnouncementInFirestore,
  recordBulkAttendanceInFirestore,
  recordBulkPointsInFirestore,
} from '../../services/firestoreService';

interface ServantDashboardProps {
  bundle: WorkspaceBundle;
  currentUser: SessionUser;
  onRefresh: () => Promise<void>;
}

const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

export const ServantDashboard: React.FC<ServantDashboardProps> = ({
  bundle,
  currentUser,
  onRefresh,
}) => {
  const { workspace, students, announcements } = bundle;
  const stageNames = useMemo(() => getWorkspaceStageNames(workspace), [workspace]);
  const isAdmin =
    currentUser.role === 'environment_owner' ||
    currentUser.role === 'head_servant' ||
    currentUser.role === 'assistant_head';

  // Modals
  const [showBirthdayModal, setShowBirthdayModal] = useState(false);
  const [birthdayTab, setBirthdayTab] = useState<'today' | 'month' | 'all'>('today');
  const [showAttendanceModal, setShowAttendanceModal] = useState(false);
  const [showPointsModal, setShowPointsModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);

  // Quick Attendance State
  const [attDate, setAttDate] = useState(new Date().toISOString().slice(0, 10));
  const [attSession, setAttSession] = useState<'sunday_school' | 'mass'>('sunday_school');
  const [attGrade, setAttGrade] = useState('all');
  const [attMap, setAttMap] = useState<Record<string, 'present' | 'absent'>>({});

  // Quick Points State
  const [ptsSelectedIds, setPtsSelectedIds] = useState<string[]>([]);
  const [ptsMode, setPtsMode] = useState<'bonus' | 'penalty'>('bonus');
  const [ptsAmount, setPtsAmount] = useState(20);
  const [ptsReason, setPtsReason] = useState('');

  // Excel Export State
  const [expGrade, setExpGrade] = useState('all');
  const [expSession, setExpSession] = useState<'all' | 'mass' | 'sunday_school'>('all');

  // Announcement Form
  const [annForm, setAnnForm] = useState({
    title: '',
    body: '',
    target: 'all' as AnnouncementTarget,
    isUrgent: false,
  });

  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');

  const todayMd = useMemo(() => {
    const now = new Date();
    return { month: now.getMonth() + 1, day: now.getDate() };
  }, []);

  const parseBirthMonthDay = (birthDate: string): { month: number; day: number } | null => {
    if (!birthDate || !birthDate.includes('-')) return null;
    const parts = birthDate.split('-');
    if (parts.length < 3) return null;
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (!month || !day) return null;
    return { month, day };
  };

  const todayBirthdays = useMemo(
    () =>
      students.filter((s) => {
        const md = parseBirthMonthDay(s.birthDate);
        return md && md.month === todayMd.month && md.day === todayMd.day;
      }),
    [students, todayMd]
  );

  const monthBirthdays = useMemo(
    () =>
      students.filter((s) => {
        const md = parseBirthMonthDay(s.birthDate);
        return md && md.month === todayMd.month;
      }),
    [students, todayMd]
  );

  const stageCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of stageNames) map.set(g, 0);
    for (const s of students) {
      map.set(s.grade, (map.get(s.grade) || 0) + 1);
    }
    return Array.from(map.entries());
  }, [students, stageNames]);

  const openAttendanceModal = () => {
    const initial: Record<string, 'present' | 'absent'> = {};
    for (const s of students) initial[s.id] = 'present';
    setAttMap(initial);
    setShowAttendanceModal(true);
  };

  const handleSaveAttendance = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const targetStudents =
        attGrade === 'all' ? students : students.filter((s) => s.grade === attGrade);
      const records = targetStudents.map((s) => ({
        studentId: s.id,
        status: attMap[s.id] || ('present' as const),
      }));
      await recordBulkAttendanceInFirestore(
        workspace.id,
        attDate,
        attSession,
        records,
        currentUser.fullName,
        students
      );
      setShowAttendanceModal(false);
      setFeedback('تم تسجيل الحضور والغياب وتحديث نسب المواظبة.');
      await onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleSavePoints = async (e: React.FormEvent) => {
    e.preventDefault();
    if (ptsSelectedIds.length === 0 || !ptsReason.trim()) return;
    setSaving(true);
    try {
      await recordBulkPointsInFirestore(
        workspace.id,
        ptsSelectedIds,
        ptsAmount,
        ptsMode,
        ptsReason.trim(),
        currentUser.fullName,
        students
      );
      setShowPointsModal(false);
      setPtsSelectedIds([]);
      setPtsReason('');
      setFeedback('تم تحديث رصيد النقاط للمخدومين المختارين.');
      await onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleCreateAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createAnnouncementInFirestore(workspace.id, annForm, currentUser);
      setShowAnnouncementModal(false);
      setAnnForm({ title: '', body: '', target: 'all', isUrgent: false });
      setFeedback('تم نشر الإعلان بنجاح.');
      await onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAnnouncement = async (id: string) => {
    await deleteAnnouncementInFirestore(workspace.id, id);
    await onRefresh();
  };

  const attFilteredStudents =
    attGrade === 'all' ? students : students.filter((s) => s.grade === attGrade);

  const togglePointStudent = (id: string) => {
    setPtsSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-6">
      {feedback && (
        <div className="px-5 py-3 rounded-2xl bg-[#FBF2D8] border border-[#D4AF37]/40 text-xs font-bold text-[#2C1813] flex items-center justify-between">
          <span>{feedback}</span>
          <button type="button" onClick={() => setFeedback('')} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Workspace Branded Hero */}
      <section className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="flex items-start gap-4">
          <img
            src={resolveLogoUrl(workspace.logoUrl)}
            alt={workspace.className}
            referrerPolicy="no-referrer"
            className="w-16 h-16 rounded-2xl object-cover border border-[#EAE0D5] bg-[#FAF6EE] shrink-0"
          />
          <div>
            <p className="text-xs font-bold text-[#A46714]">{workspace.churchName}</p>
            <h1 className="text-2xl sm:text-3xl font-black text-[#2C1813] mt-0.5">
              {workspace.className}
            </h1>
            <p className="text-xs text-[#755953] mt-2 max-w-2xl leading-relaxed">
              {workspace.verse}
            </p>
          </div>
        </div>

        {/* Quick Actions Toolbar */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={openAttendanceModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] text-white text-xs font-bold cursor-pointer"
          >
            <CalendarCheck className="w-4 h-4" />
            تسجيل حضور سريع
          </button>
          <button
            type="button"
            onClick={() => setShowPointsModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#FBF2D8] hover:bg-[#D4AF37]/25 border border-[#D4AF37]/40 text-[#2C1813] text-xs font-bold cursor-pointer"
          >
            <Award className="w-4 h-4 text-[#A46714]" />
            نقاط سريعة
          </button>
          <button
            type="button"
            onClick={() => setShowExportModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#FAF6EE] hover:bg-[#EAE0D5]/50 border border-[#EAE0D5] text-[#2C1813] text-xs font-bold cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
            تصدير Excel
          </button>
        </div>
      </section>

      {/* Today's Birthdays Banner */}
      <section className="bg-[#FBF2D8]/70 border border-[#D4AF37]/40 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[#FFFDF9] border border-[#D4AF37]/40 text-[#A46714] flex items-center justify-center shrink-0">
            <Cake className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-extrabold text-sm text-[#2C1813]">
              مركز أعياد الميلاد ({todayBirthdays.length} اليوم · {monthBirthdays.length} هذا الشهر)
            </h2>
            <p className="text-xs text-[#755953] mt-0.5">
              {todayBirthdays.length > 0
                ? `يحتفل اليوم: ${todayBirthdays.map((b) => b.fullName).join('، ')}`
                : 'لا توجد أعياد ميلاد مسجلة بتاريخ اليوم.'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowBirthdayModal(true)}
          className="px-4 py-2 rounded-xl bg-[#FFFDF9] border border-[#D4AF37]/50 hover:border-[#A46714] text-xs font-bold text-[#A46714] whitespace-nowrap cursor-pointer"
        >
          عرض تقويم الـ 12 شهراً والتهنئة
        </button>
      </section>

      {/* Stage Headcount Breakdown */}
      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-5">
          <p className="text-xs font-semibold text-[#755953]">إجمالي المخدومين</p>
          <p className="text-3xl font-black font-mono tabular-nums text-[#7A1523] mt-1">
            {students.length}
          </p>
        </div>
        <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-5">
          <p className="text-xs font-semibold text-[#755953]">إجمالي الخدام</p>
          <p className="text-3xl font-black font-mono tabular-nums text-[#A46714] mt-1">
            {bundle.servants.length}
          </p>
        </div>
        {stageCounts.map(([stage, count]) => (
          <div key={stage} className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-5">
            <p className="text-xs font-semibold text-[#755953] truncate">{stage}</p>
            <p className="text-3xl font-black font-mono tabular-nums text-[#2C1813] mt-1">
              {count}
            </p>
          </div>
        ))}
      </section>

      {/* Announcements Wall */}
      <section className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-[#7A1523]" />
            <h2 className="font-extrabold text-base text-[#2C1813]">حائط الإعلانات والتنبيهات</h2>
          </div>
          <button
            type="button"
            onClick={() => setShowAnnouncementModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] text-white text-xs font-bold cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            إعلان جديد
          </button>
        </div>

        {announcements.length === 0 ? (
          <p className="text-sm text-[#755953] py-6 text-center">لا توجد إعلانات منشورة في هذا الفصل.</p>
        ) : (
          <div className="divide-y divide-[#EAE0D5]">
            {announcements.map((ann) => (
              <article key={ann.id} className="py-4 first:pt-0 last:pb-0 flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {ann.isUrgent && <span className="font-extrabold text-[#7A1523]">[عاجل]</span>}
                    <h3 className="font-extrabold text-sm text-[#2C1813]">{ann.title}</h3>
                    <span className="text-[#755953]">
                      · {ann.target === 'all' ? 'للجميع' : ann.target === 'students_only' ? 'للمخدومين فقط' : 'للخدام فقط'}
                    </span>
                  </div>
                  <p className="text-xs text-[#755953] leading-relaxed">{ann.body}</p>
                  <p className="text-[11px] text-[#755953] font-mono tabular-nums">
                    {ann.authorName} ({ann.authorRole}) · {formatArabicDate(ann.createdAt)}
                  </p>
                </div>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => handleDeleteAnnouncement(ann.id)}
                    className="p-2 rounded-xl hover:bg-[#FDF2F4] text-[#7A1523] shrink-0 cursor-pointer"
                    title="حذف الإعلان"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Birthday 3-Tab Modal */}
      {showBirthdayModal && (
        <div className="fixed inset-0 z-50 bg-[#2C1813]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl max-w-2xl w-full max-h-[88vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-[#2C1813]">مركز أعياد الميلاد</h3>
              <button
                type="button"
                onClick={() => setShowBirthdayModal(false)}
                className="p-2 rounded-xl hover:bg-[#FAF6EE] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-1 p-1 bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl w-fit">
              {[
                { key: 'today', label: `اليوم (${todayBirthdays.length})` },
                { key: 'month', label: `هذا الشهر (${monthBirthdays.length})` },
                { key: 'all', label: 'الـ 12 شهراً' },
              ].map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setBirthdayTab(t.key as 'today' | 'month' | 'all')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                    birthdayTab === t.key ? 'bg-[#7A1523] text-white' : 'text-[#755953]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {birthdayTab !== 'all' ? (
              <div className="divide-y divide-[#EAE0D5]">
                {(birthdayTab === 'today' ? todayBirthdays : monthBirthdays).length === 0 ? (
                  <p className="py-8 text-center text-sm text-[#755953]">لا توجد أعياد ميلاد في هذه القائمة.</p>
                ) : (
                  (birthdayTab === 'today' ? todayBirthdays : monthBirthdays).map((s) => (
                    <div key={s.id} className="py-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="font-bold text-sm text-[#2C1813]">{s.fullName}</p>
                        <p className="text-xs text-[#755953] font-mono tabular-nums">
                          {s.grade} · {s.birthDate}
                        </p>
                      </div>
                      {(s.parentPhone || s.phone) && (
                        <a
                          href={buildWhatsAppUrl(
                            s.parentPhone || s.phone,
                            `كل سنة وأنت طيب يا ${s.fullName}! أسرة ${workspace.className} تهنئك بعيد ميلادك السعيد.`
                          )}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          تهنئة واتساب
                        </a>
                      )}
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {ARABIC_MONTHS.map((mName, idx) => {
                  const list = students.filter((s) => parseBirthMonthDay(s.birthDate)?.month === idx + 1);
                  return (
                    <div key={mName} className="p-3.5 rounded-2xl bg-[#FAF6EE] border border-[#EAE0D5]">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-bold text-xs text-[#7A1523]">{mName}</span>
                        <span className="text-xs font-mono tabular-nums text-[#755953]">{list.length}</span>
                      </div>
                      {list.length === 0 ? (
                        <p className="text-[11px] text-[#755953]">—</p>
                      ) : (
                        <ul className="text-xs space-y-1">
                          {list.map((s) => (
                            <li key={s.id} className="flex items-center justify-between">
                              <span className="truncate">{s.fullName}</span>
                              <span className="font-mono text-[11px] text-[#755953]">{s.birthDate.slice(5)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Quick Attendance Modal */}
      {showAttendanceModal && (
        <div className="fixed inset-0 z-50 bg-[#2C1813]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-[#2C1813]">تسجيل الحضور والغياب السريع</h3>
              <button type="button" onClick={() => setShowAttendanceModal(false)} className="cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveAttendance} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  type="date"
                  value={attDate}
                  onChange={(e) => setAttDate(e.target.value)}
                  className="bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-sm font-mono"
                />
                <select
                  value={attSession}
                  onChange={(e) => setAttSession(e.target.value as 'sunday_school' | 'mass')}
                  className="bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-sm"
                >
                  <option value="sunday_school">مدارس الأحد</option>
                  <option value="mass">القداس الإلهي</option>
                </select>
                <select
                  value={attGrade}
                  onChange={(e) => setAttGrade(e.target.value)}
                  className="bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-sm"
                >
                  <option value="all">كل المراحل</option>
                  {stageNames.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>

              <div className="divide-y divide-[#EAE0D5] max-h-80 overflow-y-auto border border-[#EAE0D5] rounded-2xl px-4">
                {attFilteredStudents.map((s: Student) => (
                  <div key={s.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-bold text-sm text-[#2C1813]">{s.fullName}</p>
                      <p className="text-[11px] text-[#755953]">{s.grade}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setAttMap((p) => ({ ...p, [s.id]: 'present' }))}
                        className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                          attMap[s.id] !== 'absent'
                            ? 'bg-emerald-700 text-white'
                            : 'bg-[#FAF6EE] text-[#755953]'
                        }`}
                      >
                        حاضر
                      </button>
                      <button
                        type="button"
                        onClick={() => setAttMap((p) => ({ ...p, [s.id]: 'absent' }))}
                        className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                          attMap[s.id] === 'absent'
                            ? 'bg-[#7A1523] text-white'
                            : 'bg-[#FAF6EE] text-[#755953]'
                        }`}
                      >
                        غائب
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAttendanceModal(false)}
                  className="px-4 py-2 rounded-xl border border-[#EAE0D5] text-xs font-bold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl bg-[#7A1523] text-white text-xs font-bold cursor-pointer"
                >
                  {saving ? 'جاري الحفظ...' : 'حفظ كشف الحضور'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Points Modal */}
      {showPointsModal && (
        <div className="fixed inset-0 z-50 bg-[#2C1813]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-[#2C1813]">تعديل النقاط السريع</h3>
              <button type="button" onClick={() => setShowPointsModal(false)} className="cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSavePoints} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={ptsMode}
                  onChange={(e) => setPtsMode(e.target.value as 'bonus' | 'penalty')}
                  className="bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-sm font-bold"
                >
                  <option value="bonus">إضافة مكافأة (+)</option>
                  <option value="penalty">خصم نقاط (-)</option>
                </select>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  required
                  value={ptsAmount}
                  onChange={(e) => setPtsAmount(Number(e.target.value))}
                  className="bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-sm font-mono"
                />
              </div>

              <input
                type="text"
                required
                value={ptsReason}
                onChange={(e) => setPtsReason(e.target.value)}
                placeholder="سبب التعديل (إلزامي، مثال: حفظ مزمور الأسبوع)"
                className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm"
              />

              <div className="max-h-60 overflow-y-auto border border-[#EAE0D5] rounded-2xl divide-y divide-[#EAE0D5] px-3">
                {students.map((s) => (
                  <label key={s.id} className="py-2 flex items-center justify-between text-xs cursor-pointer">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={ptsSelectedIds.includes(s.id)}
                        onChange={() => togglePointStudent(s.id)}
                      />
                      <span className="font-bold">{s.fullName}</span>
                    </div>
                    <span className="font-mono tabular-nums text-[#755953]">{s.points} نقطة</span>
                  </label>
                ))}
              </div>

              <button
                type="submit"
                disabled={saving || ptsSelectedIds.length === 0}
                className="w-full py-2.5 rounded-xl bg-[#7A1523] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {saving ? 'جاري التنفيذ...' : `تطبيق على (${ptsSelectedIds.length}) مخدوم`}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Excel Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 bg-[#2C1813]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-[#2C1813]">تصدير تقرير الحضور (Excel)</h3>
              <button type="button" onClick={() => setShowExportModal(false)} className="cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <select
                value={expGrade}
                onChange={(e) => setExpGrade(e.target.value)}
                className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm"
              >
                <option value="all">جميع المراحل</option>
                {stageNames.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
              <select
                value={expSession}
                onChange={(e) => setExpSession(e.target.value as 'all' | 'mass' | 'sunday_school')}
                className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm"
              >
                <option value="all">جميع اللقاءات (قداس + مدارس أحد)</option>
                <option value="sunday_school">مدارس الأحد فقط</option>
                <option value="mass">القداس الإلهي فقط</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  exportAttendanceToExcel(students, workspace.className, expGrade, expSession);
                  setShowExportModal(false);
                }}
                className="w-full py-2.5 rounded-xl bg-[#7A1523] text-white text-xs font-bold cursor-pointer"
              >
                تحميل ملف .xlsx الآن
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Announcement Modal */}
      {showAnnouncementModal && (
        <div className="fixed inset-0 z-50 bg-[#2C1813]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-[#2C1813]">نشر إعلان جديد للفصل</h3>
              <button type="button" onClick={() => setShowAnnouncementModal(false)} className="cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateAnnouncement} className="space-y-4">
              <input
                type="text"
                required
                value={annForm.title}
                onChange={(e) => setAnnForm({ ...annForm, title: e.target.value })}
                placeholder="عنوان الإعلان"
                className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm"
              />
              <textarea
                rows={3}
                required
                value={annForm.body}
                onChange={(e) => setAnnForm({ ...annForm, body: e.target.value })}
                placeholder="تفاصيل الإعلان..."
                className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm"
              />
              <div className="flex items-center justify-between gap-3">
                <select
                  value={annForm.target}
                  onChange={(e) => setAnnForm({ ...annForm, target: e.target.value as AnnouncementTarget })}
                  className="bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2 text-xs font-bold"
                >
                  <option value="all">للجميع (الخدام والمخدومين)</option>
                  <option value="students_only">للمخدومين وأولياء الأمور</option>
                  <option value="servants_only">للخدام فقط</option>
                </select>
                <label className="flex items-center gap-2 text-xs font-bold text-[#7A1523] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={annForm.isUrgent}
                    onChange={(e) => setAnnForm({ ...annForm, isUrgent: e.target.checked })}
                  />
                  إعلان عاجل
                </label>
              </div>
              <button
                type="submit"
                disabled={saving}
                className="w-full py-2.5 rounded-xl bg-[#7A1523] text-white text-xs font-bold cursor-pointer"
              >
                {saving ? 'جاري النشر...' : 'نشر الإعلان'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
