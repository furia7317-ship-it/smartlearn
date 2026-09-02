"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

import { getResourceCenterReturnHref } from "@/lib/resource-center-view";

export function ResourceCenterBackButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      className="desktop-resource-return"
      onClick={() => router.push(getResourceCenterReturnHref())}
    >
      <ArrowLeft aria-hidden className="size-3.5" />
      <span>返回资源中心</span>
    </button>
  );
}
