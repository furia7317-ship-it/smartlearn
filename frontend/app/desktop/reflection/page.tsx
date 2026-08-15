import { Suspense } from "react";

import { ReflectionWorkspace } from "@/components/reflection-workspace";

export default function DesktopReflectionPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">正在打开复盘工作台…</div>}>
      <ReflectionWorkspace />
    </Suspense>
  );
}
