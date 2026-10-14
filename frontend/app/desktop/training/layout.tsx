import type { ReactNode } from "react";
import { TrainingProvider } from "@/components/training/training-provider";
import { TrainingShell } from "@/components/training/training-shell";

export default function TrainingLayout({ children }: { children: ReactNode }) {
  return <TrainingProvider><TrainingShell>{children}</TrainingShell></TrainingProvider>;
}
