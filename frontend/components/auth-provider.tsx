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
    setAuthenticatedStudentId(nextUser.id);
    syncAccountToLocalSettings(nextUser);
    setUser(nextUser);
    setServiceError("");
    return nextUser;
  }, []);

  const refresh = useCallback(async () => {
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
    try {
      await logoutAccount();
    } catch {
      // Local identity must still be cleared when the backend is temporarily unavailable.
    } finally {
      clearAuthenticatedStudentId();
      setUser(null);
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
