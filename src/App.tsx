import { useEffect, useState } from 'react';
import type { SessionUser, Workspace } from './types';
import { apiFetch, clearSessionToken, DEFAULT_PLATFORM_EMBLEM } from './utils/api';
import { signOutFirebase, testConnection } from './firebase';
import { LoginPortal } from './components/LoginPortal';
import { OwnerDashboard } from './components/OwnerDashboard';
import { ApplicantPortal } from './components/ApplicantPortal';
import { WorkspaceShell } from './components/workspace/WorkspaceShell';

export default function App() {
  const [bootLoading, setBootLoading] = useState(true);
  const [ownerClaimed, setOwnerClaimed] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState('jovanni.ayman@gmail.com');

  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [inspectingWorkspace, setInspectingWorkspace] = useState<Workspace | null>(null);

  useEffect(() => {
    let mounted = true;
    const boot = async () => {
      try {
        void testConnection();
        const health = await apiFetch<{
          ok: boolean;
          ownerClaimed: boolean;
          ownerEmail: string;
        }>('/api/health');
        if (mounted) {
          setOwnerClaimed(Boolean(health.ownerClaimed));
          setOwnerEmail(health.ownerEmail || 'jovanni.ayman@gmail.com');
        }
      } catch {
        // fallback defaults
      } finally {
        if (mounted) setBootLoading(false);
      }
    };
    void boot();
    return () => {
      mounted = false;
    };
  }, []);

  const handleAuthenticated = (user: SessionUser, workspace: Workspace | null) => {
    setCurrentUser(user);
    setActiveWorkspace(workspace);
    setInspectingWorkspace(null);
  };

  const handleLogout = () => {
    clearSessionToken();
    void signOutFirebase();
    setCurrentUser(null);
    setActiveWorkspace(null);
    setInspectingWorkspace(null);
  };

  if (bootLoading) {
    return (
      <div className="min-h-screen bg-[#FAF7F2] text-[#2C1813] flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <img
            src={DEFAULT_PLATFORM_EMBLEM}
            alt="شعار منصة مدارس الأحد"
            className="w-16 h-16 rounded-2xl mx-auto object-cover border border-[#EAE0D5]"
          />
          <p className="text-sm font-bold text-[#755953]">جاري تجهيز منصة خدمات مدارس الأحد...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <LoginPortal
        ownerClaimed={ownerClaimed}
        ownerEmail={ownerEmail}
        onAuthenticated={handleAuthenticated}
        onOwnerClaimed={() => setOwnerClaimed(true)}
      />
    );
  }

  if (currentUser.role === 'environment_owner') {
    if (inspectingWorkspace) {
      return (
        <WorkspaceShell
          workspace={inspectingWorkspace}
          currentUser={currentUser}
          onUserUpdated={setCurrentUser}
          onBackToOwnerConsole={() => setInspectingWorkspace(null)}
          onLogout={handleLogout}
        />
      );
    }
    return (
      <OwnerDashboard
        currentUser={currentUser}
        onEnterWorkspace={(ws) => setInspectingWorkspace(ws)}
        onLogout={handleLogout}
      />
    );
  }

  if (currentUser.role === 'applicant') {
    return <ApplicantPortal user={currentUser} onLogout={handleLogout} />;
  }

  if (activeWorkspace) {
    return (
      <WorkspaceShell
        workspace={activeWorkspace}
        currentUser={currentUser}
        onUserUpdated={setCurrentUser}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#2C1813] flex items-center justify-center p-6">
      <div className="bg-[#FFFDF9] border border-[#EAE0D5] rounded-3xl p-8 max-w-md w-full text-center space-y-4">
        <p className="font-bold text-[#7A1523]">لا توجد مساحة خدمة مرتبطة بهذا الحساب.</p>
        <button
          type="button"
          onClick={handleLogout}
          className="px-5 py-2.5 rounded-xl bg-[#7A1523] text-white text-xs font-bold cursor-pointer"
        >
          العودة لتسجيل الدخول
        </button>
      </div>
    </div>
  );
}
