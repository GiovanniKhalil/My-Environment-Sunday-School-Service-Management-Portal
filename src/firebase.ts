import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInAnonymously,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDocFromServer,
  getDocs,
  getFirestore,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import type { Workspace } from './types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
} as const;

export type OperationTypeValue = (typeof OperationType)[keyof typeof OperationType];

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationTypeValue;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationTypeValue,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return false;
    }
    return true;
  }
}

export async function signInOwnerWithGoogle(): Promise<{ idToken: string; email: string | null }> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, provider);
  const idToken = await cred.user.getIdToken();
  return { idToken, email: cred.user.email };
}

export async function trySignInAnonymously(): Promise<{ uid: string | null; providerDisabled: boolean }> {
  try {
    if (auth.currentUser) {
      return { uid: auth.currentUser.uid, providerDisabled: false };
    }
    const res = await signInAnonymously(auth);
    return { uid: res.user.uid, providerDisabled: false };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code || '';
    if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') {
      return { uid: null, providerDisabled: true };
    }
    return { uid: null, providerDisabled: false };
  }
}

export async function signOutFirebase(): Promise<void> {
  try {
    await signOut(auth);
  } catch {
    // ignore
  }
}

export async function syncWorkspaceToFirestore(workspace: Workspace): Promise<void> {
  if (!auth.currentUser || auth.currentUser.isAnonymous) return;
  const path = `workspaces/${workspace.id}`;
  try {
    await setDoc(doc(db, 'workspaces', workspace.id), {
      ...workspace,
      ownerUid: auth.currentUser.uid,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncWorkspaceBrandingToFirestore(workspace: Workspace): Promise<void> {
  if (!auth.currentUser) return;
  const ref = doc(db, 'workspaces', workspace.id);
  const patch = {
    churchName: workspace.churchName,
    className: workspace.className,
    stageConfig: workspace.stageConfig,
    grades: workspace.grades,
    logoUrl: workspace.logoUrl,
    verse: workspace.verse,
    updatedAt: workspace.updatedAt,
  };
  try {
    await updateDoc(ref, patch);
  } catch {
    if (!auth.currentUser.isAnonymous) {
      try {
        await setDoc(ref, {
          ...workspace,
          ownerUid: auth.currentUser.uid,
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `workspaces/${workspace.id}`);
      }
    }
  }
}

export async function fetchFirestoreWorkspaceLogos(): Promise<Record<string, string>> {
  if (!auth.currentUser || auth.currentUser.isAnonymous) return {};
  try {
    const snap = await getDocs(collection(db, 'workspaces'));
    const map: Record<string, string> = {};
    snap.forEach((d) => {
      const data = d.data() as Partial<Workspace>;
      if (data.id && typeof data.logoUrl === 'string' && data.logoUrl.startsWith('data:image/')) {
        map[data.id] = data.logoUrl;
      }
    });
    return map;
  } catch {
    return {};
  }
}
