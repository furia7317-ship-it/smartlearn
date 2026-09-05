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

type TeacherWindowStateValue = Pick<TeacherWindowValue, "open" | "wide" | "draft" | "context">;
type TeacherWindowActionsValue = Omit<TeacherWindowValue, keyof TeacherWindowStateValue>;

const TeacherWindowStateContext = createContext<TeacherWindowStateValue | null>(null);
const TeacherWindowActionsContext = createContext<TeacherWindowActionsValue | null>(null);
const TeacherWindowOpenContext = createContext<boolean | null>(null);

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

  const stateValue = useMemo<TeacherWindowStateValue>(() => ({
    open,
    wide,
    draft,
    context,
  }), [context, draft, open, wide]);
  const actionsValue = useMemo<TeacherWindowActionsValue>(() => ({
    openTeacher,
    minimizeTeacher,
    toggleWide,
    setDraft,
    clearContext,
  }), [clearContext, minimizeTeacher, openTeacher, toggleWide]);

  return (
    <TeacherWindowActionsContext.Provider value={actionsValue}>
      <TeacherWindowOpenContext.Provider value={open}>
        <TeacherWindowStateContext.Provider value={stateValue}>
          {children}
          <Suspense fallback={null}>
            <TeacherWindowQuerySync onOpen={openTeacherFromQuery} />
          </Suspense>
        </TeacherWindowStateContext.Provider>
      </TeacherWindowOpenContext.Provider>
    </TeacherWindowActionsContext.Provider>
  );
}

export function useTeacherWindow(): TeacherWindowValue {
  const state = useContext(TeacherWindowStateContext);
  const actions = useContext(TeacherWindowActionsContext);
  const value = useMemo(() => state && actions ? { ...state, ...actions } : null, [actions, state]);
  if (!value) {
    throw new Error("useTeacherWindow 必须在 <TeacherWindowProvider> 内使用");
  }
  return value;
}

/** Read stable window actions without subscribing the caller to draft/window state. */
export function useTeacherWindowActions(): TeacherWindowActionsValue {
  const actions = useContext(TeacherWindowActionsContext);
  if (!actions) {
    throw new Error("useTeacherWindowActions 必须在 <TeacherWindowProvider> 内使用");
  }
  return actions;
}

/** Subscribe only to the open flag, avoiding updates from draft and size changes. */
export function useTeacherWindowOpen(): boolean {
  const open = useContext(TeacherWindowOpenContext);
  if (open === null) {
    throw new Error("useTeacherWindowOpen 必须在 <TeacherWindowProvider> 内使用");
  }
  return open;
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
  const { openTeacher } = useTeacherWindowActions();

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
