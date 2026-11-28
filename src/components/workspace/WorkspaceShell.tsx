import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  KeyRound,
  LogOut,
  RefreshCw,
} from 'lucide-react';
import type { SessionUser, Workspace, WorkspaceBundle } from '../../types';
import { apiFetch, resolveLogoUrl } from '../../utils/api';
import { StudentPortal } from './StudentPortal';
import { ServantDashboard } from './ServantDashboard';
import { MakhdoumeenTab } from './MakhdoumeenTab';
import { SchedulesAndVisitationTab } from './SchedulesAndVisitationTab';
import { LeadershipAndSecurityTab } from './LeadershipAndSecurityTab';

interface WorkspaceShellProps {
  workspace: Workspace;
  currentUser: SessionUser;
  onUserUpdated: (user: SessionUser) => void;
  onBackToOwnerConsole?: () => void;
  onLogout: () => void;
}

type WorkspaceTab = 'home' | 'students' | 'schedules' | 'leadership';

export const WorkspaceShell: React.FC<WorkspaceShellProps> = ({
  workspace,
  currentUser,
  onUserUpdated,
  onBackToOwnerConsole,
  onLogout,
}) => {
  const [bundle, setBundle] = useState<WorkspaceBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('home');

  // Forced password change state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPass, setChangingPass] = useState(false);
  const [passError, setPassError] = useState('');

  const loadBundle = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiFetch<WorkspaceBundle>(`/api/workspaces/${workspace.id}/bundle`);
      setBundle(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل بيانات الفصل.');
    } finally {
      setLoading(false);
    }
  }, [workspace.id]);

  useEffect(() => {
    void loadBundle();
  }, [loadBundle]);

  const handleForcedPasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassError('');
    if (newPassword.length < 6) {
      setPassError('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPassError('كلمتا المرور غير متطابقتين.');
      return;
    }
    setChangingPass(true);
    try {
      const res = await apiFetch<{ user: SessionUser }>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ newPassword }),
      });
      onUserUpdated(res.user);
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPassError(err instanceof Error ? err.message : 'تعذر تحديث كلمة المرور.');
    } finally {
      setChangingPass(false);
    }
  };

  const isStudent = currentUser.role === 'student';
  const activeWorkspace = bundle?.workspace || workspace;

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#2C1813]">
      {/* Branded Workspace Sticky Header */}
      <header className="sticky top-0 z-30 bg-[#FFFDF9]/95 backdrop-blur-xs border-b border-[#EAE0D5]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={resolveLogoUrl(activeWorkspace.logoUrl)}
              alt={activeWorkspace.className}
              referrerPolicy="no-referrer"
              className="w-9 h-9 rounded-xl object-cover border border-[#EAE0D5] shrink-0"
            />
            <div className="min-w-0">
              <span className="font-extrabold text-sm sm:text-base text-[#2C1813] block truncate">
                {activeWorkspace.className}
              </span>
            </div>
          </div>

          {!isStudent && (
            <nav className="hidden md:flex items-center gap-1 p-1 bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl">
              {[
                { key: 'home', label: 'لوحة الخدمة' },
                { key: 'students', label: 'المخدومين' },
                { key: 'schedules', label: 'الجدول والافتقاد' },
                { key: 'leadership', label: 'الخدام والأمان' },
              ].map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setActiveTab(t.key as WorkspaceTab)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer ${
                    activeTab === t.key
                      ? 'bg-[#7A1523] text-white'
                      : 'text-[#755953] hover:text-[#2C1813]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          )}

          <div className="flex items-center gap-2 shrink-0">
            {onBackToOwnerConsole && (
              <button
                type="button"
                onClick={onBackToOwnerConsole}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#FBF2D8] border border-[#D4AF37]/40 text-[#A46714] text-xs font-bold whitespace-nowrap cursor-pointer"
              >
                <ArrowRight className="w-4 h-4" />
                لوحة المنصة
              </button>
            )}
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#EAE0D5] hover:bg-[#FAF6EE] text-xs font-bold text-[#7A1523] whitespace-nowrap cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              خروج
            </button>
          </div>
        </div>

        {/* Mobile Tab Bar for Servants */}
        {!isStudent && (
          <div className="flex md:hidden border-t border-[#EAE0D5] px-4 py-2 gap-2 overflow-x-auto bg-[#FAF6EE]">
            {[
              { key: 'home', label: 'الرئيسية' },
              { key: 'students', label: 'المخدومين' },
              { key: 'schedules', label: 'الجدول والافتقاد' },
              { key: 'leadership', label: 'الخدام والأمان' },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key as WorkspaceTab)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer ${
                  activeTab === t.key ? 'bg-[#7A1523] text-white' : 'text-[#755953]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-7">
        {loading && !bundle ? (
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl p-12 text-center text-sm text-[#755953]">
            جاري تحميل بيانات مساحة الخدمة...
          </div>
        ) : error ? (
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl p-10 text-center space-y-4">
            <p className="text-sm font-bold text-[#7A1523]">{error}</p>
            <button
              type="button"
              onClick={() => void loadBundle()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#7A1523] text-white text-xs font-bold cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              إعادة المحاولة
            </button>
          </div>
        ) : bundle ? (
          isStudent ? (
            <StudentPortal bundle={bundle} currentUser={currentUser} onRefresh={loadBundle} />
          ) : (
            <>
              {activeTab === 'home' && (
                <ServantDashboard bundle={bundle} currentUser={currentUser} onRefresh={loadBundle} />
              )}
              {activeTab === 'students' && (
                <MakhdoumeenTab bundle={bundle} currentUser={currentUser} onRefresh={loadBundle} />
              )}
              {activeTab === 'schedules' && (
                <SchedulesAndVisitationTab
                  bundle={bundle}
                  currentUser={currentUser}
                  onRefresh={loadBundle}
                />
              )}
              {activeTab === 'leadership' && (
                <LeadershipAndSecurityTab
                  bundle={bundle}
                  currentUser={currentUser}
                  onRefresh={loadBundle}
                />
              )}
            </>
          )
        ) : null}
      </main>

      {/* Forced Password Change Modal on First Login with Temporary Password */}
      {currentUser.mustChangePassword && (
        <div className="fixed inset-0 z-50 bg-[#2C1813]/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl max-w-md w-full p-6 sm:p-8 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-[#FDF2F4] text-[#7A1523] flex items-center justify-center">
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-extrabold text-[#2C1813]">تعيين كلمة مرور شخصية</h2>
                <p className="text-xs text-[#755953]">
                  لأمان حسابك، يرجى تغيير كلمة المرور المؤقتة قبل المتابعة
                </p>
              </div>
            </div>

            {passError && (
              <div className="px-4 py-2.5 rounded-xl bg-[#FDF2F4] text-xs font-bold text-[#7A1523]">
                {passError}
              </div>
            )}

            <form onSubmit={handleForcedPasswordChange} className="space-y-4">
              <div>
                <label className="block text-xs font-bold mb-1">كلمة المرور الجديدة</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  dir="ltr"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm text-left"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">تأكيد كلمة المرور الجديدة</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  dir="ltr"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-[#FAF6EE] border border-[#EAE0D5] rounded-xl px-3.5 py-2.5 text-sm text-left"
                />
              </div>
              <button
                type="submit"
                disabled={changingPass}
                className="w-full py-2.5 rounded-xl bg-[#7A1523] hover:bg-[#620F1B] text-white text-sm font-bold cursor-pointer"
              >
                {changingPass ? 'جاري التحديث...' : 'حفظ كلمة المرور والدخول'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
