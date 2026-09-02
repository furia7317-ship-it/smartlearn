"use client";

import {
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";

import type { TutorPageContext } from "@/lib/types";

export type TeacherWindowContext = TutorPageContext;

export interface TeacherWindowValue {
  open: boolean;
  wide: boolean;
  draft: string;
  context: TeacherWindowContext | null;
  openTeacher: (context?: TeacherWindowContext) => void;
  minimizeTeacher: () => void;
  toggleWide: () => void;
  setDraft: Dispatch<SetStateAction<string>>;
  clearContext: () => void;
}

const TeacherWindowContextState = createContext<TeacherWindowValue | null>(null);

function TeacherWindowQuerySync({ onOpen }: { onOpen: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const shouldOpen = searchParams.get("teacher") === "open";

  useEffect(() => {
    if (shouldOpen) onOpen();
  }, [onOpen, pathname, shouldOpen]);

  return null;
}

/**
 * Persistent state for the desktop teacher window. Keep this provider above
 * the desktop shell so route changes do not discard its draft or window mode.
 */
export function TeacherWindowProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [draft, setDraft] = useState("");
  const [context, setContext] = useState<TeacherWindowContext | null>(null);

  const openTeacher = useCallback((nextContext?: TeacherWindowContext) => {
    if (nextContext !== undefined) setContext(nextContext);
    setOpen(true);
  }, []);
  const openTeacherFromQuery = useCallback(() => setOpen(true), []);
  const minimizeTeacher = useCallback(() => setOpen(false), []);
  const toggleWide = useCallback(() => setWide((current) => !current), []);
  const clearContext = useCallback(() => setContext(null), []);

  useEffect(() => {
    setContext(null);
  }, [pathname]);

  const value = useMemo<TeacherWindowValue>(() => ({
    open,
    wide,
    draft,
    context,
    openTeacher,
    minimizeTeacher,
    toggleWide,
    setDraft,
    clearContext,
  }), [clearContext, context, draft, minimizeTeacher, open, openTeacher, toggleWide, wide]);

  return (
    <TeacherWindowContextState.Provider value={value}>
      {children}
      <Suspense fallback={null}>
        <TeacherWindowQuerySync onOpen={openTeacherFromQuery} />
      </Suspense>
    </TeacherWindowContextState.Provider>
  );
}

export function useTeacherWindow(): TeacherWindowValue {
  const value = useContext(TeacherWindowContextState);
  if (!value) {
    throw new Error("useTeacherWindow 必须在 <TeacherWindowProvider> 内使用");
  }
  return value;
}

export type TeacherOpenButtonProps = ComponentPropsWithoutRef<"button"> & {
  context?: TeacherWindowContext;
};

export function TeacherOpenButton({
  children,
  className,
  context,
  onClick,
  type = "button",
  ...props
}: TeacherOpenButtonProps) {
  const { openTeacher } = useTeacherWindow();

  return (
    <button
      {...props}
      type={type}
      className={className}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) openTeacher(context);
      }}
    >
      {children}
    </button>
  );
}
