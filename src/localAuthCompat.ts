/**
 * Compatibility layer for legacy calls in the attached OSONE interface.
 *
 * Cloud authentication and Firestore writes are intentionally disabled. The
 * current build stores profiles, memories and credentials locally and keeps
 * each profile isolated by its validated identifier.
 */
export const auth: any = { currentUser: null };
export const db: any = {};
export const googleProvider: any = {};

export const signInWithPopup = async (
  _authInstance?: any,
  _provider?: any
): Promise<any> => {
  throw new Error(
    'A sincronização em nuvem está desativada. Use os Perfis Locais do OSONE.'
  );
};

export const signOut = async (_authInstance?: any): Promise<void> => {};

export const onAuthStateChanged = (
  _authInstance: any,
  callback: (user: any) => void
): (() => void) => {
  callback(null);
  return () => {};
};

export const doc = (
  _store: any,
  path: string,
  ...pathSegments: string[]
): any => ({
  id: pathSegments[pathSegments.length - 1] || path
});

export const setDoc = async (
  _reference?: any,
  _data?: any,
  _options?: any
): Promise<void> => {};

export const getDoc = async (_reference?: any): Promise<any> => ({
  exists: () => false,
  data: () => null
});

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write'
}

export const handleFirestoreError = (
  error: unknown,
  _operationType: OperationType,
  _path: string | null
): never => {
  throw new Error(error instanceof Error ? error.message : String(error));
};
