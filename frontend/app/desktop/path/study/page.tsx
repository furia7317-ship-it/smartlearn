import { Suspense } from "react";
import FocusStudyRouter from "@/components/desktop/focus-study";

export default function Page() {
  return <Suspense fallback={<div className="p-8">正在恢复学习记录…</div>}><FocusStudyRouter /></Suspense>;
}
