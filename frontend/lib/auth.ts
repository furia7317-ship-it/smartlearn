import { API_BASE, markBackendReachable } from "@/lib/api";

export interface AuthUser {
  id: string;
  login: string;
  display_name: string;
  grade: string;
  major: string;
  preferences: string[];
  long_term_goal: string;
  mid_term_goal: string;
  short_term_goal: string;
  onboarding_completed: boolean;
}

export interface OnboardingInput {
  grade: string;
  major: string;
  major_code: string;
  major_level: MajorLevel;
  preferences: string[];
  long_term_goal: string;
  mid_term_goal: string;
  short_term_goal: string;
}

export type MajorLevel = "undergraduate" | "graduate";

export interface MajorCatalogEntry {
  code: string;
  name: string;
  domain: string;
  category: string;
  level: MajorLevel;
}

export class AuthRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AuthRequestError";
    this.status = status;
  }
}

async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}/api/auth${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  markBackendReachable();
  if (!response.ok) {
    let message = response.status === 401 ? "登录状态已失效" : `请求失败 HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { detail?: string | { message?: string } };
      if (typeof body.detail === "string") message = body.detail;
      else if (body.detail?.message) message = body.detail.message;
    } catch {
      // Keep the HTTP fallback when the backend did not return JSON.
    }
    throw new AuthRequestError(response.status, message);
  }
  return response.json() as Promise<T>;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const response = await authRequest<{ user: AuthUser | null }>("/session");
  return response.user;
}

export async function searchMajorCatalog(
  query: string,
  level: MajorLevel,
  signal?: AbortSignal,
): Promise<MajorCatalogEntry[]> {
  const response = await authRequest<{ results: MajorCatalogEntry[] }>(
    `/majors?query=${encodeURIComponent(query)}&level=${level}`,
    { signal },
  );
  return response.results;
}

export function loginAccount(login: string, password: string): Promise<AuthUser> {
  return authRequest<AuthUser>("/login", {
    method: "POST",
    body: JSON.stringify({ login, password }),
  });
}

export function registerAccount(
  login: string,
  password: string,
  anonymousStudentId: string,
): Promise<AuthUser> {
  return authRequest<AuthUser>("/register", {
    method: "POST",
    body: JSON.stringify({
      login,
      password,
      anonymous_student_id: anonymousStudentId,
    }),
  });
}

export function saveOnboarding(input: OnboardingInput): Promise<AuthUser> {
  return authRequest<AuthUser>("/onboarding", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function logoutAccount(): Promise<void> {
  await authRequest<{ ok: boolean }>("/logout", { method: "POST" });
}
