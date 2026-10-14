import { Suspense } from "react";
import { TrainingWorkbench } from "@/components/training/training-workbench";
import { TrainingLoading } from "@/components/training/training-shell";

export default function TrainingWorkbenchPage() { return <Suspense fallback={<TrainingLoading />}><TrainingWorkbench /></Suspense>; }
