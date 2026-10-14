"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import styles from "./switch.module.css";

export function Switch({ checked, onCheckedChange, label, className, ...props }: Omit<ComponentProps<"button">, "onChange" | "children"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
}) {
  return <button {...props} type="button" role="switch" aria-checked={checked} aria-label={label}
    className={cn(styles.track, className)} onClick={() => onCheckedChange(!checked)}>
    <span aria-hidden="true" className={styles.thumb} />
  </button>;
}
