export const NOTE_DRAFT_KEY = "sl_note_draft_v1";

export interface NoteSourceDraft {
  resourceId: string;
  resourceTitle: string;
  resourceType: string;
  selectedText: string;
  createdAt: number;
}

export function createNoteSourceDraft(input: Omit<NoteSourceDraft, "createdAt">): NoteSourceDraft {
  return {
    resourceId: input.resourceId.trim(),
    resourceTitle: input.resourceTitle.trim() || "学习资料",
    resourceType: input.resourceType.trim() || "reading",
    selectedText: input.selectedText.replace(/\s+/g, " ").trim().slice(0, 12000),
    createdAt: Date.now(),
  };
}

export function saveNoteSourceDraft(draft: NoteSourceDraft): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(NOTE_DRAFT_KEY, JSON.stringify(draft));
}

export function readNoteSourceDraft(): NoteSourceDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(NOTE_DRAFT_KEY) || "null") as Partial<NoteSourceDraft> | null;
    if (!value || typeof value !== "object") return null;
    if (
      typeof value.resourceId !== "string" ||
      typeof value.resourceTitle !== "string" ||
      typeof value.resourceType !== "string" ||
      typeof value.selectedText !== "string" ||
      !value.selectedText.trim()
    ) return null;
    return createNoteSourceDraft({
      resourceId: value.resourceId,
      resourceTitle: value.resourceTitle,
      resourceType: value.resourceType,
      selectedText: value.selectedText,
    });
  } catch {
    return null;
  }
}

export function clearNoteSourceDraft(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(NOTE_DRAFT_KEY);
}
