"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Volume2, VolumeX } from "lucide-react";

import {
  getDesktopSoundEnabled,
  getDesktopSoundVolume,
  isDesktopSound,
  playDesktopInteraction,
  preloadDesktopSounds,
  setDesktopSoundEnabled,
  setDesktopSoundVolume,
  stopDesktopSounds,
  subscribeDesktopSoundPreference,
  type DesktopSound,
} from "@/lib/desktop-sounds";

const getServerSoundEnabled = () => true;
const getServerSoundVolume = () => 70;

const PREVIEWS: Array<{ sound: DesktopSound; label: string }> = [
  { sound: "navigate", label: "页面导航 · 纸张轻移" },
  { sound: "press", label: "按钮点击 · 木质轻点" },
  { sound: "select", label: "筛选选择 · 柔和短点" },
  { sound: "page-open", label: "展开书页 · 纸声" },
  { sound: "page-close", label: "合上书页 · 轻落" },
  { sound: "run", label: "开始运行 · 短促木音" },
  { sound: "complete", label: "任务完成 · 钢琴轻音" },
  { sound: "success", label: "验证通过 · 温和弦音" },
  { sound: "error", label: "需要检查 · 低声提示" },
];

export function DesktopSoundFeedback({ scopeSelector = ".desktop-scope" }: { scopeSelector?: string }) {
  useEffect(() => {
    const preloadTimer = window.setTimeout(preloadDesktopSounds, 300);
    const onClick = (event: MouseEvent) => {
      if (!event.isTrusted || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const control = target?.closest<HTMLElement>("button, a[href], summary");
      if (!control?.closest(scopeSelector)) return;
      if (control.closest('[data-desktop-sound="off"]')) return;
      if (control.matches(':disabled, [aria-disabled="true"], [aria-busy="true"]')) return;
      if (control.closest('[inert], [aria-hidden="true"]')) return;
      if (["page", "location"].includes(control.getAttribute("aria-current") || "") || control.getAttribute("aria-selected") === "true") return;
      const hint = control.dataset.desktopSound;
      if (isDesktopSound(hint)) { playDesktopInteraction(hint); return; }
      if (control instanceof HTMLButtonElement && control.type === "submit" && control.form?.getAttribute("role") === "search") return;
      if (control instanceof HTMLAnchorElement) {
        if (control.href === window.location.href) return;
        playDesktopInteraction("navigate");
      } else if (control.tagName === "SUMMARY") {
        playDesktopInteraction(control.parentElement?.hasAttribute("open") ? "collapse" : "expand");
      } else if (control.hasAttribute("aria-expanded")) {
        playDesktopInteraction(control.getAttribute("aria-expanded") === "true" ? "collapse" : "expand");
      } else if (control.getAttribute("role") === "switch") {
        playDesktopInteraction(control.getAttribute("aria-checked") === "true" ? "collapse" : "expand");
      } else if (control.hasAttribute("aria-pressed") || control.getAttribute("role") === "tab") {
        playDesktopInteraction("select");
      } else {
        playDesktopInteraction("press");
      }
    };
    const onChange = (event: Event) => {
      const target = event.target;
      if (!event.isTrusted || !(target instanceof Element) || !target.closest(scopeSelector) || target.closest('[data-desktop-sound="off"]')) return;
      if (target instanceof HTMLSelectElement) playDesktopInteraction("select");
      else if (target instanceof HTMLInputElement && ["checkbox", "radio", "range"].includes(target.type)) {
        playDesktopInteraction(target.type === "checkbox" ? target.checked ? "expand" : "collapse" : "select");
      }
    };
    const onSubmit = (event: SubmitEvent) => {
      const form = event.target;
      if (event.isTrusted && form instanceof HTMLFormElement && form.closest(scopeSelector) && form.getAttribute("role") === "search") {
        playDesktopInteraction("search");
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") stopDesktopSounds();
    };
    const onPreference = () => {
      if (!getDesktopSoundEnabled() || getDesktopSoundVolume() === 0) stopDesktopSounds();
      else preloadDesktopSounds();
    };
    document.addEventListener("click", onClick, { capture: true });
    document.addEventListener("change", onChange, { capture: true });
    document.addEventListener("submit", onSubmit, { capture: true });
    document.addEventListener("visibilitychange", onVisibility);
    const unsubscribe = subscribeDesktopSoundPreference(onPreference);
    return () => {
      window.clearTimeout(preloadTimer);
      document.removeEventListener("click", onClick, { capture: true });
      document.removeEventListener("change", onChange, { capture: true });
      document.removeEventListener("submit", onSubmit, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribe();
      stopDesktopSounds();
    };
  }, [scopeSelector]);
  return null;
}

export function DesktopSoundToggle({ className }: { className?: string }) {
  const volumeId = useId();
  const [preview, setPreview] = useState(-1);
  const enabled = useSyncExternalStore(
    subscribeDesktopSoundPreference,
    getDesktopSoundEnabled,
    getServerSoundEnabled,
  );
  const volume = useSyncExternalStore(subscribeDesktopSoundPreference, getDesktopSoundVolume, getServerSoundVolume);
  const Icon = enabled ? Volume2 : VolumeX;
  return (
    <><button
      type="button"
      className={className}
      data-desktop-sound="off"
      aria-pressed={enabled}
      aria-label="界面声效"
      title={enabled ? "关闭界面声效" : "开启界面声效"}
      onClick={() => setDesktopSoundEnabled(!enabled)}
    >
      <Icon aria-hidden className="size-4" />
      <span>界面声效：{enabled ? "开启" : "静音"}</span>
    </button>
    {enabled && <div className="desktop-sound-settings" data-desktop-sound="off">
      <label htmlFor={volumeId}>声效音量 <span>{volume}%</span></label>
      <input id={volumeId} aria-label="声效音量" type="range" min="0" max="100" step="5" value={volume}
        onChange={(event) => setDesktopSoundVolume(Number(event.target.value))} />
      <button type="button" onClick={() => {
        const next = (preview + 1) % PREVIEWS.length;
        setPreview(next);
        playDesktopInteraction(PREVIEWS[next].sound);
      }}>试听不同声效</button>
      <small aria-live="polite">{preview < 0 ? "纸张、木质轻点与柔和提示" : PREVIEWS[preview].label}</small>
    </div>}</>
  );
}
