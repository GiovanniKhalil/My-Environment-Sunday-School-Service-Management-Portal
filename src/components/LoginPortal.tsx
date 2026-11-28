import React, { useState } from 'react';
import {
  Church,
  LogIn,
  ShieldCheck,
  UserPlus,
  Users,
  CalendarDays,
  MessageSquare,
  X,
  CheckCircle2,
} from 'lucide-react';
import type { SessionUser, Workspace } from '../types';
import { DEFAULT_PLATFORM_EMBLEM } from '../utils/api';
import heroChurchImg from '../assets/images/hero_church_sanctuary_1795619749074.jpg';
import {
  loginWithCredentials,
  loginWithGoogleOwner,
  registerApplicantInFirestore,
  resetPasswordWithPhoneInFirestore,
} from '../services/firestoreService';

interface LoginPortalProps {
  ownerEmail: string;
  onAuthenticated: (user: SessionUser, workspace: Workspace | null) => void;
}

export const LoginPortal: React.FC<LoginPortalProps> = ({
  ownerEmail,
  onAuthenticated,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Modals
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);

  // Applicant Registration Form
  const [regForm, setRegForm] = useState({
    fullName: '',
    phone: '',
    proposedChurchName: '',
    proposedClassName: '',
    proposedStageConfig: '',
    serviceVision: '',
    username: '',
    password: '',
  });

  // Self-service Reset Form
  const [resetForm, setResetForm] = useState({
    username: '',
    phone: '',
    newPassword: '',
  });

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);
    try {
      const { user, workspace } = await loginWithCredentials(username, password);
      onAuthenticated(user, workspace);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تسجيل الدخول.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleOwnerLogin = async () => {
    setError('');
    setSuccessMsg('');
    setGoogleLoading(true);
    try {
      const ownerUser = await loginWithGoogleOwner();
      onAuthenticated(ownerUser, null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تسجيل الدخول بحساب Google.');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleRegisterApplicant = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await registerApplicantInFirestore(regForm);
      setShowRegisterModal(false);
      onAuthenticated(user, null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إرسال الطلب.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await resetPasswordWithPhoneInFirestore(
        resetForm.username,
        resetForm.phone,
        resetForm.newPassword
      );
      setShowResetModal(false);
      setSuccessMsg('تم تحديث كلمة المرور بنجاح. يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.');
      setResetForm({ username: '', phone: '', newPassword: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر استعادة كلمة المرور.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#2C1813] flex flex-col">
      {/* Clean 3-Zone Top Bar */}
      <header className="border-b border-[#EAE0D5] bg-[#FFFDF9]/95 backdrop-blur-xs sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 shrink-0">
            <img
              src={DEFAULT_PLATFORM_EMBLEM}
              alt="شعار منصة مدارس الأحد"
              className="w-9 h-9 rounded-xl object-cover border border-[#EAE0D5]"
            />
            <span className="font-extrabold text-base sm:text-lg text-[#2C1813] whitespace-nowrap">
              منصة خدمات مدارس الأحد
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-sm font-semibold text-[#755953]">
            <a href="#features" className="hover:text-[#7A1523] transition-colors whitespace-nowrap">
              المميزات
            </a>
            <a href="#architecture" className="hover:text-[#7A1523] transition-colors whitespace-nowrap">
              عزل الفصول
            </a>
            <a href="#login-card" className="hover:text-[#7A1523] transition-colors whitespace-nowrap">
              تسجيل الدخول
            </a>
          </nav>

          <button
            type="button"
            onClick={() => {
              setError('');
              setShowRegisterModal(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] text-white text-xs sm:text-sm font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            طلب إنشاء نظام لفصلك
          </button>
        </div>
      </header>

      {/* Main Split Hero + Login Portal */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 lg:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          {/* Editorial Sanctuary Visual & Pitch */}
          <section className="lg:col-span-7 flex flex-col justify-between bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl overflow-hidden">
            <div className="relative h-64 sm:h-80 w-full bg-[#2C1813]">
              <img
                src={heroChurchImg}
                alt="كنيسة قبطية مضيئة"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#2C1813]/85 via-[#2C1813]/35 to-transparent" />
              <div className="absolute bottom-6 right-6 left-6 text-white">
                <p className="text-xs font-semibold text-[#FBF2D8] mb-2">
                  نظام سحابي متعدد الفصول · كنائس الكرازة المرقسية
                </p>
                <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black leading-tight">
                  إدارة متكاملة لخدمات مدارس الأحد بمعايير كنسية معاصرة
                </h1>
              </div>
            </div>

            <div className="p-6 sm:p-8 space-y-6">
              <p className="text-[#755953] text-sm sm:text-base leading-relaxed">
                منصة مركزية تتيح لصاحب المنصة إطلاق غرف خدمة مستقلة ومعزولة تماماً لكل كنيسة وفصل،
                بشعارها الخاص وآية الفصل، مع متابعة المخدومين، الحضور، النقاط، جداول الخدمة والافتقاد،
                وشات مباشر يربط أمناء الفصول.
              </p>

              <div id="features" className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-[#EAE0D5]">
                <div className="p-4 rounded-2xl bg-[#FAF6EE] border border-[#EAE0D5]">
                  <Church className="w-5 h-5 text-[#7A1523] mb-2" />
                  <h3 className="font-bold text-sm text-[#2C1813]">غرف خدمة معزولة</h3>
                  <p className="text-xs text-[#755953] mt-1">
                    بيانات مستقلة وهوية بصرية مخصصة لكل فصل وكنيسة.
                  </p>
                </div>
                <div className="p-4 rounded-2xl bg-[#FAF6EE] border border-[#EAE0D5]">
                  <CalendarDays className="w-5 h-5 text-[#A46714] mb-2" />
                  <h3 className="font-bold text-sm text-[#2C1813]">الخدمة والافتقاد</h3>
                  <p className="text-xs text-[#755953] mt-1">
                    جداول دروس بـ 7 فقرات وتوزيع أسبوعي عادل للافتقاد.
                  </p>
                </div>
                <div className="p-4 rounded-2xl bg-[#FAF6EE] border border-[#EAE0D5]">
                  <MessageSquare className="w-5 h-5 text-[#7A1523] mb-2" />
                  <h3 className="font-bold text-sm text-[#2C1813]">تواصل أمناء الفصول</h3>
                  <p className="text-xs text-[#755953] mt-1">
                    بوابة تقديم وشات فوري مع صاحب الـ Environment لاعتماد خدمتك.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Login Card */}
          <section
            id="login-card"
            className="lg:col-span-5 bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl p-6 sm:p-8 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-11 h-11 rounded-2xl bg-[#FDF2F4] text-[#7A1523] flex items-center justify-center">
                  <LogIn className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-extrabold text-[#2C1813]">تسجيل الدخول للنظام</h2>
                  <p className="text-xs text-[#755953]">
                    للأمناء، الخدام، المخدومين، وأصحاب طلبات الخدمة الجديدة
                  </p>
                </div>
              </div>

              {error && (
                <div className="mb-4 px-4 py-3 rounded-xl bg-[#FDF2F4] border border-[#7A1523]/25 text-xs font-semibold text-[#7A1523]">
                  {error}
                </div>
              )}

              {successMsg && (
                <div className="mb-4 px-4 py-3 rounded-xl bg-[#FBF2D8] border border-[#D4AF37]/40 text-xs font-semibold text-[#2C1813] flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#A46714] shrink-0" />
                  <span>{successMsg}</span>
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-[#2C1813] mb-1.5">
                    اسم المستخدم (حساس لحالة الأحرف)
                  </label>
                  <input
                    type="text"
                    required
                    dir="ltr"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="username"
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] focus:border-[#7A1523] focus:outline-none rounded-xl px-4 py-3 text-sm text-left font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#2C1813] mb-1.5">
                    كلمة المرور
                  </label>
                  <input
                    type="password"
                    required
                    dir="ltr"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] focus:border-[#7A1523] focus:outline-none rounded-xl px-4 py-3 text-sm text-left"
                  />
                </div>

                <div className="flex items-center justify-between text-xs pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setError('');
                      setShowResetModal(true);
                    }}
                    className="text-[#7A1523] hover:underline font-semibold cursor-pointer"
                  >
                    نسيت كلمة المرور؟
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setError('');
                      setShowRegisterModal(true);
                    }}
                    className="text-[#A46714] hover:underline font-bold cursor-pointer"
                  >
                    طلب إنشاء نظام لفصلك
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] disabled:opacity-60 text-white font-bold text-sm transition-colors cursor-pointer"
                >
                  {loading ? 'جاري التحقق...' : 'دخول إلى بوابة الخدمة'}
                </button>
              </form>
            </div>

            {/* Environment Owner Access */}
            <div id="architecture" className="mt-8 pt-6 border-t border-[#EAE0D5] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#755953] flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-[#A46714]" />
                  دخول صاحب الـ Environment
                </span>
                <span className="text-[11px] font-mono text-[#755953] truncate max-w-[180px]">
                  {ownerEmail}
                </span>
              </div>

              <button
                type="button"
                onClick={handleGoogleOwnerLogin}
                disabled={googleLoading}
                className="w-full py-2.5 px-4 rounded-xl bg-[#FAF6EE] hover:bg-[#FBF2D8]/70 border border-[#EAE0D5] text-[#2C1813] text-xs font-bold transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <Users className="w-4 h-4 text-[#7A1523]" />
                {googleLoading ? 'جاري الاتصال بـ Google...' : 'الدخول بحساب Google المعتمد لصاحب المنصة'}
              </button>
            </div>
          </section>
        </div>
      </main>

      {/* Register Applicant Modal */}
      {showRegisterModal && (
        <div className="fixed inset-0 z-50 bg-[#2C1813]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6 sm:p-8">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-lg font-extrabold text-[#2C1813]">طلب إنشاء نظام لفصلك</h3>
                <p className="text-xs text-[#755953]">
                  سجّل بيانات خدمتك وتواصل مباشرة مع صاحب الـ Environment لاعتماد الغرفة
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowRegisterModal(false)}
                className="p-2 rounded-xl hover:bg-[#FAF6EE] text-[#755953] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && (
              <div className="mb-4 px-4 py-2.5 rounded-xl bg-[#FDF2F4] text-xs text-[#7A1523] font-semibold">
                {error}
              </div>
            )}

            <form onSubmit={handleRegisterApplicant} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold mb-1">اسم أمين الفصل / المتقدم</label>
                  <input
                    type="text"
                    required
                    value={regForm.fullName}
                    onChange={(e) => setRegForm({ ...regForm, fullName: e.target.value })}
                    placeholder="أ. بولا مجدي"
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm focus:border-[#7A1523] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">رقم الهاتف (واتساب)</label>
                  <input
                    type="tel"
                    required
                    dir="ltr"
                    value={regForm.phone}
                    onChange={(e) => setRegForm({ ...regForm, phone: e.target.value })}
                    placeholder="012xxxxxxxx"
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm text-left font-mono focus:border-[#7A1523] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold mb-1">اسم الكنيسة</label>
                  <input
                    type="text"
                    required
                    value={regForm.proposedChurchName}
                    onChange={(e) => setRegForm({ ...regForm, proposedChurchName: e.target.value })}
                    placeholder="كنيسة مارمرقس الرسول"
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm focus:border-[#7A1523] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">اسم الفصل / الخدمة المقترح</label>
                  <input
                    type="text"
                    required
                    value={regForm.proposedClassName}
                    onChange={(e) => setRegForm({ ...regForm, proposedClassName: e.target.value })}
                    placeholder="أسرة الشهيد استفانوس"
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm focus:border-[#7A1523] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">المراحل / الصفوف المشمولة</label>
                <input
                  type="text"
                  value={regForm.proposedStageConfig}
                  onChange={(e) => setRegForm({ ...regForm, proposedStageConfig: e.target.value })}
                  placeholder="مثال: تالتة ابتدائي، رابعة ابتدائي"
                  className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm focus:border-[#7A1523] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">رؤية الخدمة وعدد المخدومين التقريبي</label>
                <textarea
                  rows={3}
                  value={regForm.serviceVision}
                  onChange={(e) => setRegForm({ ...regForm, serviceVision: e.target.value })}
                  placeholder="اشرح احتياجات فصلك وأفكارك للخدمة..."
                  className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm focus:border-[#7A1523] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[#EAE0D5]">
                <div>
                  <label className="block text-xs font-bold mb-1">اسم المستخدم للحساب</label>
                  <input
                    type="text"
                    required
                    dir="ltr"
                    value={regForm.username}
                    onChange={(e) => setRegForm({ ...regForm, username: e.target.value })}
                    placeholder="bola.magdy"
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm text-left font-mono focus:border-[#7A1523] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">كلمة المرور (6 أحرف فأكثر)</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    dir="ltr"
                    value={regForm.password}
                    onChange={(e) => setRegForm({ ...regForm, password: e.target.value })}
                    placeholder="••••••"
                    className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm text-left focus:border-[#7A1523] focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowRegisterModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-[#EAE0D5] text-xs font-bold text-[#755953] hover:bg-[#FAF6EE] cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2.5 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] text-white text-xs font-bold cursor-pointer"
                >
                  {loading ? 'جاري التسجيل...' : 'إنشاء الحساب وفتح الشات المباشر'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Phone-Verified Self-Service Password Reset Modal */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 bg-[#2C1813]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl max-w-md w-full p-6 sm:p-8">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-extrabold text-[#2C1813]">استعادة كلمة المرور</h3>
              <button
                type="button"
                onClick={() => setShowResetModal(false)}
                className="p-2 rounded-xl hover:bg-[#FAF6EE] text-[#755953] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {error && (
              <div className="mb-4 px-4 py-2.5 rounded-xl bg-[#FDF2F4] text-xs text-[#7A1523] font-semibold">
                {error}
              </div>
            )}
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="block text-xs font-bold mb-1">اسم المستخدم</label>
                <input
                  type="text"
                  required
                  dir="ltr"
                  value={resetForm.username}
                  onChange={(e) => setResetForm({ ...resetForm, username: e.target.value })}
                  className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm text-left font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">رقم الهاتف المسجل بالحساب</label>
                <input
                  type="tel"
                  required
                  dir="ltr"
                  value={resetForm.phone}
                  onChange={(e) => setResetForm({ ...resetForm, phone: e.target.value })}
                  className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm text-left font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">كلمة المرور الجديدة</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  dir="ltr"
                  value={resetForm.newPassword}
                  onChange={(e) => setResetForm({ ...resetForm, newPassword: e.target.value })}
                  className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm text-left"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] text-white text-sm font-bold cursor-pointer"
              >
                {loading ? 'جاري التحديث...' : 'تعيين كلمة المرور الجديدة'}
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
