import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import type { SessionUser, Workspace } from './types';
import { DEFAULT_PLATFORM_EMBLEM } from './utils/api';
import { auth, testConnection } from './firebase';
import {
  logoutFromFirestore,
  OWNER_EMAIL,
  restoreSessionFromFirebaseAuth,
} from './services/firestoreService';
import { LoginPortal } from './components/LoginPortal';
import { OwnerDashboard } from './components/OwnerDashboard';
import { ApplicantPortal } from './components/ApplicantPortal';
import { WorkspaceShell } from './components/workspace/WorkspaceShell';

export default function App() {
  const [bootLoading, setBootLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [inspectingWorkspace, setInspectingWorkspace] = useState<Workspace | null>(null);

  useEffect(() => {
    let mounted = true;
    void testConnection();

    const unsubscribe = onAuthStateChanged(auth, (fbUser) => {
      void (async () => {
        try {
          const { user, workspace } = await restoreSessionFromFirebaseAuth(fbUser);
          if (!mounted) return;
          setCurrentUser(user);
          setActiveWorkspace(workspace);
          if (!user || user.role !== 'environment_owner') {
            setInspectingWorkspace(null);
          }
        } catch {
          if (!mounted) return;
          setCurrentUser(null);
          setActiveWorkspace(null);
          setInspectingWorkspace(null);
        } finally {
          if (mounted) setBootLoading(false);
        }
      })();
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const handleAuthenticated = (user: SessionUser, workspace: Workspace | null) => {
    setCurrentUser(user);
    setActiveWorkspace(workspace);
    setInspectingWorkspace(null);
  };

  const handleRefreshSession = async () => {
    const { user, workspace } = await restoreSessionFromFirebaseAuth(auth.currentUser);
    setCurrentUser(user);
    setActiveWorkspace(workspace);
    setInspectingWorkspace(null);
  };

  const handleLogout = () => {
    const userSnapshot = currentUser;
    setCurrentUser(null);
    setActiveWorkspace(null);
    setInspectingWorkspace(null);
    void logoutFromFirestore(userSnapshot);
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
        ownerEmail={OWNER_EMAIL}
        onAuthenticated={handleAuthenticated}
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
    return (
      <ApplicantPortal
        user={currentUser}
        onSessionActivated={handleRefreshSession}
        onLogout={handleLogout}
      />
    );
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
