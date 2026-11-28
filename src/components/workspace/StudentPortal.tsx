import React, { useState } from 'react';
import {
  Award,
  BookOpen,
  CalendarCheck,
  Megaphone,
  MessageCircle,
  Phone,
  Send,
  Shield,
  TrendingUp,
  User,
} from 'lucide-react';
import type {
  SessionUser,
  WorkspaceBundle,
} from '../../types';
import { apiFetch, buildWhatsAppUrl, formatArabicDate, resolveLogoUrl } from '../../utils/api';

interface StudentPortalProps {
  bundle: WorkspaceBundle;
  currentUser: SessionUser;
  onRefresh: () => Promise<void>;
}

export const StudentPortal: React.FC<StudentPortalProps> = ({
  bundle,
  currentUser,
  onRefresh,
}) => {
  const [subView, setSubView] = useState<'home' | 'profile'>('home');
  const [reqField, setReqField] = useState('رقم ولي الأمر');
  const [reqValue, setReqValue] = useState('');
  const [reqReason, setReqReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const student =
    bundle.students.find((s) => s.id === currentUser.linkedProfileId) || bundle.students[0];
  const { workspace } = bundle;

  if (!student) {
    return (
      <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl p-10 text-center text-[#755953]">
        لم يتم ربط ملف مخدوم بهذا الحساب بعد. يرجى التواصل مع أمين الفصل.
      </div>
    );
  }

  const nextSchedule = bundle.monthlySchedules.find((s) => s.grade === student.grade) ||
    bundle.monthlySchedules[0];
  const progressPercent = Math.min(100, Math.round((student.points / 300) * 100));

  const handleSubmitChangeRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reqValue.trim()) return;
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const oldMap: Record<string, string> = {
        'الاسم الكامل': student.fullName,
        'رقم الهاتف': student.phone,
        'رقم ولي الأمر': student.parentPhone,
        'العنوان': student.address,
        'تاريخ الميلاد': student.birthDate,
      };
      await apiFetch(`/api/workspaces/${workspace.id}/change-requests`, {
        method: 'POST',
        body: JSON.stringify({
          studentId: student.id,
          field: reqField,
          oldValue: oldMap[reqField] || '',
          newValue: reqValue.trim(),
          reason: reqReason.trim(),
        }),
      });
      setReqValue('');
      setReqReason('');
      setNotice('تم إرسال طلب التعديل إلى أمين الفصل للمراجعة والاعتماد.');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إرسال الطلب.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Sub-navigation */}
      <div className="flex items-center gap-2 p-1 bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl w-fit">
        <button
          type="button"
          onClick={() => setSubView('home')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
            subView === 'home' ? 'bg-[#7A1523] text-white' : 'text-[#755953] hover:text-[#2C1813]'
          }`}
        >
          بوابة المخدوم الرئيسية
        </button>
        <button
          type="button"
          onClick={() => setSubView('profile')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
            subView === 'profile' ? 'bg-[#7A1523] text-white' : 'text-[#755953] hover:text-[#2C1813]'
          }`}
        >
          البيانات الشخصية وطلبات التعديل
        </button>
      </div>

      {subView === 'home' ? (
        <>
          {/* Hero Card */}
          <section className="bg-[#7A1523] text-white rounded-3xl p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex items-start gap-4">
              <img
                src={resolveLogoUrl(workspace.logoUrl)}
                alt={workspace.className}
                referrerPolicy="no-referrer"
                className="w-16 h-16 rounded-2xl object-cover border-2 border-[#D4AF37] bg-[#FFFDF9] shrink-0"
              />
              <div>
                <p className="text-xs text-[#FBF2D8] font-semibold">
                  {workspace.churchName} · {student.grade}
                </p>
                <h1 className="text-2xl sm:text-3xl font-black mt-1">{student.fullName}</h1>
                <p className="text-xs text-white/80 mt-2 max-w-xl leading-relaxed">
                  {workspace.verse}
                </p>
                {student.badges.length > 0 && (
                  <p className="text-xs text-[#FBF2D8] font-bold mt-2">
                    الأوسمة: {student.badges.join(' · ')}
                  </p>
                )}
              </div>
            </div>

            {/* 300-Point Golden Shield Progress */}
            <div className="bg-[#620F1B] border border-[#D4AF37]/40 rounded-2xl p-5 min-w-[270px]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-[#FBF2D8] flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-[#D4AF37]" />
                  هدف الدرع الذهبي (300 نقطة)
                </span>
                <span className="text-xl font-black font-mono tabular-nums text-[#D4AF37]">
                  {student.points}
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-[#2C1813]/40 overflow-hidden">
                <div
                  className="h-full bg-[#D4AF37] rounded-full transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="text-[11px] text-white/80 mt-2 font-mono tabular-nums">
                {student.points >= 300
                  ? 'مبارك! تم اجتياز درع التفوق الذهبي'
                  : `متبقي ${300 - student.points} نقطة للوصول للدرع الذهبي`}
              </p>
            </div>
          </section>

          {/* 4 Evaluations Strip */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'حفظ الآية والمزمور', value: student.evaluations.memoryVerse },
              { label: 'مسابقة الكتاب المقدس', value: student.evaluations.bibleQuiz },
              { label: 'السلوك والالتزام', value: student.evaluations.behavior },
              { label: 'نسبة الحضور', value: student.evaluations.attendanceRate },
            ].map((stat) => (
              <div key={stat.label} className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-5">
                <p className="text-xs font-semibold text-[#755953]">{stat.label}</p>
                <p className="text-3xl font-black font-mono tabular-nums text-[#7A1523] mt-1">
                  {stat.value}%
                </p>
              </div>
            ))}
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Weekly Lesson & Verse + Announcements */}
            <div className="lg:col-span-7 space-y-6">
              {nextSchedule && (
                <section className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-6 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="font-extrabold text-base text-[#2C1813] flex items-center gap-2">
                      <BookOpen className="w-5 h-5 text-[#7A1523]" />
                      درس وآية الأسبوع القادم
                    </h2>
                    <span className="text-xs font-mono tabular-nums text-[#A46714] font-bold">
                      {nextSchedule.date}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-[#7A1523]">{nextSchedule.lessonTitle}</h3>
                  {nextSchedule.memoryVerse && (
                    <p className="text-sm bg-[#FBF2D8]/60 border border-[#D4AF37]/30 rounded-xl p-3.5 text-[#2C1813] leading-relaxed">
                      {nextSchedule.memoryVerse}
                    </p>
                  )}
                  <p className="text-xs text-[#755953]">
                    تقديم الدرس: <strong className="text-[#2C1813]">{nextSchedule.primaryTeacherName}</strong>
                  </p>
                </section>
              )}

              <section className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-6 space-y-4">
                <h2 className="font-extrabold text-base text-[#2C1813] flex items-center gap-2">
                  <Megaphone className="w-5 h-5 text-[#A46714]" />
                  إعلانات الفصل
                </h2>
                {bundle.announcements.length === 0 ? (
                  <p className="text-sm text-[#755953]">لا توجد إعلانات حالياً.</p>
                ) : (
                  <div className="divide-y divide-[#EAE0D5]">
                    {bundle.announcements.map((ann) => (
                      <article key={ann.id} className="py-3.5 first:pt-0 last:pb-0">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="font-bold text-sm text-[#2C1813]">
                            {ann.isUrgent && <span className="text-[#7A1523] ml-1.5">[هام]</span>}
                            {ann.title}
                          </h3>
                          <span className="text-[11px] font-mono tabular-nums text-[#755953]">
                            {formatArabicDate(ann.createdAt)}
                          </span>
                        </div>
                        <p className="text-xs text-[#755953] mt-1 leading-relaxed">{ann.body}</p>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>

            {/* Attendance, Points History & Servants Contact */}
            <div className="lg:col-span-5 space-y-6">
              <section className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-6 space-y-3">
                <h2 className="font-extrabold text-base text-[#2C1813] flex items-center gap-2">
                  <CalendarCheck className="w-5 h-5 text-[#7A1523]" />
                  سجل الحضور الأخير
                </h2>
                {student.attendanceHistory.length === 0 ? (
                  <p className="text-xs text-[#755953]">لم يتم تسجيل حضور بعد.</p>
                ) : (
                  <div className="divide-y divide-[#EAE0D5]">
                    {student.attendanceHistory.slice(0, 6).map((att, idx) => (
                      <div key={idx} className="py-2.5 flex items-center justify-between text-xs">
                        <div>
                          <span className="font-bold text-[#2C1813]">
                            {att.sessionType === 'mass' ? 'القداس الإلهي' : 'مدارس الأحد'}
                          </span>
                          <span className="text-[#755953] mr-2 font-mono tabular-nums">{att.date}</span>
                        </div>
                        <span
                          className={`font-bold ${
                            att.status === 'present' ? 'text-emerald-700' : 'text-[#7A1523]'
                          }`}
                        >
                          {att.status === 'present' ? 'حاضر' : 'غائب'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-6 space-y-3">
                <h2 className="font-extrabold text-base text-[#2C1813] flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-[#A46714]" />
                  سجل النقاط
                </h2>
                {student.pointsHistory.length === 0 ? (
                  <p className="text-xs text-[#755953]">لا توجد حركات نقاط مسجلة.</p>
                ) : (
                  <div className="divide-y divide-[#EAE0D5]">
                    {student.pointsHistory.slice(0, 6).map((pt) => (
                      <div key={pt.id} className="py-2.5 flex items-center justify-between text-xs gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-[#2C1813] truncate">{pt.reason}</p>
                          <p className="text-[11px] text-[#755953] font-mono tabular-nums">{pt.date}</p>
                        </div>
                        <span
                          className={`font-mono tabular-nums font-black shrink-0 ${
                            pt.amount >= 0 ? 'text-emerald-700' : 'text-[#7A1523]'
                          }`}
                        >
                          {pt.amount >= 0 ? `+${pt.amount}` : pt.amount}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-6 space-y-3">
                <h2 className="font-extrabold text-base text-[#2C1813] flex items-center gap-2">
                  <Award className="w-5 h-5 text-[#7A1523]" />
                  تواصل مع خدام الفصل
                </h2>
                <div className="divide-y divide-[#EAE0D5]">
                  {bundle.servants.map((srv) => (
                    <div key={srv.id} className="py-2.5 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-bold text-xs text-[#2C1813] truncate">{srv.fullName}</p>
                        <p className="text-[11px] text-[#755953]">{srv.assignedGrade}</p>
                      </div>
                      {srv.phone && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <a
                            href={`tel:${srv.phone}`}
                            className="p-2 rounded-xl bg-[#FAF6EE] border border-[#EAE0D5] text-[#2C1813] hover:border-[#7A1523]"
                            title="اتصال"
                          >
                            <Phone className="w-3.5 h-3.5" />
                          </a>
                          <a
                            href={buildWhatsAppUrl(srv.phone, `سلام ونعمة ${srv.fullName}`)}
                            target="_blank"
                            rel="noreferrer"
                            className="p-2 rounded-xl bg-[#FAF6EE] border border-[#EAE0D5] text-emerald-700 hover:border-emerald-600"
                            title="واتساب"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </>
      ) : (
        /* Student Read-Only Profile & Data Change Request */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-6 bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-6 space-y-4">
            <h2 className="font-extrabold text-base text-[#2C1813] flex items-center gap-2">
              <User className="w-5 h-5 text-[#7A1523]" />
              البيانات المسجلة (للقراءة فقط)
            </h2>
            <div className="divide-y divide-[#EAE0D5] text-sm">
              {[
                ['الاسم الكامل', student.fullName],
                ['المرحلة / الفصل', student.grade],
                ['النوع', student.gender],
                ['تاريخ الميلاد', student.birthDate || '—'],
                ['رقم الهاتف', student.phone || '—'],
                ['هاتف ولي الأمر', student.parentPhone || '—'],
                ['العنوان', student.address || '—'],
                ['اسم المستخدم', student.username],
              ].map(([label, val]) => (
                <div key={label} className="py-3 flex items-center justify-between gap-4">
                  <span className="text-xs font-semibold text-[#755953]">{label}</span>
                  <span className="font-bold text-[#2C1813] text-left">{val}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="lg:col-span-6 bg-[#FFFDF9] border border-[#EAE0D5] rounded-2xl p-6 space-y-4">
            <h2 className="font-extrabold text-base text-[#2C1813]">طلب تعديل بيانات</h2>
            <p className="text-xs text-[#755953]">
              في حال تغير رقم الهاتف أو العنوان أو وجود خطأ بالاسم، أرسل طلباً ليراجعه أمين الفصل.
            </p>
            {notice && (
              <div className="px-4 py-2.5 rounded-xl bg-[#FBF2D8] text-xs font-semibold text-[#2C1813]">
                {notice}
              </div>
            )}
            {error && (
              <div className="px-4 py-2.5 rounded-xl bg-[#FDF2F4] text-xs font-semibold text-[#7A1523]">
                {error}
              </div>
            )}
            <form onSubmit={handleSubmitChangeRequest} className="space-y-4">
              <div>
                <label className="block text-xs font-bold mb-1">البيان المطلوب تعديله</label>
                <select
                  value={reqField}
                  onChange={(e) => setReqField(e.target.value)}
                  className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm"
                >
                  <option value="رقم ولي الأمر">رقم ولي الأمر</option>
                  <option value="رقم الهاتف">رقم الهاتف</option>
                  <option value="العنوان">العنوان</option>
                  <option value="تاريخ الميلاد">تاريخ الميلاد</option>
                  <option value="الاسم الكامل">الاسم الكامل</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">القيمة الصحيحة الجديدة</label>
                <input
                  type="text"
                  required
                  value={reqValue}
                  onChange={(e) => setReqValue(e.target.value)}
                  className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">ملاحظات / سبب التعديل</label>
                <textarea
                  rows={2}
                  value={reqReason}
                  onChange={(e) => setReqReason(e.target.value)}
                  className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] text-white text-xs font-bold cursor-pointer"
              >
                <Send className="w-4 h-4" />
                {submitting ? 'جاري الإرسال...' : 'إرسال طلب التعديل'}
              </button>
            </form>

            {bundle.changeRequests.length > 0 && (
              <div className="pt-4 border-t border-[#EAE0D5] space-y-2">
                <h3 className="text-xs font-bold text-[#755953]">طلباتي السابقة</h3>
                {bundle.changeRequests.map((cr) => (
                  <div key={cr.id} className="text-xs flex items-center justify-between py-2 border-b border-[#EAE0D5] last:border-b-0">
                    <span>
                      {cr.field}: <strong>{cr.newValue}</strong>
                    </span>
                    <span
                      className={`font-bold ${
                        cr.status === 'approved'
                          ? 'text-emerald-700'
                          : cr.status === 'rejected'
                          ? 'text-[#7A1523]'
                          : 'text-[#A46714]'
                      }`}
                    >
                      {cr.status === 'approved' ? 'مقبول' : cr.status === 'rejected' ? 'مرفوض' : 'قيد المراجعة'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
};
