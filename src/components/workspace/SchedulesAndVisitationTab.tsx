import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeftRight,
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  FileText,
  HeartHandshake,
  Home,
  MessageCircle,
  Phone,
  PhoneCall,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import type {
  MonthlySchedule,
  Servant,
  ServiceSegmentDetailsMap,
  ServiceSegments,
  SessionUser,
  StageLessonPlan,
  VisitationRecord,
  VisitationStatus,
  WorkspaceBundle,
  WorkspaceStage,
} from '../../types';
import {
  buildWhatsAppUrl,
  formatLiveArabicDate,
  getWorkspaceStageNames,
  getWorkspaceStages,
} from '../../utils/api';
import {
  autoDistributeVisitationInFirestore,
  bulkAssignVisitationInFirestore,
  deleteMonthlyScheduleInFirestore,
  pruneExpiredSchedulesInFirestore,
  resetVisitationStatusesInFirestore,
  saveMonthlyScheduleInFirestore,
  swapMonthlyScheduleTeachersInFirestore,
  updateVisitationInFirestore,
} from '../../services/firestoreService';

interface SchedulesAndVisitationTabProps {
  bundle: WorkspaceBundle;
  currentUser: SessionUser;
  onRefresh: () => Promise<void>;
}

const SEGMENT_LABELS: Array<{ key: keyof ServiceSegments; label: string }> = [
  { key: 'openingPrayer', label: 'صلاة البداية' },
  { key: 'hymns', label: 'الألحان' },
  { key: 'coptic', label: 'القبطي' },
  { key: 'rites', label: 'الطقس' },
  { key: 'behavior', label: 'السلوك' },
  { key: 'weeklyReadings', label: 'مسئول قراءات الأسبوع' },
  { key: 'visitationReview', label: 'مسئول عن مراجعة الافتقاد' },
];

const DEFAULT_ENABLED_SEGMENTS = new Set<keyof ServiceSegments>([
  'openingPrayer',
  'hymns',
  'behavior',
  'weeklyReadings',
  'visitationReview',
]);

interface ScheduleFormState {
  id?: string;
  date: string;
  stageLessons: StageLessonPlan[];
  segmentDetails: ServiceSegmentDetailsMap;
  notes: string;
}

const VISITATION_STATUS_LABELS: Record<VisitationStatus, string> = {
  pending: 'في الانتظار',
  called: 'تم هاتفياً',
  visited: 'زيارة منزلية',
  no_answer: 'لم يرد',
  special_care: 'رعاية خاصة',
};

const VISITATION_STATUS_STYLES: Record<VisitationStatus, string> = {
  pending: 'bg-[#FBF2D8] border-[#D4AF37]/50 text-[#A46714]',
  called: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  visited: 'bg-sky-50 border-sky-200 text-sky-800',
  no_answer: 'bg-[#FAF6EE] border-[#EAE0D5] text-[#755953]',
  special_care: 'bg-[#FDF2F4] border-[#7A1523]/30 text-[#7A1523]',
};

const ROLE_ARABIC: Record<Servant['role'], string> = {
  head_servant: 'أمين الفصل',
  assistant_head: 'أمين مساعد',
  servant: 'خادم',
};

function formatArabicAssignedCount(count: number): string {
  if (count === 0) return '0 مخدومين';
  if (count === 1) return 'مخدوم واحد';
  if (count === 2) return 'مخدومان';
  if (count <= 10) return `${count} مخدومين`;
  return `${count} مخدوماً`;
}

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'خ';
  if (parts.length === 1) return parts[0].slice(0, 2);
  return `${parts[0][0]}${parts[1][0]}`;
}

function buildDefaultSegmentDetails(existing?: MonthlySchedule): ServiceSegmentDetailsMap {
  const result = {} as ServiceSegmentDetailsMap;
  for (const seg of SEGMENT_LABELS) {
    const existingDetail = existing?.segmentDetails?.[seg.key];
    const enabled =
      existingDetail !== undefined
        ? Boolean(existingDetail.enabled)
        : existing?.segments
        ? Boolean(existing.segments[seg.key])
        : DEFAULT_ENABLED_SEGMENTS.has(seg.key);
    result[seg.key] = {
      enabled,
      primaryServantId: existingDetail?.primaryServantId || '',
      primaryServantName: existingDetail?.primaryServantName || '',
      backupServantId: existingDetail?.backupServantId || '',
      backupServantName: existingDetail?.backupServantName || '',
    };
  }
  return result;
}

function buildInitialStageLessons(
  stages: WorkspaceStage[],
  servants: Servant[],
  existing?: MonthlySchedule
): StageLessonPlan[] {
  return stages.map((stg, idx) => {
    const matched = existing?.stageLessons?.find(
      (sl) => sl.stageId === stg.id || sl.stageName === stg.name
    );
    if (matched) {
      return {
        stageId: stg.id,
        stageName: stg.name,
        lessonTitle: matched.lessonTitle || '',
        memoryVerse: matched.memoryVerse || '',
        primaryTeacherId: matched.primaryTeacherId || servants[0]?.id || '',
        primaryTeacherName: matched.primaryTeacherName || servants[0]?.fullName || '',
        customPrimaryTeacherName: matched.customPrimaryTeacherName || '',
        backupTeacherId: matched.backupTeacherId || '',
        backupTeacherName: matched.backupTeacherName || '-- بدون خادم احتياطي --',
      };
    }

    if (existing && !existing.stageLessons?.length && (idx === 0 || existing.grade === stg.name)) {
      return {
        stageId: stg.id,
        stageName: stg.name,
        lessonTitle: existing.lessonTitle || '',
        memoryVerse: existing.memoryVerse || '',
        primaryTeacherId: existing.primaryTeacherId || servants[0]?.id || '',
        primaryTeacherName: existing.primaryTeacherName || servants[0]?.fullName || '',
        customPrimaryTeacherName: '',
        backupTeacherId: existing.backupTeacherId || '',
        backupTeacherName: existing.backupTeacherName || '-- بدون خادم احتياطي --',
      };
    }

    return {
      stageId: stg.id,
      stageName: stg.name,
      lessonTitle: '',
      memoryVerse: '',
      primaryTeacherId: servants[0]?.id || '',
      primaryTeacherName: servants[0]?.fullName || '',
      customPrimaryTeacherName: '',
      backupTeacherId: '',
      backupTeacherName: '-- بدون خادم احتياطي --',
    };
  });
}

