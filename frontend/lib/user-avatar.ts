/** User-selected avatar persistence and browser-side image normalization. */

export const USER_AVATAR_EVENT = "sl-user-avatar-changed";
export const USER_AVATAR_MAX_SOURCE_BYTES = 8 * 1024 * 1024;
export const USER_AVATAR_OUTPUT_SIZE = 320;

const STORAGE_PREFIX = "sl_user_avatar_v1:";
const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function userAvatarStorageKey(userId?: string | null): string {
  const normalized = (userId || "local").trim() || "local";
  return `${STORAGE_PREFIX}${normalized}`;
}

export function isSupportedAvatarDataUrl(value: string): boolean {
  return /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(value);
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function getUserAvatar(
  userId?: string | null,
  storage: Pick<Storage, "getItem"> | null = browserStorage(),
): string {
  if (!storage) return "";
  const value = storage.getItem(userAvatarStorageKey(userId)) || "";
  return isSupportedAvatarDataUrl(value) ? value : "";
}

export function setUserAvatar(
  userId: string | null | undefined,
  dataUrl: string,
  storage: Pick<Storage, "setItem"> | null = browserStorage(),
): void {
  if (!isSupportedAvatarDataUrl(dataUrl)) {
    throw new Error("头像数据格式无效");
  }
  if (!storage) return;
  storage.setItem(userAvatarStorageKey(userId), dataUrl);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(USER_AVATAR_EVENT, { detail: { userId: userId || "local" } }),
    );
  }
}

export function clearUserAvatar(
  userId?: string | null,
  storage: Pick<Storage, "removeItem"> | null = browserStorage(),
): void {
  if (!storage) return;
  storage.removeItem(userAvatarStorageKey(userId));
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(USER_AVATAR_EVENT, { detail: { userId: userId || "local" } }),
    );
  }
}

export function onUserAvatarChange(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(USER_AVATAR_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(USER_AVATAR_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法读取这张图片"));
    image.src = source;
  });
}

export async function createUserAvatarDataUrl(file: File): Promise<string> {
  if (!SUPPORTED_TYPES.has(file.type)) {
    throw new Error("请选择 JPG、PNG 或 WebP 图片");
  }
  if (file.size > USER_AVATAR_MAX_SOURCE_BYTES) {
    throw new Error("图片不能超过 8 MB");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
    const sourceX = (image.naturalWidth - sourceSize) / 2;
    const sourceY = (image.naturalHeight - sourceSize) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = USER_AVATAR_OUTPUT_SIZE;
    canvas.height = USER_AVATAR_OUTPUT_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法处理图片");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      USER_AVATAR_OUTPUT_SIZE,
      USER_AVATAR_OUTPUT_SIZE,
    );
    return canvas.toDataURL("image/webp", 0.86);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
