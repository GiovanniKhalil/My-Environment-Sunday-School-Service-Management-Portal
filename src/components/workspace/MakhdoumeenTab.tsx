import React, { useMemo, useState } from 'react';
import {
  FileUp,
  Layers,
  MessageCircle,
  Phone,
  Plus,
  Search,
  Trash2,
  Upload,
  User,
  X,
} from 'lucide-react';
import type {
  Gender,
  SessionUser,
  Student,
  WorkspaceBundle,
} from '../../types';
import {
  apiFetch,
  buildWhatsAppUrl,
  compressImageToDataUrl,
  parseStudentsSpreadsheet,
  type ImportedStudentRow,
} from '../../utils/api';

interface MakhdoumeenTabProps {
  bundle: WorkspaceBundle;
  currentUser: SessionUser;
  onRefresh: () => Promise<void>;
}

export const MakhdoumeenTab: React.FC<MakhdoumeenTabProps> = ({
  bundle,
  currentUser,
  onRefresh,
}) => {
  const { workspace, students } = bundle;
  const isAdmin =
    currentUser.role === 'environment_owner' ||
    currentUser.role === 'head_servant' ||
    currentUser.role === 'assistant_head';

  const [search, setSearch] = useState('');
  const [gradeFilter, setGradeFilter] = useState('all');
  const [genderFilter, setGenderFilter] = useState<'all' | Gender>('all');

  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);

  const [addForm, setAddForm] = useState({
    fullName: '',
    grade: workspace.grades[0] || '',
    gender: 'ذكر' as Gender,
    birthDate: '',
    phone: '',
    parentPhone: '',
    address: '',
    username: '',
    tempPassword: '',
  });

  const [importRows, setImportRows] = useState<ImportedStudentRow[]>([]);
  const [batchAction, setBatchAction] = useState<'promote_grade' | 'delete_grade' | 'reset_points'>('promote_grade');
  const [batchFromGrade, setBatchFromGrade] = useState(workspace.grades[0] || '');
  const [batchToGrade, setBatchToGrade] = useState(workspace.grades[1] || workspace.grades[0] || '');
  const [batchKeyword, setBatchKeyword] = useState('');

  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      if (gradeFilter !== 'all' && s.grade !== gradeFilter) return false;
      if (genderFilter !== 'all' && s.gender !== genderFilter) return false;
      if (q && !s.fullName.toLowerCase().includes(q) && !s.username.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [students, search, gradeFilter, genderFilter]);

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/api/workspaces/${workspace.id}/students`, {
        method: 'POST',
        body: JSON.stringify(addForm),
      });
      setShowAddModal(false);
      setAddForm({
        fullName: '',
        grade: workspace.grades[0] || '',
        gender: 'ذكر',
        birthDate: '',
        phone: '',
        parentPhone: '',
        address: '',
        username: '',
        tempPassword: '',
      });
      setFeedback('تمت إضافة المخدوم وإنشاء حساب الدخول بنجاح.');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إضافة المخدوم.');
    } finally {
      setSaving(false);
    }
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const parsed = await parseStudentsSpreadsheet(file);
      setImportRows(parsed);
    } catch {
      setError('تعذر قراءة ملف Excel / CSV. تأكد من وجود عمود "الاسم".');
    }
  };

  const handleConfirmImport = async () => {
    if (importRows.length === 0) return;
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch<{ importedCount: number; skippedCount: number }>(
        `/api/workspaces/${workspace.id}/students/import`,
        {
          method: 'POST',
          body: JSON.stringify({ rows: importRows }),
        }
      );
      setShowImportModal(false);
      setImportRows([]);
      setFeedback(`تم استيراد ${res.importedCount} مخدوم بنجاح (وتخطي ${res.skippedCount} مكرر/غير صالح).`);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل الاستيراد.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveStudentDetail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudent) return;
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/api/workspaces/${workspace.id}/students/${selectedStudent.id}`, {
        method: 'PATCH',
        body: JSON.stringify(selectedStudent),
      });
      setSelectedStudent(null);
      setFeedback('تم تحديث بيانات المخدوم بنجاح.');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ التعديلات.');
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedStudent) return;
    const dataUrl = await compressImageToDataUrl(file, 260, 0.78);
    setSelectedStudent({ ...selectedStudent, avatarUrl: dataUrl });
  };

  const handleDeleteStudent = async (studentId: string) => {
    await apiFetch(`/api/workspaces/${workspace.id}/students/${studentId}`, { method: 'DELETE' });
    setSelectedStudent(null);
    setFeedback('تم حذف ملف المخدوم.');
    await onRefresh();
  };

  const handleRunBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/api/workspaces/${workspace.id}/batch`, {
        method: 'POST',
        body: JSON.stringify({
          action: batchAction,
          fromGrade: batchFromGrade,
          toGrade: batchToGrade,
          confirmKeyword: batchKeyword.trim(),
        }),
      });
      setShowBatchModal(false);
      setBatchKeyword('');
      setFeedback('تم تنفيذ العملية الجماعية بنجاح.');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تنفيذ العملية.');
    } finally {
      setSaving(false);
    }
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

      {error && (
        <div className="px-4 py-3 rounded-2xl bg-[#FDF2F4] border border-[#7A1523]/25 text-xs font-bold text-[#7A1523] flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-[210px]">
            <Search className="w-4 h-4 text-[#755953] absolute right-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث بالاسم أو اسم المستخدم..."
              className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl pr-10 pl-4 py-2 text-sm focus:border-[#7A1523] focus:outline-none"
            />
          </div>
          <select
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value)}
            className="bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-xs font-bold"
          >
            <option value="all">كل المراحل ({students.length})</option>
            {workspace.grades.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
          <select
            value={genderFilter}
            onChange={(e) => setGenderFilter(e.target.value as 'all' | Gender)}
            className="bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-xs font-bold"
          >
            <option value="all">الكل</option>
            <option value="ذكر">بنين</option>
            <option value="أنثى">بنات</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] text-white text-xs font-bold cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            إضافة مخدوم
          </button>
          <button
            type="button"
            onClick={() => setShowImportModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#FAF6EE] hover:bg-[#FBF2D8] border border-[#EAE0D5] text-[#2C1813] text-xs font-bold cursor-pointer"
          >
            <FileUp className="w-4 h-4 text-[#A46714]" />
            استيراد Excel/CSV
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowBatchModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#FAF6EE] hover:bg-[#FDF2F4] border border-[#EAE0D5] text-[#7A1523] text-xs font-bold cursor-pointer"
            >
              <Layers className="w-4 h-4" />
              أدوات جماعية
            </button>
          )}
        </div>
      </div>

      {/* Students Table */}
      <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl overflow-hidden">
        {filteredStudents.length === 0 ? (
          <div className="p-12 text-center text-sm text-[#755953]">
            لا يوجد مخدومون مطابقون. أضف أول مخدوم أو استورد كشف Excel.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-[#FAF6EE] border-b border-[#EAE0D5] text-xs text-[#755953]">
                <tr>
                  <th className="py-3 px-4 font-bold">المخدوم</th>
                  <th className="py-3 px-4 font-bold">المرحلة</th>
                  <th className="py-3 px-4 font-bold">هاتف ولي الأمر</th>
                  <th className="py-3 px-4 font-bold">النقاط</th>
                  <th className="py-3 px-4 font-bold">الحضور</th>
                  <th className="py-3 px-4 font-bold text-left">تواصل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE0D5]">
                {filteredStudents.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => setSelectedStudent({ ...s })}
                    className="hover:bg-[#FAF6EE]/70 transition-colors cursor-pointer"
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        {s.avatarUrl ? (
                          <img
                            src={s.avatarUrl}
                            alt={s.fullName}
                            referrerPolicy="no-referrer"
                            className="w-9 h-9 rounded-xl object-cover border border-[#EAE0D5]"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-xl bg-[#FDF2F4] text-[#7A1523] flex items-center justify-center">
                            <User className="w-4 h-4" />
                          </div>
                        )}
                        <div>
                          <p className="font-bold text-[#2C1813]">{s.fullName}</p>
                          <p className="text-[11px] font-mono text-[#755953]">@{s.username}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-[#755953]">{s.grade}</td>
                    <td className="py-3 px-4 text-xs font-mono tabular-nums text-[#2C1813]">
                      {s.parentPhone || s.phone || '—'}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums font-black text-[#A46714]">
                      {s.points}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums font-bold text-[#7A1523]">
                      {s.evaluations.attendanceRate}%
                    </td>
                    <td
                      className="py-3 px-4 text-left"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {(s.parentPhone || s.phone) && (
                        <div className="inline-flex items-center gap-1.5">
                          <a
                            href={`tel:${s.parentPhone || s.phone}`}
                            className="p-1.5 rounded-lg border border-[#EAE0D5] hover:border-[#7A1523] text-[#2C1813]"
                          >
                            <Phone className="w-3.5 h-3.5" />
                          </a>
                          <a
                            href={buildWhatsAppUrl(
                              s.parentPhone || s.phone,
                              `سلام ونعمة، نطمئن على ${s.fullName} من خدمة ${workspace.className}.`
                            )}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 rounded-lg border border-[#EAE0D5] hover:border-emerald-600 text-emerald-700"
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

      {/* Student Detail Drawer */}
      {selectedStudent && (
        <div className="fixed inset-0 z-50 bg-[#2C1813]/60 backdrop-blur-xs flex justify-end">
          <div className="bg-[#FFFDF9] border-r border-[#EAE0D5] w-full max-w-xl h-full overflow-y-auto p-6 space-y-5">
            <div className="flex items-center justify-between pb-4 border-b border-[#EAE0D5]">
              <h3 className="text-lg font-extrabold text-[#2C1813]">ملف المخدوم التفصيلي</h3>
              <button
                type="button"
                onClick={() => setSelectedStudent(null)}
                className="p-2 rounded-xl hover:bg-[#FAF6EE] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveStudentDetail} className="space-y-4">
              <div className="flex items-center gap-4 p-4 rounded-2xl bg-[#FAF6EE] border border-[#EAE0D5]">
                {selectedStudent.avatarUrl ? (
                  <img
                    src={selectedStudent.avatarUrl}
                    alt={selectedStudent.fullName}
                    referrerPolicy="no-referrer"
                    className="w-16 h-16 rounded-2xl object-cover border border-[#EAE0D5]"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-2xl bg-[#FDF2F4] text-[#7A1523] flex items-center justify-center">
                    <User className="w-7 h-7" />
                  </div>
                )}
                <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#FFFDF9] border border-[#EAE0D5] text-xs font-bold cursor-pointer">
                  <Upload className="w-4 h-4 text-[#7A1523]" />
                  رفع صورة شخصية
                  <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">الاسم الكامل</label>
                  <input
                    type="text"
                    required
                    value={selectedStudent.fullName}
                    onChange={(e) => setSelectedStudent({ ...selectedStudent, fullName: e.target.value })}
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">المرحلة</label>
                  <select
                    value={selectedStudent.grade}
                    onChange={(e) => setSelectedStudent({ ...selectedStudent, grade: e.target.value })}
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-sm"
                  >
                    {workspace.grades.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">هاتف المخدوم</label>
                  <input
                    type="tel"
                    dir="ltr"
                    value={selectedStudent.phone}
                    onChange={(e) => setSelectedStudent({ ...selectedStudent, phone: e.target.value })}
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-sm font-mono text-left"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">هاتف ولي الأمر</label>
                  <input
                    type="tel"
                    dir="ltr"
                    value={selectedStudent.parentPhone}
                    onChange={(e) => setSelectedStudent({ ...selectedStudent, parentPhone: e.target.value })}
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-sm font-mono text-left"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">تاريخ الميلاد</label>
                  <input
                    type="date"
                    value={selectedStudent.birthDate}
                    onChange={(e) => setSelectedStudent({ ...selectedStudent, birthDate: e.target.value })}
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">اسم المستخدم</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={selectedStudent.username}
                    onChange={(e) => setSelectedStudent({ ...selectedStudent, username: e.target.value })}
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-sm font-mono text-left"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">العنوان</label>
                <input
                  type="text"
                  value={selectedStudent.address}
                  onChange={(e) => setSelectedStudent({ ...selectedStudent, address: e.target.value })}
                  className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-[#EAE0D5]">
                <div>
                  <label className="block text-[11px] font-bold mb-1">حفظ الآية %</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={selectedStudent.evaluations.memoryVerse}
                    onChange={(e) =>
                      setSelectedStudent({
                        ...selectedStudent,
                        evaluations: { ...selectedStudent.evaluations, memoryVerse: Number(e.target.value) },
                      })
                    }
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-2.5 py-1.5 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold mb-1">الكتاب المقدس %</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={selectedStudent.evaluations.bibleQuiz}
                    onChange={(e) =>
                      setSelectedStudent({
                        ...selectedStudent,
                        evaluations: { ...selectedStudent.evaluations, bibleQuiz: Number(e.target.value) },
                      })
                    }
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-2.5 py-1.5 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold mb-1">السلوك %</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={selectedStudent.evaluations.behavior}
                    onChange={(e) =>
                      setSelectedStudent({
                        ...selectedStudent,
                        evaluations: { ...selectedStudent.evaluations, behavior: Number(e.target.value) },
                      })
                    }
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-2.5 py-1.5 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold mb-1">إجمالي النقاط</label>
                  <input
                    type="number"
                    min={0}
                    value={selectedStudent.points}
                    onChange={(e) =>
                      setSelectedStudent({ ...selectedStudent, points: Number(e.target.value) })
                    }
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-2.5 py-1.5 text-sm font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-[#EAE0D5]">
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => handleDeleteStudent(selectedStudent.id)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#EAE0D5] hover:bg-[#FDF2F4] text-[#7A1523] text-xs font-bold cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                    حذف المخدوم
                  </button>
                ) : (
                  <div />
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] text-white text-xs font-bold cursor-pointer"
                >
                  {saving ? 'جاري الحفظ...' : 'حفظ التعديلات'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Student Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-[#2C1813]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-[#2C1813]">إضافة مخدوم جديد</h3>
              <button type="button" onClick={() => setShowAddModal(false)} className="cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddStudent} className="space-y-3">
              <input
                type="text"
                required
                value={addForm.fullName}
                onChange={(e) => setAddForm({ ...addForm, fullName: e.target.value })}
                placeholder="الاسم الكامل للمخدوم"
                className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm"
              />
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={addForm.grade}
                  onChange={(e) => setAddForm({ ...addForm, grade: e.target.value })}
                  className="bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-sm"
                >
                  {workspace.grades.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
                <select
                  value={addForm.gender}
                  onChange={(e) => setAddForm({ ...addForm, gender: e.target.value as Gender })}
                  className="bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-sm"
                >
                  <option value="ذكر">ذكر</option>
                  <option value="أنثى">أنثى</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="date"
                  value={addForm.birthDate}
                  onChange={(e) => setAddForm({ ...addForm, birthDate: e.target.value })}
                  className="bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-sm font-mono"
                />
                <input
                  type="tel"
                  dir="ltr"
                  value={addForm.parentPhone}
                  onChange={(e) => setAddForm({ ...addForm, parentPhone: e.target.value })}
                  placeholder="هاتف ولي الأمر"
                  className="bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-sm font-mono text-left"
                />
              </div>
              <input
                type="text"
                value={addForm.address}
                onChange={(e) => setAddForm({ ...addForm, address: e.target.value })}
                placeholder="العنوان"
                className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm"
              />
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#EAE0D5]">
                <input
                  type="text"
                  dir="ltr"
                  value={addForm.username}
                  onChange={(e) => setAddForm({ ...addForm, username: e.target.value })}
                  placeholder="username (اختياري)"
                  className="bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-sm font-mono text-left"
                />
                <input
                  type="text"
                  dir="ltr"
                  value={addForm.tempPassword}
                  onChange={(e) => setAddForm({ ...addForm, tempPassword: e.target.value })}
                  placeholder="كلمة مرور مؤقتة"
                  className="bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3 py-2 text-sm font-mono text-left"
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="w-full py-2.5 rounded-xl bg-[#7A1523] text-white text-xs font-bold cursor-pointer"
              >
                {saving ? 'جاري الإضافة...' : 'حفظ المخدوم'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Excel/CSV Importer Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-[#2C1813]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-[#2C1813]">استيراد المخدومين من Excel / CSV</h3>
              <button type="button" onClick={() => setShowImportModal(false)} className="cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-[#755953]">
              الأعمدة المدعومة: الاسم، المرحلة، النوع، تاريخ الميلاد، هاتف ولي الأمر، العنوان، اسم المستخدم، كلمة المرور.
            </p>
            <label className="block border-2 border-dashed border-[#EAE0D5] hover:border-[#7A1523] rounded-2xl p-6 text-center cursor-pointer bg-[#FAF6EE]">
              <FileUp className="w-8 h-8 text-[#7A1523] mx-auto mb-2" />
              <span className="text-xs font-bold text-[#2C1813]">اضغط لاختيار ملف .xlsx أو .csv</span>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileImport} className="hidden" />
            </label>

            {importRows.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-bold text-[#A46714]">
                  تم رصد {importRows.length} سجل جاهز للاستيراد:
                </p>
                <div className="max-h-56 overflow-y-auto border border-[#EAE0D5] rounded-2xl divide-y divide-[#EAE0D5] px-3 text-xs">
                  {importRows.slice(0, 30).map((r, i) => (
                    <div key={i} className="py-2 flex items-center justify-between">
                      <span className="font-bold">{r.fullName}</span>
                      <span className="text-[#755953]">{r.grade || workspace.grades[0]}</span>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleConfirmImport}
                  disabled={saving}
                  className="w-full py-2.5 rounded-xl bg-[#7A1523] text-white text-xs font-bold cursor-pointer"
                >
                  {saving ? 'جاري الاستيراد...' : 'تأكيد الاستيراد وإنشاء الحسابات'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Leadership Batch Tools Modal */}
      {showBatchModal && isAdmin && (
        <div className="fixed inset-0 z-50 bg-[#2C1813]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-[#2C1813]">أدوات الإدارة الجماعية</h3>
              <button type="button" onClick={() => setShowBatchModal(false)} className="cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleRunBatch} className="space-y-4">
              <select
                value={batchAction}
                onChange={(e) => setBatchAction(e.target.value as 'promote_grade' | 'delete_grade' | 'reset_points')}
                className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm font-bold"
              >
                <option value="promote_grade">ترحيل مرحلة كاملة لمرحلة أعلى</option>
                <option value="reset_points">تصفير نقاط الترم لجميع المخدومين</option>
                <option value="delete_grade">حذف جميع مخدومي مرحلة محددة</option>
              </select>

              {batchAction !== 'reset_points' && (
                <div>
                  <label className="block text-xs font-bold mb-1">المرحلة المستهدفة</label>
                  <select
                    value={batchFromGrade}
                    onChange={(e) => setBatchFromGrade(e.target.value)}
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2 text-sm"
                  >
                    {workspace.grades.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>
              )}

              {batchAction === 'promote_grade' && (
                <div>
                  <label className="block text-xs font-bold mb-1">الترحيل إلى المرحلة</label>
                  <input
                    type="text"
                    required
                    value={batchToGrade}
                    onChange={(e) => setBatchToGrade(e.target.value)}
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2 text-sm"
                  />
                </div>
              )}

              {batchAction !== 'promote_grade' && (
                <div>
                  <label className="block text-xs font-bold text-[#7A1523] mb-1">
                    اكتب كلمة «تأكيد» لإتمام الإجراء الحساس
                  </label>
                  <input
                    type="text"
                    required
                    value={batchKeyword}
                    onChange={(e) => setBatchKeyword(e.target.value)}
                    placeholder="تأكيد"
                    className="w-full bg-[#FDF2F4] border border-[#7A1523]/30 rounded-xl px-3.5 py-2 text-sm"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={saving}
                className="w-full py-2.5 rounded-xl bg-[#7A1523] text-white text-xs font-bold cursor-pointer"
              >
                {saving ? 'جاري التنفيذ...' : 'تنفيذ الإجراء'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
