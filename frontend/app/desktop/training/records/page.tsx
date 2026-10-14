import { Suspense } from "react";
import { TrainingRecords } from "@/components/training/training-records";
import { TrainingLoading } from "@/components/training/training-shell";

export default function TrainingRecordsPage() {
  return <Suspense fallback={<TrainingLoading />}><TrainingRecords /></Suspense>;
}
