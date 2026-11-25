import React, { useState } from 'react';
import {
  ArrowLeftRight,
  Calendar,
  HeartHandshake,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import type {
  MonthlySchedule,
  ServiceSegments,
  SessionUser,
  VisitationStatus,
  WorkspaceBundle,
} from '../../types';
import { apiFetch, buildWhatsAppUrl } from '../../utils/api';

interface SchedulesAndVisitationTabProps {
  bundle: WorkspaceBundle;
  currentUser: SessionUser;
  onRefresh: () => Promise<void>;
}

const SEGMENT_LABELS: Array<{ key: keyof ServiceSegments; label: string }> = [
  { key: 'openingPrayer', label: 'صلاة الافتتاح' },
  { key: 'hymns', label: 'الألحان والتسبحة' },
  { key: 'coptic', label: 'اللغة القبطية' },
  { key: 'rites', label: 'الطقس الكنسي' },
  { key: 'behavior', label: 'السلوكيات والمواقف' },
  { key: 'weeklyReadings', label: 'قراءات الأسبوع' },
  { key: 'visitationReview', label: 'مراجعة الافتقاد' },
];

const VISITATION_STATUS_LABELS: Record<VisitationStatus, string> = {
  pending: 'لم يتم بعد',
  called: 'تم الاتصال',
  visited: 'تمت الزيارة',
  no_answer: 'لم يرد',
  special_care: 'متابعة خاصة',
};

export const SchedulesAndVisitationTab: React.FC<SchedulesAndVisitationTabProps> = ({
  bundle,
  currentUser,
  onRefresh,
}) => {
  const { workspace, monthlySchedules, visitationSchedules, servants, students } = bundle;
  const isAdmin =
    currentUser.role === 'environment_owner' ||
    currentUser.role === 'head_servant' ||
    currentUser.role === 'assistant_head';

  const [subTab, setSubTab] = useState<'schedule' | 'visitation'>('schedule');
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');

  const [schForm, setSchForm] = useState<Partial<MonthlySchedule>>({
    date: new Date().toISOString().slice(0, 10),
    grade: workspace.grades[0] || '',
    lessonTitle: '',
    memoryVerse: '',
    primaryTeacherId: servants[0]?.id || '',
    backupTeacherId: servants[1]?.id || servants[0]?.id || '',
    notes: '',
    segments: {
      openingPrayer: true,
      hymns: true,
      coptic: false,
      rites: false,
      behavior: true,
      weeklyReadings: true,
      visitationReview: true,
    },
  });

  // Manual Visitation Assignment
  const [manualVisitStudent, setManualVisitStudent] = useState(students[0]?.id || '');
  const [manualVisitServant, setManualVisitServant] = useState(servants[0]?.id || '');

  const openNewScheduleModal = () => {
    setSchForm({
      date: new Date().toISOString().slice(0, 10),
      grade: workspace.grades[0] || '',
      lessonTitle: '',
      memoryVerse: '',
      primaryTeacherId: servants[0]?.id || '',
      backupTeacherId: servants[1]?.id || servants[0]?.id || '',
      notes: '',
      segments: {
        openingPrayer: true,
        hymns: true,
        coptic: false,
        rites: false,
        behavior: true,
        weeklyReadings: true,
        visitationReview: true,
      },
    });
    setShowScheduleModal(true);
  };

  const openEditScheduleModal = (sch: MonthlySchedule) => {
    setSchForm({ ...sch });
    setShowScheduleModal(true);
  };

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch(`/api/workspaces/${workspace.id}/schedules`, {
        method: 'POST',
        body: JSON.stringify(schForm),
      });
      setShowScheduleModal(false);
      setFeedback('تم حفظ جدول الخدمة بنجاح.');
      await onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleSwapTeachers = async (scheduleId: string) => {
    await apiFetch(`/api/workspaces/${workspace.id}/schedules/${scheduleId}/swap`, {
      method: 'POST',
    });
    setFeedback('تم تبديل الخادم الأساسي والاحتياطي بنقرة واحدة.');
    await onRefresh();
  };

  const handlePruneExpired = async () => {
    await apiFetch(`/api/workspaces/${workspace.id}/schedules`, {
      method: 'POST',
      body: JSON.stringify({ pruneExpired: true }),
    });
    setFeedback('تم تنظيف المواعيد المنتهية الأقدم من أسبوعين.');
    await onRefresh();
  };

  const handleDeleteSchedule = async (scheduleId: string) => {
    await apiFetch(`/api/workspaces/${workspace.id}/schedules/${scheduleId}`, {
      method: 'DELETE',
    });
    await onRefresh();
  };

  const handleAutoDistribute = async () => {
    setSaving(true);
    try {
      await apiFetch(`/api/workspaces/${workspace.id}/visitations/auto-distribute`, {
        method: 'POST',
        body: JSON.stringify({ weekLabel: 'الأسبوع الحالي' }),
      });
      setFeedback('تم التوزيع العادل للافتقاد على جميع الخدام.');
      await onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleManualAssignVisit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualVisitStudent || !manualVisitServant) return;
    await apiFetch(`/api/workspaces/${workspace.id}/visitations`, {
      method: 'POST',
      body: JSON.stringify({
        studentId: manualVisitStudent,
        servantId: manualVisitServant,
        status: 'pending',
      }),
    });
    setFeedback('تم تعيين مهمة الافتقاد يدوياً.');
    await onRefresh();
  };

  const handleUpdateVisitStatus = async (visitId: string, status: VisitationStatus, notes?: string) => {
    await apiFetch(`/api/workspaces/${workspace.id}/visitations`, {
      method: 'POST',
      body: JSON.stringify({ id: visitId, status, notes }),
    });
    await onRefresh();
  };

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

      {/* Sub-Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl">
          <button
            type="button"
            onClick={() => setSubTab('schedule')}
            className={`px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${
              subTab === 'schedule' ? 'bg-[#7A1523] text-white' : 'text-[#755953]'
            }`}
          >
            جدول الخدمة الشهري ({monthlySchedules.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('visitation')}
            className={`px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${
              subTab === 'visitation' ? 'bg-[#7A1523] text-white' : 'text-[#755953]'
            }`}
          >
            لوحة الافتقاد الأسبوعي ({visitationSchedules.length})
          </button>
        </div>

        {subTab === 'schedule' ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePruneExpired}
              className="px-3.5 py-2 rounded-xl border border-[#EAE0D5] bg-[#FFFDF9] hover:bg-[#FAF6EE] text-xs font-bold text-[#755953] cursor-pointer"
            >
              تنظيف المواعيد المنتهية
            </button>
            <button
              type="button"
              onClick={openNewScheduleModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] text-white text-xs font-bold cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              إضافة لقاء بالجدول
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleAutoDistribute}
            disabled={saving || students.length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            توزيع تلقائي عادل على الخدام
          </button>
        )}
      </div>

      {subTab === 'schedule' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {monthlySchedules.length === 0 ? (
            <div className="md:col-span-2 bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-12 text-center text-sm text-[#755953]">
              لا توجد حصص مجدولة بعد. أضف أول لقاء من الزر أعلاه.
            </div>
          ) : (
            monthlySchedules.map((sch) => (
              <article
                key={sch.id}
                className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-5 flex flex-col justify-between gap-4"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono tabular-nums font-bold text-[#A46714] flex items-center gap-1.5">
                      <Calendar className="w-4 h-4" />
                      {sch.date}
                    </span>
                    <span className="font-bold text-[#7A1523]">{sch.grade}</span>
                  </div>

                  <h3 className="font-extrabold text-base text-[#2C1813]">{sch.lessonTitle}</h3>
                  {sch.memoryVerse && (
                    <p className="text-xs bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl p-3 text-[#2C1813]">
                      {sch.memoryVerse}
                    </p>
                  )}

                  <div className="text-xs space-y-1 pt-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[#755953]">الخادم الأساسي:</span>
                      <span className="font-bold text-[#2C1813]">{sch.primaryTeacherName}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#755953]">الخادم الاحتياطي:</span>
                      <span className="font-semibold text-[#755953]">{sch.backupTeacherName}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5 pt-2 border-t border-[#EAE0D5]">
                    {SEGMENT_LABELS.filter((seg) => sch.segments?.[seg.key]).map((seg) => (
                      <span key={seg.key} className="text-[11px] text-[#755953] font-semibold">
                        ✓ {seg.label}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-3 border-t border-[#EAE0D5]">
                  <button
                    type="button"
                    onClick={() => handleSwapTeachers(sch.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#FAF6EE] border border-[#EAE0D5] hover:border-[#A46714] text-xs font-bold text-[#2C1813] cursor-pointer"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5 text-[#A46714]" />
                    تبديل الأساسي والاحتياطي
                  </button>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => openEditScheduleModal(sch)}
                      className="px-3 py-1.5 rounded-xl border border-[#EAE0D5] text-xs font-bold hover:bg-[#FAF6EE] cursor-pointer"
                    >
                      تعديل
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => handleDeleteSchedule(sch.id)}
                        className="p-1.5 rounded-xl border border-[#EAE0D5] hover:bg-[#FDF2F4] text-[#7A1523] cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      ) : (
        /* Permanent Weekly Visitation Board */
        <div className="space-y-5">
          {students.length > 0 && servants.length > 0 && (
            <form
              onSubmit={handleManualAssignVisit}
              className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-4 flex flex-wrap items-center gap-3"
            >
              <HeartHandshake className="w-5 h-5 text-[#7A1523]" />
              <span className="text-xs font-bold text-[#2C1813]">تعيين يدوي:</span>
              <select
                value={manualVisitStudent}
                onChange={(e) => setManualVisitStudent(e.target.value)}
                className="bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-xs font-bold"
              >
                {students.map((s) => (
                  <option key={s.id} value={s.id}>{s.fullName}</option>
                ))}
              </select>
              <span className="text-xs text-[#755953]">إلى الخادم</span>
              <select
                value={manualVisitServant}
                onChange={(e) => setManualVisitServant(e.target.value)}
                className="bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-xs font-bold"
              >
                {servants.map((srv) => (
                  <option key={srv.id} value={srv.id}>{srv.fullName}</option>
                ))}
              </select>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-[#7A1523] text-white text-xs font-bold cursor-pointer"
              >
                تثبيت التعيين
              </button>
            </form>
          )}

          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl overflow-hidden">
            {visitationSchedules.length === 0 ? (
              <div className="p-12 text-center text-sm text-[#755953]">
                لا توجد مهام افتقاد موزعة. اضغط «توزيع تلقائي عادل» لتوزيع المخدومين على الخدام.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <thead className="bg-[#FAF6EE] border-b border-[#EAE0D5] text-xs text-[#755953]">
                    <tr>
                      <th className="py-3 px-4 font-bold">المخدوم</th>
                      <th className="py-3 px-4 font-bold">المرحلة</th>
                      <th className="py-3 px-4 font-bold">الخادم المكلف</th>
                      <th className="py-3 px-4 font-bold">حالة الافتقاد</th>
                      <th className="py-3 px-4 font-bold text-left">تواصل</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAE0D5]">
                    {visitationSchedules.map((vis) => (
                      <tr key={vis.id} className="hover:bg-[#FAF6EE]/60">
                        <td className="py-3 px-4 font-bold text-[#2C1813]">{vis.studentName}</td>
                        <td className="py-3 px-4 text-xs text-[#755953]">{vis.studentGrade}</td>
                        <td className="py-3 px-4 text-xs font-bold text-[#7A1523]">{vis.servantName}</td>
                        <td className="py-3 px-4">
                          <select
                            value={vis.status}
                            onChange={(e) =>
                              handleUpdateVisitStatus(vis.id, e.target.value as VisitationStatus, vis.notes)
                            }
                            className="bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-2.5 py-1.5 text-xs font-bold"
                          >
                            {Object.entries(VISITATION_STATUS_LABELS).map(([val, lbl]) => (
                              <option key={val} value={val}>{lbl}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-3 px-4 text-left">
                          {(vis.parentPhone || vis.studentPhone) && (
                            <div className="inline-flex items-center gap-1.5">
                              <a
                                href={`tel:${vis.parentPhone || vis.studentPhone}`}
                                className="p-1.5 rounded-lg border border-[#EAE0D5] text-[#2C1813]"
                              >
                                <Phone className="w-3.5 h-3.5" />
                              </a>
                              <a
                                href={buildWhatsAppUrl(
                                  vis.parentPhone || vis.studentPhone,
                                  `سلام ونعمة، نفتقد ${vis.studentName} من خدمة ${workspace.className}.`
                                )}
                                target="_blank"
                                rel="noreferrer"
                                className="p-1.5 rounded-lg border border-[#EAE0D5] text-emerald-700"
                              >
                                <MessageCircle className="w-3.5 h-3.5" />
                              </a>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Schedule Create/Edit Modal */}
      {showScheduleModal && (
        <div className="fixed inset-0 z-50 bg-[#2C1813]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-[#2C1813]">تفاصيل لقاء الخدمة الأسبوعي</h3>
              <button type="button" onClick={() => setShowScheduleModal(false)} className="cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveSchedule} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="date"
                  required
                  value={schForm.date || ''}
                  onChange={(e) => setSchForm({ ...schForm, date: e.target.value })}
                  className="bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-sm font-mono"
                />
                <select
                  value={schForm.grade || ''}
                  onChange={(e) => setSchForm({ ...schForm, grade: e.target.value })}
                  className="bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-sm"
                >
                  {workspace.grades.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>
              <input
                type="text"
                required
                value={schForm.lessonTitle || ''}
                onChange={(e) => setSchForm({ ...schForm, lessonTitle: e.target.value })}
                placeholder="عنوان الدرس"
                className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm"
              />
              <input
                type="text"
                value={schForm.memoryVerse || ''}
                onChange={(e) => setSchForm({ ...schForm, memoryVerse: e.target.value })}
                placeholder="آية الحفظ"
                className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm"
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">الخادم الأساسي</label>
                  <select
                    value={schForm.primaryTeacherId || ''}
                    onChange={(e) => setSchForm({ ...schForm, primaryTeacherId: e.target.value })}
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-sm"
                  >
                    {servants.map((srv) => (
                      <option key={srv.id} value={srv.id}>{srv.fullName}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">الخادم الاحتياطي</label>
                  <select
                    value={schForm.backupTeacherId || ''}
                    onChange={(e) => setSchForm({ ...schForm, backupTeacherId: e.target.value })}
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-sm"
                  >
                    {servants.map((srv) => (
                      <option key={srv.id} value={srv.id}>{srv.fullName}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-2 border-t border-[#EAE0D5]">
                <p className="text-xs font-bold text-[#755953] mb-2">فقرات الخدمة الـ 7:</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {SEGMENT_LABELS.map((seg) => (
                    <label
                      key={seg.key}
                      className="flex items-center gap-2 text-xs font-semibold p-2 rounded-xl bg-[#FAF6EE] cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(schForm.segments?.[seg.key])}
                        onChange={(e) =>
                          setSchForm({
                            ...schForm,
                            segments: {
                              ...(schForm.segments as ServiceSegments),
                              [seg.key]: e.target.checked,
                            },
                          })
                        }
                      />
                      <span>{seg.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full py-2.5 rounded-xl bg-[#7A1523] text-white text-xs font-bold cursor-pointer"
              >
                {saving ? 'جاري الحفظ...' : 'حفظ اللقاء'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
