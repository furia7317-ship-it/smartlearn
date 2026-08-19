"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  AuthRequestError,
  getCurrentUser,
  loginAccount,
  logoutAccount,
  registerAccount,
  saveOnboarding,
  type AuthUser,
  type OnboardingInput,
} from "@/lib/auth";
import {
  clearAuthenticatedStudentId,
  getStudentId,
  setAuthenticatedStudentId,
} from "@/lib/student-identity";
import { DEFAULT_GRADE, normalizeGrade, setUserSettings } from "@/lib/user-settings";


interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  serviceError: string;
  login: (login: string, password: string) => Promise<AuthUser>;
  register: (login: string, password: string) => Promise<AuthUser>;
  completeOnboarding: (input: OnboardingInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const LOCALLY_SIGNED_OUT_KEY = "sl_auth_locally_signed_out_v1";

function isLocallySignedOut(): boolean {
  try {
    return window.localStorage.getItem(LOCALLY_SIGNED_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

function setLocallySignedOut(value: boolean): void {
  try {
    if (value) window.localStorage.setItem(LOCALLY_SIGNED_OUT_KEY, "1");
    else window.localStorage.removeItem(LOCALLY_SIGNED_OUT_KEY);
  } catch {
    /* the in-memory auth state remains authoritative for this page */
  }
}

function syncAccountToLocalSettings(user: AuthUser): void {
  setUserSettings({
    name: user.display_name,
    major: user.major,
    grade: normalizeGrade(user.grade || DEFAULT_GRADE),
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [serviceError, setServiceError] = useState("");

  const applyUser = useCallback((nextUser: AuthUser) => {
    setLocallySignedOut(false);
    setAuthenticatedStudentId(nextUser.id);
    syncAccountToLocalSettings(nextUser);
    setUser(nextUser);
    setServiceError("");
    return nextUser;
  }, []);

  const refresh = useCallback(async () => {
    if (isLocallySignedOut()) {
      clearAuthenticatedStudentId();
      setUser(null);
      setServiceError("");
      setLoading(false);
      return;
    }
    try {
      const nextUser = await getCurrentUser();
      if (nextUser) {
        applyUser(nextUser);
      } else {
        clearAuthenticatedStudentId();
        setUser(null);
        setServiceError("");
      }
    } catch (error) {
      setUser(null);
      if (error instanceof AuthRequestError && error.status === 401) {
        clearAuthenticatedStudentId();
        setServiceError("");
      } else {
        setServiceError("暂时无法连接账户服务，请确认后端已经启动。");
      }
    } finally {
      setLoading(false);
    }
  }, [applyUser]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!serviceError || isLocallySignedOut()) return;
    const retry = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = window.setInterval(retry, 2_500);
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", retry);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", retry);
    };
  }, [refresh, serviceError]);

  const login = useCallback(async (account: string, password: string) => {
    return applyUser(await loginAccount(account, password));
  }, [applyUser]);

  const register = useCallback(async (account: string, password: string) => {
    const anonymousStudentId = getStudentId();
    return applyUser(await registerAccount(account, password, anonymousStudentId));
  }, [applyUser]);

  const completeOnboarding = useCallback(async (input: OnboardingInput) => {
    return applyUser(await saveOnboarding(input));
  }, [applyUser]);

  const logout = useCallback(async () => {
    setLocallySignedOut(true);
    clearAuthenticatedStudentId();
    setUser(null);
    setServiceError("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5_000);
    try {
      await logoutAccount(controller.signal);
    } catch {
      // Local identity must still be cleared when the backend is temporarily unavailable.
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    serviceError,
    login,
    register,
    completeOnboarding,
    logout,
    refresh,
  }), [completeOnboarding, loading, login, logout, refresh, register, serviceError, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
