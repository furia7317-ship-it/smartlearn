import { API_BASE, markBackendReachable } from "@/lib/api";

export interface ProfileIdentity {
  student_id: string;
  display_name: string;
  major: string;
  grade: string;
  motto: string;
  strengths: string[];
  updated_at: string | null;
}

export interface ProfileIdentityInput {
  display_name: string;
  motto: string;
  strengths: string[];
}

async function profileIdentityRequest(
  studentId: string,
  init?: RequestInit,
): Promise<ProfileIdentity> {
  const response = await fetch(`${API_BASE}/api/profile/${encodeURIComponent(studentId)}/identity`, {
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
    let message = `个人资料请求失败 HTTP ${response.status}`;
    try {
      const body = await response.json() as { detail?: string | { message?: string } };
      if (typeof body.detail === "string") message = body.detail;
      else if (body.detail?.message) message = body.detail.message;
    } catch {
      // Keep the HTTP fallback when the backend did not return JSON.
    }
    throw new Error(message);
  }
  return response.json() as Promise<ProfileIdentity>;
}

export function getProfileIdentity(studentId: string): Promise<ProfileIdentity> {
  return profileIdentityRequest(studentId);
}

export function saveProfileIdentity(
  studentId: string,
  input: ProfileIdentityInput,
): Promise<ProfileIdentity> {
  return profileIdentityRequest(studentId, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}
