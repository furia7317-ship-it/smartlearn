"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

import {
  readDesktopModuleView,
  saveDesktopModuleView,
  type DesktopModuleId,
} from "@/lib/desktop-module-view";

export function useDesktopModuleStringState<T extends string = string>(
  moduleId: DesktopModuleId,
  key: string,
  initialValue: T,
  allowedValues?: readonly T[]
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(initialValue);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const candidate = readDesktopModuleView(moduleId).values[key];
    const valid =
      typeof candidate === "string" &&
      candidate.length <= 1_000 &&
      (!allowedValues || allowedValues.includes(candidate as T));
    setValue(valid ? candidate as T : initialValue);
    setRestored(true);
  }, [allowedValues, initialValue, key, moduleId]);

  useEffect(() => {
    if (!restored) return;
    const current = readDesktopModuleView(moduleId);
    saveDesktopModuleView(moduleId, {
      values: { ...current.values, [key]: value },
    });
  }, [key, moduleId, restored, value]);

  return [value, setValue];
}
