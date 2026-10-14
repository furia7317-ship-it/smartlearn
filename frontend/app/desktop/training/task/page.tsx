import { Suspense } from "react";
import { TrainingDetail } from "@/components/training/training-detail";
import { TrainingLoading } from "@/components/training/training-shell";

export default function TrainingTaskPage() { return <Suspense fallback={<TrainingLoading />}><TrainingDetail /></Suspense>; }
