"use client";

import { useEffect, useState } from "react";

import { getUserAvatar, onUserAvatarChange } from "@/lib/user-avatar";

export function useUserAvatar(userId?: string | null): string {
  const [avatar, setAvatar] = useState("");

  useEffect(() => {
    const sync = () => setAvatar(getUserAvatar(userId));
    sync();
    return onUserAvatarChange(sync);
  }, [userId]);

  return avatar;
}