export const SchedulesAndVisitationTab: React.FC<SchedulesAndVisitationTabProps> = ({
  bundle,
  currentUser,
  onRefresh,
}) => {
  const { workspace, monthlySchedules, visitationSchedules, servants, students } = bundle;
  const workspaceStages = useMemo(() => getWorkspaceStages(workspace), [workspace]);
  const stageNames = useMemo(() => getWorkspaceStageNames(workspace), [workspace]);
  const isAdmin =
    currentUser.role === 'environment_owner' ||
    currentUser.role === 'head_servant' ||
    currentUser.role === 'assistant_head';

  const [subTab, setSubTab] = useState<'schedule' | 'visitation'>('schedule');
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  // Multi-card Schedule form state
  const [schForm, setSchForm] = useState<ScheduleFormState>(() => ({
    date: new Date().toISOString().slice(0, 10),
    stageLessons: buildInitialStageLessons(workspaceStages, servants),
    segmentDetails: buildDefaultSegmentDetails(),
    notes: '',
  }));

  // Visitation filters & inline notes draft
  const [searchQuery, setSearchQuery] = useState('');
  const [servantFilter, setServantFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | VisitationStatus>('all');
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  const [savingVisitId, setSavingVisitId] = useState<string>('');
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Multi-select Bulk Assignment Modal state
  const [assignModalServant, setAssignModalServant] = useState<Servant | null>(null);
  const [assignSelectedStudentIds, setAssignSelectedStudentIds] = useState<string[]>([]);
  const [assignSearch, setAssignSearch] = useState('');
  const [assignGradeFilter, setAssignGradeFilter] = useState('all');

  const openNewScheduleModal = () => {
    setError('');
    setSchForm({
      date: new Date().toISOString().slice(0, 10),
      stageLessons: buildInitialStageLessons(workspaceStages, servants),
      segmentDetails: buildDefaultSegmentDetails(),
      notes: '',
    });
    setShowScheduleModal(true);
  };

  const openEditScheduleModal = (sch: MonthlySchedule) => {
    setError('');
    setSchForm({
      id: sch.id,
      date: sch.date,
      stageLessons: buildInitialStageLessons(workspaceStages, servants, sch),
      segmentDetails: buildDefaultSegmentDetails(sch),
      notes: sch.notes || '',
    });
    setShowScheduleModal(true);
  };

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const hasAnyLesson = schForm.stageLessons.some((sl) => sl.lessonTitle.trim().length > 0);
    if (!hasAnyLesson) {
      setError('يرجى إدخال موضوع الدرس لمرحلة واحدة على الأقل.');
      return;
    }

    const missingCustom = schForm.stageLessons.find(
      (sl) => sl.primaryTeacherId === '__custom__' && !sl.customPrimaryTeacherName?.trim()
    );
    if (missingCustom) {
      setError(`يرجى كتابة اسم الخادم الأساسي المخصص لمرحلة «${missingCustom.stageName}».`);
      return;
    }

    setSaving(true);
    try {
      const segmentsBool = SEGMENT_LABELS.reduce((acc, seg) => {
        acc[seg.key] = Boolean(schForm.segmentDetails[seg.key]?.enabled);
        return acc;
      }, {} as ServiceSegments);

      const firstWithTitle =
        schForm.stageLessons.find((sl) => sl.lessonTitle.trim()) || schForm.stageLessons[0];

      await saveMonthlyScheduleInFirestore(
        workspace.id,
        {
          id: schForm.id,
          date: schForm.date,
          dateLabel: formatLiveArabicDate(schForm.date),
          grade: schForm.stageLessons.map((s) => s.stageName).join('، '),
          lessonTitle: firstWithTitle?.lessonTitle || '',
          memoryVerse: firstWithTitle?.memoryVerse || '',
          primaryTeacherId: firstWithTitle?.primaryTeacherId || '',
          primaryTeacherName:
            firstWithTitle?.primaryTeacherId === '__custom__'
              ? firstWithTitle.customPrimaryTeacherName?.trim() || ''
              : firstWithTitle?.primaryTeacherName || '',
          backupTeacherId: firstWithTitle?.backupTeacherId || '',
          backupTeacherName: firstWithTitle?.backupTeacherName || '-- بدون خادم احتياطي --',
          stageLessons: schForm.stageLessons,
          segments: segmentsBool,
          segmentDetails: schForm.segmentDetails,
          notes: schForm.notes.trim(),
        },
        monthlySchedules
      );
      setShowScheduleModal(false);
      setFeedback('تم حفظ جدول الخدمة الأسبوعي بنجاح.');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ جدول الخدمة.');
    } finally {
      setSaving(false);
    }
  };

  const handleSwapTeachers = async (scheduleId: string, stageIndex = 0) => {
    setError('');
    try {
      const sch = monthlySchedules.find((s) => s.id === scheduleId);
      if (!sch) return;
      await swapMonthlyScheduleTeachersInFirestore(workspace.id, sch, stageIndex);
      setFeedback('تم تبديل الخادم الأساسي والاحتياطي بنقرة واحدة.');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تبديل الخدام.');
    }
  };

  const handlePruneExpired = async () => {
    setError('');
    try {
      await pruneExpiredSchedulesInFirestore(workspace.id, monthlySchedules);
      setFeedback('تم تنظيف المواعيد المنتهية الأقدم من أسبوعين.');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تنظيف المواعيد.');
    }
  };

  const handleDeleteSchedule = async (scheduleId: string) => {
    setError('');
    try {
      await deleteMonthlyScheduleInFirestore(workspace.id, scheduleId);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حذف اللقاء.');
    }
  };

  // --- Visitation Actions ---
  const handleAutoDistribute = async () => {
    setSaving(true);
    setError('');
    try {
      await autoDistributeVisitationInFirestore(
        workspace.id,
        'الأسبوع الحالي',
        students,
        servants,
        visitationSchedules
      );
      setFeedback('تم التوزيع التلقائي المتوازن للافتقاد على جميع الخدام بنجاح.');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر التوزيع التلقائي.');
    } finally {
      setSaving(false);
    }
  };

  const handleResetAllStatuses = async () => {
    setSaving(true);
    setError('');
    try {
      await resetVisitationStatusesInFirestore(
        workspace.id,
        'أسبوع جديد',
        visitationSchedules
      );
      setShowResetConfirm(false);
      setFeedback('تم تصفير جميع حالات المتابعة إلى «في الانتظار» مع الحفاظ على التوزيع الثابت.');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تصفير الحالات.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateVisit = async (
    visitId: string,
    status: VisitationStatus,
    notes?: string
  ) => {
    setSavingVisitId(visitId);
    setError('');
    try {
      await updateVisitationInFirestore(workspace.id, visitId, status, notes);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحديث حالة الافتقاد.');
    } finally {
      setSavingVisitId('');
    }
  };

  const openBulkAssignModal = (srv: Servant) => {
    const currentIds = visitationSchedules
      .filter((v) => v.servantId === srv.id)
      .map((v) => v.studentId);
    setAssignSelectedStudentIds(currentIds);
    setAssignSearch('');
    setAssignGradeFilter('all');
    setAssignModalServant(srv);
  };

  const handleSaveBulkAssign = async () => {
    if (!assignModalServant) return;
    setSaving(true);
    setError('');
    try {
      await bulkAssignVisitationInFirestore(
        workspace.id,
        assignModalServant,
        assignSelectedStudentIds,
        'الأسبوع الحالي',
        students,
        visitationSchedules
      );
      setFeedback(`تم تحديث قائمة المكلفين للخادم «${assignModalServant.fullName}» بنجاح.`);
      setAssignModalServant(null);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ التوزيع.');
    } finally {
      setSaving(false);
    }
  };

  // --- Computed Visitation Stats & Filtered Lists ---
  const visitationStats = useMemo(() => {
    const assignedStudentIds = new Set(visitationSchedules.map((v) => v.studentId));
    const unassignedCount = students.filter((s) => !assignedStudentIds.has(s.id)).length;
    const calledCount = visitationSchedules.filter((v) => v.status === 'called').length;
    const visitedCount = visitationSchedules.filter((v) => v.status === 'visited').length;
    const pendingCount = visitationSchedules.filter((v) => v.status === 'pending').length;
    return {
      totalServants: servants.length,
      totalStudents: students.length,
      totalAssigned: visitationSchedules.length,
      unassignedCount,
      calledCount,
      visitedCount,
      pendingCount,
    };
  }, [visitationSchedules, servants.length, students]);

  const myServant = useMemo(
    () =>
      servants.find(
        (s) =>
          (currentUser.linkedProfileId && s.id === currentUser.linkedProfileId) ||
          s.username === currentUser.username
      ) || null,
    [servants, currentUser]
  );

  const myVisitations = useMemo(
    () =>
      myServant
        ? visitationSchedules.filter((v) => v.servantId === myServant.id)
        : [],
    [visitationSchedules, myServant]
  );

  const assignmentByStudentId = useMemo(() => {
    const map = new Map<string, VisitationRecord>();
    for (const v of visitationSchedules) {
      map.set(v.studentId, v);
    }
    return map;
  }, [visitationSchedules]);

  const filteredServantCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return servants
      .filter((srv) => servantFilter === 'all' || srv.id === servantFilter)
      .map((srv) => {
        const allForServant = visitationSchedules.filter((v) => v.servantId === srv.id);
        const filteredItems = allForServant.filter((vis) => {
          const matchesStatus = statusFilter === 'all' || vis.status === statusFilter;
          const matchesSearch =
            !q ||
            vis.studentName.toLowerCase().includes(q) ||
            vis.studentGrade.toLowerCase().includes(q) ||
            vis.studentPhone.toLowerCase().includes(q) ||
            vis.parentPhone.toLowerCase().includes(q) ||
            srv.fullName.toLowerCase().includes(q);
          return matchesStatus && matchesSearch;
        });
        return {
          servant: srv,
          totalCount: allForServant.length,
          items: filteredItems,
        };
      })
      .filter((entry) => {
        if (!q && statusFilter === 'all') return true;
        return entry.items.length > 0;
      });
  }, [servants, visitationSchedules, servantFilter, statusFilter, searchQuery]);

  const modalFilteredStudents = useMemo(() => {
    const q = assignSearch.trim().toLowerCase();
    return students.filter((s) => {
      const matchesGrade = assignGradeFilter === 'all' || s.grade === assignGradeFilter;
      const matchesSearch =
        !q ||
        s.fullName.toLowerCase().includes(q) ||
        s.phone.toLowerCase().includes(q) ||
        s.parentPhone.toLowerCase().includes(q);
      return matchesGrade && matchesSearch;
    });
  }, [students, assignSearch, assignGradeFilter]);

  const renderVisitationItem = (vis: VisitationRecord, compact = false) => {
    const contactPhone = vis.parentPhone || vis.studentPhone;
    const currentNote = notesDraft[vis.id] !== undefined ? notesDraft[vis.id] : vis.notes;
    const noteDirty =
      notesDraft[vis.id] !== undefined && notesDraft[vis.id] !== (vis.notes || '');
    const isBusy = savingVisitId === vis.id;

    return (
      <div
        key={vis.id}
        className={`rounded-xl border border-[#EAE0D5] p-3.5 space-y-2.5 ${
          compact ? 'bg-[#FFFDF9]' : 'bg-[#FAF6EE]/65'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-bold text-sm text-[#2C1813] truncate">{vis.studentName}</p>
            <p className="text-[11px] text-[#755953] flex items-center gap-2 mt-0.5">
              <span>{vis.studentGrade}</span>
              {contactPhone && (
                <span className="font-mono tabular-nums" dir="ltr">
                  · {contactPhone}
                </span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <select
              value={vis.status}
              disabled={isBusy}
              onChange={(e) =>
                void handleUpdateVisit(vis.id, e.target.value as VisitationStatus, currentNote)
              }
              className={`border rounded-lg px-2.5 py-1 text-xs font-bold cursor-pointer focus:outline-none ${
                VISITATION_STATUS_STYLES[vis.status]
              }`}
            >
              {Object.entries(VISITATION_STATUS_LABELS).map(([val, lbl]) => (
                <option key={val} value={val}>
                  {lbl}
                </option>
              ))}
            </select>

            {contactPhone && (
              <>
                <a
                  href={`tel:${contactPhone}`}
                  className="p-1.5 rounded-lg border border-[#EAE0D5] bg-[#FFFDF9] hover:border-[#7A1523] text-[#2C1813]"
                  title="اتصال هاتفي"
                >
                  <Phone className="w-3.5 h-3.5" />
                </a>
                <a
                  href={buildWhatsAppUrl(
                    contactPhone,
                    `سلام ونعمة، نفتقد ${vis.studentName} من خدمة ${workspace.className}.`
                  )}
                  target="_blank"
                  rel="noreferrer"
                  className="p-1.5 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700"
                  title="مراسلة واتساب"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                </a>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={currentNote}
            onChange={(e) =>
              setNotesDraft((prev) => ({ ...prev, [vis.id]: e.target.value }))
            }
            placeholder="أضف ملاحظة سريعة للافتقاد..."
            className="flex-1 bg-[#FFFDF9] border border-[#EAE0D5] focus:border-[#A46714] focus:outline-none rounded-lg px-2.5 py-1.5 text-xs text-[#2C1813]"
          />
          {noteDirty && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void handleUpdateVisit(vis.id, vis.status, currentNote)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#7A1523] text-white text-[11px] font-bold cursor-pointer shrink-0"
            >
              <Check className="w-3 h-3" />
              حفظ
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {feedback && (
        <div className="px-4 py-3 rounded-2xl bg-[#FBF2D8] border border-[#D4AF37]/40 text-xs font-bold text-[#2C1813] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#A46714] shrink-0" />
            <span>{feedback}</span>
          </div>
          <button type="button" onClick={() => setFeedback('')} className="cursor-pointer">
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
          <button type="button" onClick={() => setError('')} className="cursor-pointer">
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

        {subTab === 'schedule' && (
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
        )}
      </div>

      {subTab === 'schedule' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {monthlySchedules.length === 0 ? (
            <div className="lg:col-span-2 bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-12 text-center text-sm text-[#755953]">
              لا توجد حصص مجدولة بعد. أضف أول لقاء من الزر أعلاه.
            </div>
          ) : (
            monthlySchedules.map((sch) => {
              const stagePlans =
                sch.stageLessons && sch.stageLessons.length > 0
                  ? sch.stageLessons
                  : [
                      {
                        stageId: 'stg_legacy',
                        stageName: sch.grade || stageNames[0] || 'المرحلة',
                        lessonTitle: sch.lessonTitle,
                        memoryVerse: sch.memoryVerse,
                        primaryTeacherId: sch.primaryTeacherId,
                        primaryTeacherName: sch.primaryTeacherName,
                        backupTeacherId: sch.backupTeacherId,
                        backupTeacherName: sch.backupTeacherName,
                      },
                    ];
              const activeSegments = SEGMENT_LABELS.filter((seg) =>
                sch.segmentDetails ? sch.segmentDetails[seg.key]?.enabled : sch.segments?.[seg.key]
              );

              return (
                <article
                  key={sch.id}
                  className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-5 flex flex-col justify-between gap-4"
                >
                  <div className="space-y-4">
                    {/* Schedule Date Header */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#EAE0D5]">
                      <div className="flex items-center gap-2">
                        <div className="w-9 h-9 rounded-xl bg-[#FBF2D8] border border-[#D4AF37]/40 text-[#A46714] flex items-center justify-center shrink-0">
                          <Calendar className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="font-extrabold text-sm text-[#2C1813]">
                            {sch.dateLabel || formatLiveArabicDate(sch.date)}
                          </p>
                          <p className="text-[11px] font-mono tabular-nums text-[#755953]">
                            {sch.date}
                          </p>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg bg-[#FDF2F4] border border-[#7A1523]/15 text-[11px] font-bold text-[#7A1523]">
                        {stagePlans.length} {stagePlans.length === 1 ? 'مرحلة' : stagePlans.length === 2 ? 'مرحلتين' : 'مراحل'}
                      </span>
                    </div>

                    {/* Per-Stage Lessons Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {stagePlans.map((sl, idx) => (
                        <div
                          key={`${sch.id}_${sl.stageId}_${idx}`}
                          className="rounded-xl bg-[#FAF6EE] border border-[#EAE0D5] p-3.5 space-y-2 flex flex-col justify-between"
                        >
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-extrabold text-[#7A1523]">
                                {sl.stageName}
                              </span>
                              {sl.backupTeacherId && (
                                <button
                                  type="button"
                                  onClick={() => void handleSwapTeachers(sch.id, idx)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#FFFDF9] border border-[#EAE0D5] hover:border-[#A46714] text-[10px] font-bold text-[#A46714] cursor-pointer"
                                  title="تبديل الأساسي والاحتياطي لهذه المرحلة"
                                >
                                  <ArrowLeftRight className="w-3 h-3" />
                                  تبديل
                                </button>
                              )}
                            </div>
                            <h4 className="font-extrabold text-sm text-[#2C1813] leading-snug">
                              {sl.lessonTitle || 'لم يُحدد موضوع الدرس'}
                            </h4>
                            {sl.memoryVerse && (
                              <p className="text-[11px] bg-[#FFFDF9] border border-[#EAE0D5] rounded-lg p-2 text-[#755953] leading-relaxed">
                                {sl.memoryVerse}
                              </p>
                            )}
                          </div>

                          <div className="text-[11px] space-y-1 pt-2 border-t border-[#EAE0D5]">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[#755953]">الأساسي:</span>
                              <span className="font-bold text-[#2C1813] truncate">
                                {sl.primaryTeacherName || 'غير محدد'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[#755953]">الاحتياطي:</span>
                              <span className="font-semibold text-[#755953] truncate">
                                {sl.backupTeacherId ? sl.backupTeacherName : '—'}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Active Spiritual Day Segments */}
                    {activeSegments.length > 0 && (
                      <div className="space-y-2 pt-2 border-t border-[#EAE0D5]">
                        <p className="text-[11px] font-extrabold text-[#755953]">
                          فقرات اليوم الروحي المفعّلة ({activeSegments.length}):
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {activeSegments.map((seg) => {
                            const detail = sch.segmentDetails?.[seg.key];
                            return (
                              <div
                                key={seg.key}
                                className="px-3 py-2 rounded-xl bg-[#FBF2D8]/45 border border-[#D4AF37]/30 text-[11px] space-y-0.5"
                              >
                                <div className="font-extrabold text-[#2C1813]">✓ {seg.label}</div>
                                {(detail?.primaryServantName || detail?.backupServantName) && (
                                  <div className="text-[#755953] flex flex-wrap gap-x-2">
                                    {detail.primaryServantName && (
                                      <span>
                                        أساسي:{' '}
                                        <strong className="text-[#2C1813]">
                                          {detail.primaryServantName}
                                        </strong>
                                      </span>
                                    )}
                                    {detail.backupServantName && (
                                      <span>بديل: {detail.backupServantName}</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Notes */}
                    {sch.notes && (
                      <div className="text-xs bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl p-3 text-[#755953]">
                        <span className="font-bold text-[#2C1813] ml-1">ملاحظات:</span>
                        {sch.notes}
                      </div>
                    )}
                  </div>

                  {/* Card Footer */}
                  <div className="flex items-center justify-between gap-2 pt-3 border-t border-[#EAE0D5]">
                    {stagePlans[0]?.backupTeacherId ? (
                      <button
                        type="button"
                        onClick={() => void handleSwapTeachers(sch.id, 0)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#FAF6EE] border border-[#EAE0D5] hover:border-[#A46714] text-xs font-bold text-[#2C1813] cursor-pointer"
                      >
                        <ArrowLeftRight className="w-3.5 h-3.5 text-[#A46714]" />
                        تبديل خدام المرحلة الأولى
                      </button>
                    ) : (
                      <div />
                    )}
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEditScheduleModal(sch)}
                        className="px-3.5 py-1.5 rounded-xl border border-[#EAE0D5] text-xs font-bold hover:bg-[#FAF6EE] cursor-pointer"
                      >
                        تعديل
                      </button>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => handleDeleteSchedule(sch.id)}
                          className="p-1.5 rounded-xl border border-[#EAE0D5] hover:bg-[#FDF2F4] text-[#7A1523] cursor-pointer"
                          title="حذف الأسبوع"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
      ) : (
        /* Permanent Weekly Visitation Board (Servant-Centric Cards) */
        <div className="space-y-6">
          {/* 1. Top Header & Action Bar */}
          <section className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="w-11 h-11 rounded-2xl bg-[#FDF2F4] border border-[#7A1523]/15 text-[#7A1523] flex items-center justify-center shrink-0">
                <HeartHandshake className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-extrabold text-[#2C1813]">لوحة الافتقاد الأسبوعي الثابتة</h2>
                <p className="text-xs text-[#755953] mt-1 leading-relaxed max-w-2xl">
                  توزيع ثابت ومستمر لكل خادم بمخدومين محددين للاطمئنان عليهم تليفونياً وبالزيارات المنزلية، ولا يُحذف تلقائياً.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={handleAutoDistribute}
                disabled={saving || students.length === 0 || servants.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                توزيع تلقائي متوازن
              </button>
              <button
                type="button"
                onClick={() => setShowResetConfirm(true)}
                disabled={saving || visitationSchedules.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#FAF6EE] hover:bg-[#FBF2D8] disabled:opacity-50 border border-[#EAE0D5] text-[#2C1813] text-xs font-bold cursor-pointer"
              >
                <RotateCcw className="w-4 h-4 text-[#A46714]" />
                تصفير حالات المتابعة
              </button>
            </div>
          </section>

          {/* 2. 5 Live Summary Stat Cards */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
            {/* Card 1: ملخص التوزيع الثابت */}
            <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-4 flex flex-col justify-between gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-[#2C1813]">ملخص التوزيع الثابت</span>
                <Users className="w-4 h-4 text-[#7A1523]" />
              </div>
              <div className="flex items-center justify-between text-xs text-[#755953]">
                <span>عدد الخدام: <strong className="font-mono tabular-nums text-[#2C1813]">{visitationStats.totalServants}</strong></span>
                <span>إجمالي المخدومين: <strong className="font-mono tabular-nums text-[#2C1813]">{visitationStats.totalStudents}</strong></span>
              </div>
              {visitationStats.unassignedCount > 0 ? (
                <div className="px-2.5 py-1 rounded-lg bg-[#FDF2F4] border border-[#7A1523]/20 text-[11px] font-bold text-[#7A1523] font-mono tabular-nums">
                  يوجد {visitationStats.unassignedCount} مخدوم غير موزعين بعد
                </div>
              ) : (
                <div className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px] font-bold text-emerald-800">
                  جميع المخدومين موزعين على الخدام
                </div>
              )}
            </div>

            {/* Card 2: مكلف بالافتقاد */}
            <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#755953]">مكلف بالافتقاد</span>
                <UserCheck className="w-4 h-4 text-[#7A1523]" />
              </div>
              <p className="text-3xl font-black font-mono tabular-nums text-[#7A1523] mt-2">
                {visitationStats.totalAssigned}
              </p>
            </div>

            {/* Card 3: تم هاتفياً (Green) */}
            <div className="bg-emerald-50/75 border border-emerald-200 rounded-2xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-800">تم هاتفياً</span>
                <PhoneCall className="w-4 h-4 text-emerald-700" />
              </div>
              <p className="text-3xl font-black font-mono tabular-nums text-emerald-800 mt-2">
                {visitationStats.calledCount}
              </p>
            </div>

            {/* Card 4: زيارة منزلية (Blue) */}
            <div className="bg-sky-50/80 border border-sky-200 rounded-2xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-sky-800">زيارة منزلية</span>
                <Home className="w-4 h-4 text-sky-700" />
              </div>
              <p className="text-3xl font-black font-mono tabular-nums text-sky-800 mt-2">
                {visitationStats.visitedCount}
              </p>
            </div>

            {/* Card 5: في الانتظار (Amber/Yellow) */}
            <div className="bg-[#FBF2D8]/80 border border-[#D4AF37]/50 rounded-2xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#A46714]">في الانتظار</span>
                <Clock className="w-4 h-4 text-[#A46714]" />
              </div>
              <p className="text-3xl font-black font-mono tabular-nums text-[#A46714] mt-2">
                {visitationStats.pendingCount}
              </p>
            </div>
          </section>

          {/* 3. "My Assigned Visitation" Personal Banner */}
          {myServant && (
            <section className="bg-[#FBF2D8]/70 border border-[#D4AF37]/60 rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-extrabold text-[#2C1813]">
                    تكليفات افتقادك الثابتة يا {myServant.fullName}
                  </h3>
                  <p className="text-xs text-[#755953] mt-0.5">
                    حدّث حالة التواصل والملاحظات مباشرة أو تواصل بنقرة واحدة
                  </p>
                </div>
                <span className="px-3 py-1 rounded-xl bg-[#FFFDF9] border border-[#D4AF37]/50 text-xs font-bold text-[#A46714] font-mono tabular-nums">
                  {formatArabicAssignedCount(myVisitations.length)}
                </span>
              </div>

              {myVisitations.length === 0 ? (
                <div className="bg-[#FFFDF9]/90 border border-[#D4AF37]/30 rounded-xl p-4 text-xs text-[#755953]">
                  لا يوجد مخدومون مكلفون باسمك حالياً. يمكنك استخدام زر «تعديل المكلفين» في بطاقتك بالأسفل أو «توزيع تلقائي متوازن».
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {myVisitations.map((vis) => renderVisitationItem(vis, true))}
                </div>
              )}
            </section>
          )}

          {/* 4. Servant Cards Grid & Filters */}
          <section className="space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-extrabold text-[#2C1813]">
                  قائمة توزيع الخدام وتكليفاتهم الثابتة
                </h3>
                <p className="text-xs text-[#755953]">
                  راجع تكليفات كل خادم أو عدّل قائمة المخدومين المكلفين له مباشرة
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative min-w-[220px] flex-1 sm:flex-initial">
                  <Search className="w-4 h-4 text-[#755953] absolute right-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="ابحث باسم مخدوم أو رقم..."
                    className="w-full bg-[#FFFDF9] border border-[#EAE0D5] focus:border-[#7A1523] focus:outline-none rounded-xl pr-9 pl-3 py-2 text-xs"
                  />
                </div>

                <select
                  value={servantFilter}
                  onChange={(e) => setServantFilter(e.target.value)}
                  className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-xl px-3 py-2 text-xs font-bold text-[#2C1813]"
                >
                  <option value="all">كل الخدام</option>
                  {servants.map((srv) => (
                    <option key={srv.id} value={srv.id}>
                      {srv.fullName}
                    </option>
                  ))}
                </select>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as 'all' | VisitationStatus)}
                  className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-xl px-3 py-2 text-xs font-bold text-[#2C1813]"
                >
                  <option value="all">كل حالات الافتقاد</option>
                  {Object.entries(VISITATION_STATUS_LABELS).map(([val, lbl]) => (
                    <option key={val} value={val}>
                      {lbl}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {servants.length === 0 ? (
              <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-10 text-center text-sm text-[#755953]">
                لا يوجد خدام مسجلون في هذا الفصل بعد.
              </div>
            ) : filteredServantCards.length === 0 ? (
              <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-10 text-center text-sm text-[#755953]">
                لا توجد نتائج مطابقة للبحث أو الفلتر المحدد.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {filteredServantCards.map(({ servant, totalCount, items }) => (
                  <article
                    key={servant.id}
                    className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-5 flex flex-col gap-4"
                  >
                    {/* Servant Card Header */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pb-3.5 border-b border-[#EAE0D5]">
                      <div className="flex items-center gap-3 min-w-0">
                        {servant.avatarUrl ? (
                          <img
                            src={servant.avatarUrl}
                            alt={servant.fullName}
                            referrerPolicy="no-referrer"
                            className="w-11 h-11 rounded-full object-cover border border-[#EAE0D5] shrink-0"
                          />
                        ) : (
                          <div className="w-11 h-11 rounded-full bg-[#FDF2F4] border border-[#7A1523]/20 text-[#7A1523] font-extrabold text-sm flex items-center justify-center shrink-0">
                            {getInitials(servant.fullName)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <h4 className="font-extrabold text-sm text-[#2C1813] truncate">
                            {servant.fullName}
                          </h4>
                          <p className="text-xs text-[#755953] truncate">
                            {ROLE_ARABIC[servant.role]} · {servant.assignedGrade}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="px-2.5 py-1 rounded-lg bg-[#FAF6EE] border border-[#EAE0D5] text-[11px] font-bold text-[#A46714] font-mono tabular-nums">
                          {formatArabicAssignedCount(totalCount)}
                        </span>
                        <button
                          type="button"
                          onClick={() => openBulkAssignModal(servant)}
                          className="px-3 py-1.5 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] text-white text-xs font-bold cursor-pointer"
                        >
                          تعديل المكلفين
                        </button>
                      </div>
                    </div>

                    {/* Assigned Students List */}
                    {items.length === 0 ? (
                      <div className="py-6 text-center text-xs text-[#755953] bg-[#FAF6EE]/60 rounded-xl border border-dashed border-[#EAE0D5]">
                        لا يوجد مخدومون مكلفون لهذا الخادم بعد. اضغط «تعديل المكلفين» لاختيار المخدومين.
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {items.map((vis) => renderVisitationItem(vis))}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Multi-Select Student Assignment Modal */}
      {assignModalServant && (
        <div className="fixed inset-0 z-50 bg-[#2C1813]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-5 border-b border-[#EAE0D5] flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-extrabold text-[#2C1813]">
                  تعديل المكلفين — {assignModalServant.fullName}
                </h3>
                <p className="text-xs text-[#755953] mt-0.5">
                  اختر المخدومين المكلفين لهذا الخادم بشكل ثابت (تم تحديد{' '}
                  <strong className="font-mono tabular-nums text-[#7A1523]">
                    {assignSelectedStudentIds.length}
                  </strong>{' '}
                  من أصل {students.length})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAssignModalServant(null)}
                className="p-2 rounded-xl hover:bg-[#FAF6EE] text-[#755953] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-3 border-b border-[#EAE0D5] bg-[#FAF6EE]/60">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-4 h-4 text-[#755953] absolute right-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={assignSearch}
                    onChange={(e) => setAssignSearch(e.target.value)}
                    placeholder="ابحث باسم المخدوم أو رقم الهاتف..."
                    className="w-full bg-[#FFFDF9] border border-[#EAE0D5] focus:border-[#7A1523] focus:outline-none rounded-xl pr-9 pl-3 py-2 text-xs"
                  />
                </div>
                <select
                  value={assignGradeFilter}
                  onChange={(e) => setAssignGradeFilter(e.target.value)}
                  className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-xl px-3 py-2 text-xs font-bold"
                >
                  <option value="all">كل المراحل</option>
                  {stageNames.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-[#755953]">
                  النتائج الظاهرة: <strong className="font-mono tabular-nums">{modalFilteredStudents.length}</strong>
                </span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      const visibleIds = modalFilteredStudents.map((s) => s.id);
                      setAssignSelectedStudentIds((prev) =>
                        Array.from(new Set([...prev, ...visibleIds]))
                      );
                    }}
                    className="font-bold text-[#7A1523] hover:underline cursor-pointer"
                  >
                    تحديد الظاهرين
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const visibleSet = new Set(modalFilteredStudents.map((s) => s.id));
                      setAssignSelectedStudentIds((prev) => prev.filter((id) => !visibleSet.has(id)));
                    }}
                    className="font-bold text-[#755953] hover:underline cursor-pointer"
                  >
                    إلغاء تحديد الظاهرين
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-[#EAE0D5] px-5">
              {modalFilteredStudents.length === 0 ? (
                <div className="py-10 text-center text-sm text-[#755953]">
                  لا يوجد مخدومون مطابقون للبحث.
                </div>
              ) : (
                modalFilteredStudents.map((stu) => {
                  const checked = assignSelectedStudentIds.includes(stu.id);
                  const existingVis = assignmentByStudentId.get(stu.id);
                  const assignedElsewhere =
                    existingVis && existingVis.servantId !== assignModalServant.id
                      ? existingVis.servantName
                      : null;

                  return (
                    <label
                      key={stu.id}
                      className="py-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-[#FAF6EE]/60 px-2 rounded-xl"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setAssignSelectedStudentIds((prev) =>
                                prev.includes(stu.id) ? prev : [...prev, stu.id]
                              );
                            } else {
                              setAssignSelectedStudentIds((prev) =>
                                prev.filter((id) => id !== stu.id)
                              );
                            }
                          }}
                          className="w-4 h-4 accent-[#7A1523] cursor-pointer"
                        />
                        <div className="min-w-0">
                          <p className="font-bold text-sm text-[#2C1813] truncate">{stu.fullName}</p>
                          <p className="text-xs text-[#755953]">
                            {stu.grade}
                            {(stu.parentPhone || stu.phone) && (
                              <span className="font-mono mr-2" dir="ltr">
                                · {stu.parentPhone || stu.phone}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>

                      {assignedElsewhere && (
                        <span className="text-[11px] font-semibold text-[#A46714] shrink-0">
                          مكلف حالياً مع: {assignedElsewhere}
                        </span>
                      )}
                    </label>
                  );
                })
              )}
            </div>

            <div className="px-6 py-4 border-t border-[#EAE0D5] bg-[#FAF6EE] flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setAssignModalServant(null)}
                className="px-4 py-2 rounded-xl border border-[#EAE0D5] bg-[#FFFDF9] text-xs font-bold text-[#755953] cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSaveBulkAssign()}
                className="px-5 py-2 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
              >
                {saving
                  ? 'جاري الحفظ...'
                  : `حفظ التكليفات (${assignSelectedStudentIds.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Reset Statuses Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 bg-[#2C1813]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-extrabold text-[#2C1813]">تصفير حالات المتابعة لأسبوع جديد</h3>
            <p className="text-sm text-[#755953] leading-relaxed">
              سيتم إعادة ضبط حالة الافتقاد لجميع المخدومين إلى «في الانتظار» لبدء متابعة الأسبوع الجديد، مع الإبقاء على توزيع المخدومين الثابت على خدامهم دون حذف.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 rounded-xl border border-[#EAE0D5] text-xs font-bold text-[#755953] cursor-pointer"
              >
                تراجع
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleResetAllStatuses()}
                className="px-5 py-2 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] text-white text-xs font-bold cursor-pointer"
              >
                {saving ? 'جاري التصفير...' : 'تأكيد التصفير'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rich Multi-Card Weekly Service Schedule Modal */}
      {showScheduleModal && (
        <div className="fixed inset-0 z-50 bg-[#2C1813]/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-[#EAE0D5] bg-[#FAF6EE] flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-extrabold text-[#2C1813]">
                  {schForm.id ? 'تعديل أسبوع في الجدول' : 'إضافة أسبوع جديد في الجدول'}
                </h3>
                <p className="text-xs text-[#755953] mt-0.5">
                  تنظيم الدروس والآيات والخدام لكل مرحلة وفقرات اليوم الروحي السبعة
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowScheduleModal(false)}
                className="p-2 rounded-xl hover:bg-[#FFFDF9] text-[#755953] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveSchedule} className="overflow-y-auto p-6 space-y-6">
              {/* 1. Date Picker + Live Arabic Date Label */}
              <div className="p-4 rounded-2xl bg-[#FAF6EE] border border-[#EAE0D5] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="sm:w-64">
                  <label className="block text-xs font-extrabold text-[#2C1813] mb-1.5">
                    تاريخ لقاء الخدمة
                  </label>
                  <input
                    type="date"
                    required
                    value={schForm.date}
                    onChange={(e) => setSchForm((prev) => ({ ...prev, date: e.target.value }))}
                    className="w-full bg-[#FFFDF9] border border-[#EAE0D5] focus:border-[#7A1523] focus:outline-none rounded-xl px-3.5 py-2 text-sm font-mono"
                  />
                </div>
                <div className="flex-1 bg-[#FBF2D8]/75 border border-[#D4AF37]/45 rounded-xl px-4 py-3 flex items-center gap-2.5">
                  <Calendar className="w-4 h-4 text-[#A46714] shrink-0" />
                  <div className="text-xs">
                    <span className="text-[#755953] ml-1.5">التسمية الظاهرة:</span>
                    <strong className="font-extrabold text-[#2C1813]">
                      {formatLiveArabicDate(schForm.date)}
                    </strong>
                  </div>
                </div>
              </div>

              {/* 2. Dynamic Per-Stage Lesson & Teachers Cards */}
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-extrabold text-[#2C1813] flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-[#7A1523]" />
                    <span>موضوع الدرس والآية وخدام الدرس لكل مرحلة</span>
                  </h4>
                  <span className="text-[11px] font-mono tabular-nums font-bold text-[#A46714]">
                    {schForm.stageLessons.length}{' '}
                    {schForm.stageLessons.length === 1
                      ? 'مرحلة'
                      : schForm.stageLessons.length === 2
                      ? 'مرحلتين'
                      : 'مراحل'}
                  </span>
                </div>

                <div
                  className={`grid grid-cols-1 md:grid-cols-2 ${
                    schForm.stageLessons.length >= 3 ? 'xl:grid-cols-3' : ''
                  } gap-4`}
                >
                  {schForm.stageLessons.map((sl, idx) => {
                    const updateStage = (patch: Partial<StageLessonPlan>) => {
                      setSchForm((prev) => ({
                        ...prev,
                        stageLessons: prev.stageLessons.map((item, i) =>
                          i === idx ? { ...item, ...patch } : item
                        ),
                      }));
                    };

                    return (
                      <div
                        key={`${sl.stageId}_${idx}`}
                        className="bg-[#FAF6EE] border border-[#EAE0D5] rounded-2xl p-4 space-y-3"
                      >
                        <div className="flex items-center justify-between pb-2 border-b border-[#EAE0D5]">
                          <span className="font-extrabold text-sm text-[#7A1523]">
                            {sl.stageName}
                          </span>
                          <span className="text-[11px] font-mono tabular-nums font-bold text-[#A46714]">
                            #{idx + 1}
                          </span>
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-[#2C1813] mb-1">
                            موضوع درس {sl.stageName}
                          </label>
                          <input
                            type="text"
                            value={sl.lessonTitle}
                            onChange={(e) => updateStage({ lessonTitle: e.target.value })}
                            placeholder={`أدخل عنوان درس ${sl.stageName}...`}
                            className="w-full bg-[#FFFDF9] border border-[#EAE0D5] focus:border-[#7A1523] focus:outline-none rounded-xl px-3 py-2 text-sm"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-[#2C1813] mb-1">
                            آية {sl.stageName} للحفظ
                          </label>
                          <input
                            type="text"
                            value={sl.memoryVerse}
                            onChange={(e) => updateStage({ memoryVerse: e.target.value })}
                            placeholder="نص الآية والشاهد..."
                            className="w-full bg-[#FFFDF9] border border-[#EAE0D5] focus:border-[#7A1523] focus:outline-none rounded-xl px-3 py-2 text-sm"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-[#2C1813] mb-1">
                            الخادم الأساسي
                          </label>
                          <select
                            value={sl.primaryTeacherId}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === '__custom__') {
                                updateStage({
                                  primaryTeacherId: '__custom__',
                                  primaryTeacherName: sl.customPrimaryTeacherName || '',
                                });
                              } else {
                                const srv = servants.find((s) => s.id === val);
                                updateStage({
                                  primaryTeacherId: val,
                                  primaryTeacherName: srv?.fullName || '',
                                  customPrimaryTeacherName: '',
                                });
                              }
                            }}
                            className="w-full bg-[#FFFDF9] border border-[#EAE0D5] focus:border-[#7A1523] focus:outline-none rounded-xl px-3 py-2 text-sm"
                          >
                            {servants.map((srv) => (
                              <option key={srv.id} value={srv.id}>
                                {srv.fullName}
                              </option>
                            ))}
                            <option value="__custom__">-- كتابة اسم مخصص --</option>
                          </select>

                          {sl.primaryTeacherId === '__custom__' && (
                            <input
                              type="text"
                              value={sl.customPrimaryTeacherName || ''}
                              onChange={(e) =>
                                updateStage({
                                  customPrimaryTeacherName: e.target.value,
                                  primaryTeacherName: e.target.value,
                                })
                              }
                              placeholder="اكتب اسم الخادم أو الضيف المخصص..."
                              className="mt-2 w-full bg-[#FFFDF9] border border-[#D4AF37]/60 focus:border-[#7A1523] focus:outline-none rounded-xl px-3 py-2 text-xs font-semibold"
                            />
                          )}
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-[#2C1813] mb-1">
                            الخادم الاحتياطي
                          </label>
                          <select
                            value={sl.backupTeacherId}
                            onChange={(e) => {
                              const val = e.target.value;
                              const srv = servants.find((s) => s.id === val);
                              updateStage({
                                backupTeacherId: val,
                                backupTeacherName: srv?.fullName || '-- بدون خادم احتياطي --',
                              });
                            }}
                            className="w-full bg-[#FFFDF9] border border-[#EAE0D5] focus:border-[#7A1523] focus:outline-none rounded-xl px-3 py-2 text-sm"
                          >
                            <option value="">-- بدون خادم احتياطي --</option>
                            {servants.map((srv) => (
                              <option key={srv.id} value={srv.id}>
                                {srv.fullName}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* 3. 7 Optional Spiritual Day Segment Cards */}
              <section className="space-y-3 pt-2 border-t border-[#EAE0D5]">
                <h4 className="text-sm font-extrabold text-[#2C1813] flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#A46714]" />
                  <span>فقرات اليوم الروحي الاختيارية</span>
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  {SEGMENT_LABELS.map((seg) => {
                    const detail = schForm.segmentDetails[seg.key];
                    const updateSegment = (
                      patch: Partial<ServiceSegmentDetailsMap[keyof ServiceSegments]>
                    ) => {
                      setSchForm((prev) => ({
                        ...prev,
                        segmentDetails: {
                          ...prev.segmentDetails,
                          [seg.key]: {
                            ...prev.segmentDetails[seg.key],
                            ...patch,
                          },
                        },
                      }));
                    };

                    return (
                      <div
                        key={seg.key}
                        className={`rounded-2xl border p-3.5 space-y-2.5 transition-colors ${
                          detail.enabled
                            ? 'bg-[#FFFDF9] border-[#D4AF37]/55'
                            : 'bg-[#FAF6EE]/65 border-[#EAE0D5] opacity-75'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#EAE0D5]">
                          <span className="font-extrabold text-xs text-[#2C1813]">
                            {seg.label}
                          </span>
                          <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#7A1523] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={detail.enabled}
                              onChange={(e) => updateSegment({ enabled: e.target.checked })}
                              className="w-4 h-4 accent-[#7A1523] cursor-pointer"
                            />
                            <span>مفعّلة</span>
                          </label>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-[#755953] mb-1">
                            أساسي
                          </label>
                          <select
                            disabled={!detail.enabled}
                            value={detail.primaryServantId}
                            onChange={(e) => {
                              const val = e.target.value;
                              const srv = servants.find((s) => s.id === val);
                              updateSegment({
                                primaryServantId: val,
                                primaryServantName: srv?.fullName || '',
                              });
                            }}
                            className="w-full bg-[#FAF6EE] border border-[#EAE0D5] disabled:opacity-60 rounded-xl px-2.5 py-1.5 text-xs"
                          >
                            <option value="">-- اختر الخادم --</option>
                            {servants.map((srv) => (
                              <option key={srv.id} value={srv.id}>
                                {srv.fullName}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-[#755953] mb-1">
                            بديل / احتياطي
                          </label>
                          <select
                            disabled={!detail.enabled}
                            value={detail.backupServantId}
                            onChange={(e) => {
                              const val = e.target.value;
                              const srv = servants.find((s) => s.id === val);
                              updateSegment({
                                backupServantId: val,
                                backupServantName: srv?.fullName || '',
                              });
                            }}
                            className="w-full bg-[#FAF6EE] border border-[#EAE0D5] disabled:opacity-60 rounded-xl px-2.5 py-1.5 text-xs"
                          >
                            <option value="">-- بدون بديل --</option>
                            {servants.map((srv) => (
                              <option key={srv.id} value={srv.id}>
                                {srv.fullName}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* 4. Notes & Supplies */}
              <section className="space-y-1.5 pt-2 border-t border-[#EAE0D5]">
                <label className="text-xs font-extrabold text-[#2C1813] flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-[#7A1523]" />
                  <span>ملاحظات ومستلزمات</span>
                </label>
                <textarea
                  rows={3}
                  value={schForm.notes}
                  onChange={(e) => setSchForm((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="أدخل أي تجهيزات، أدوات، جوائز، أو ملاحظات خاصة بهذا الأسبوع..."
                  className="w-full bg-[#FAF6EE] border border-[#EAE0D5] focus:border-[#7A1523] focus:outline-none rounded-2xl px-4 py-3 text-sm"
                />
              </section>

              {/* Submit Bar */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowScheduleModal(false)}
                  className="px-5 py-2.5 rounded-xl border border-[#EAE0D5] text-xs font-bold text-[#755953] cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
                >
                  {saving
                    ? 'جاري الحفظ...'
                    : schForm.id
                    ? 'حفظ تعديلات الأسبوع'
                    : '+ إضافة الأسبوع للجدول'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
