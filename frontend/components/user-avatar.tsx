"use client";

import { useRef, useState, type ChangeEvent } from "react";
import Image from "next/image";
import { ImagePlus, RotateCcw } from "lucide-react";

import { useUserAvatar } from "@/hooks/use-user-avatar";
import {
  clearUserAvatar,
  createUserAvatarDataUrl,
  setUserAvatar,
} from "@/lib/user-avatar";
import { cn } from "@/lib/utils";

export function UserAvatar({
  userId,
  name,
  size = 34,
  className,
  fallback = "initial",
}: {
  userId?: string | null;
  name: string;
  size?: number;
  className?: string;
  fallback?: "initial" | "mascot";
}) {
  const avatar = useUserAvatar(userId);
  const initial = (name.trim() || "同学").slice(0, 1).toLocaleUpperCase("zh-CN");

  return (
    <span
      aria-label={`${name || "用户"}的头像`}
      className={cn("desk-user-avatar", className)}
      style={{ width: size, height: size }}
    >
      {avatar ? (
        <Image
          src={avatar}
          alt=""
          width={size}
          height={size}
          unoptimized
        />
      ) : fallback === "mascot" ? (
        <Image
          src="/brand/xueshu-app-icon.png"
          alt=""
          width={size}
          height={size}
          className="object-cover"
        />
      ) : (
        <span aria-hidden>{initial}</span>
      )}
    </span>
  );
}

export function AvatarPicker({
  userId,
  name,
  compact = false,
}: {
  userId?: string | null;
  name: string;
  compact?: boolean;
}) {
  const avatar = useUserAvatar(userId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const chooseAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const dataUrl = await createUserAvatarDataUrl(file);
      setUserAvatar(userId, dataUrl);
      setMessage("头像已更新");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "头像更新失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("desk-avatar-picker", compact && "is-compact")}>
      <div className="desk-avatar-picker__preview">
        <UserAvatar userId={userId} name={name} size={88} />
      </div>
      <div>
        <h3>个人头像</h3>
        <p>选择 JPG、PNG 或 WebP 图片；系统会自动居中裁成方形并压缩。头像只保存在当前设备的这个账户下。</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={chooseAvatar}
        />
        <div className="desk-avatar-picker__actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <ImagePlus className="mr-1.5 inline size-3.5" aria-hidden />
            {busy ? "处理中…" : compact ? "编辑头像" : avatar ? "更换头像" : "上传头像"}
          </button>
          <button
            type="button"
            disabled={busy || !avatar}
            onClick={() => {
              clearUserAvatar(userId);
              setError("");
              setMessage("已恢复默认头像");
            }}
          >
            <RotateCcw className="mr-1.5 inline size-3.5" aria-hidden />
            恢复默认
          </button>
        </div>
        {(message || error) && (
          <p
            className={cn("desk-avatar-picker__message", error && "is-error")}
            role="status"
          >
            {error || message}
          </p>
        )}
      </div>
    </div>
  );
}
