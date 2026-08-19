/** Stable local learner identity for Electron installations and browser profiles. */

const STORAGE_KEY = "sl_student_id_v1";
const AUTHENTICATED_STORAGE_KEY = "sl_authenticated_student_id_v1";
const LOCAL_ID_PATTERN =
  /^local_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUTHENTICATED_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,127}$/i;

export interface IdentityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}
export interface IdentityDependencies {
  desktopId?: string;
  storage?: IdentityStorage;
  randomUUID?: () => string;
}

interface RuntimeCrypto {
  randomUUID?: () => string;
  getRandomValues?: (values: Uint8Array) => Uint8Array;
}

/** Generate a UUID even when randomUUID is hidden on non-secure HTTP origins. */
export function createAnonymousUuid(
  cryptoSource: RuntimeCrypto | undefined = globalThis.crypto,
): string {
  if (cryptoSource?.randomUUID) return cryptoSource.randomUUID();

  const bytes = new Uint8Array(16);
  if (cryptoSource?.getRandomValues) {
    cryptoSource.getRandomValues(bytes);
  } else {
    // This ID only separates anonymous local data; it is not an auth credential.
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10).join(""),
  ].join("-");
}

export function isLocalStudentId(value: string | null | undefined): value is string {
  return typeof value === "string" && LOCAL_ID_PATTERN.test(value);
}

export function isAuthenticatedStudentId(value: string | null | undefined): value is string {
  return typeof value === "string" && AUTHENTICATED_ID_PATTERN.test(value);
}

export function getStudentId(deps: IdentityDependencies = {}): string {
  if (typeof window === "undefined" && !deps.storage) {
    throw new Error("student identity is only available in the browser runtime");
  }

  const storage = deps.storage ?? window.localStorage;
  const authenticatedId = storage.getItem(AUTHENTICATED_STORAGE_KEY);
  if (isAuthenticatedStudentId(authenticatedId)) return authenticatedId;

  const runtimeDesktopId =
    deps.desktopId ??
    (typeof window !== "undefined" ? window.desktop?.studentId : undefined);
  if (isLocalStudentId(runtimeDesktopId)) return runtimeDesktopId;

  const stored = storage.getItem(STORAGE_KEY);
  if (isLocalStudentId(stored)) return stored;

  const randomUUID = deps.randomUUID ?? createAnonymousUuid;
  const studentId = `local_${randomUUID()}`;
  if (!isLocalStudentId(studentId)) {
    throw new Error("student identity generator returned an invalid UUID");
  }
  storage.setItem(STORAGE_KEY, studentId);
  return studentId;
}

export function setAuthenticatedStudentId(
  studentId: string,
  storage: IdentityStorage = window.localStorage,
): void {
  if (!isAuthenticatedStudentId(studentId)) {
    throw new Error("authenticated student identity is invalid");
  }
  storage.setItem(AUTHENTICATED_STORAGE_KEY, studentId);
}

export function clearAuthenticatedStudentId(
  storage: IdentityStorage = window.localStorage,
): void {
  if (storage.removeItem) storage.removeItem(AUTHENTICATED_STORAGE_KEY);
  else storage.setItem(AUTHENTICATED_STORAGE_KEY, "");
}
