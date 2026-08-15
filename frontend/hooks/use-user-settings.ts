"use client";

import { useEffect, useState } from "react";

import {
  getUserSettings,
  onUserSettingsChange,
  type UserSettings,
} from "@/lib/user-settings";

/**
 * 响应式读取全局用户学情设置：挂载后从 localStorage 同步，并订阅同窗口的实时变更，
 * 因此在设置页改完昵称/专业/年级，主页等处会立刻跟着更新。
 *
 * 初始返回空值（与服务端静态导出渲染一致，避免水合不一致），挂载后再填真值。
 */
export function useUserSettings(): UserSettings {
  const [settings, setSettings] = useState<UserSettings>({
    name: "",
    major: "",
    grade: "",
  });

  useEffect(() => {
    const sync = () => setSettings(getUserSettings());
    sync();
    return onUserSettingsChange(sync);
  }, []);

  return settings;
}
