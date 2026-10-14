"use client";

import { useMemo } from "react";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { currentTrainingPath } from "@/lib/training-generation";

export function useTrainingPath() {
  const session = useOrchestratorContext((state) => ({
    masterPath: state.masterPath, path: state.path, masterPathScheduleAnchor: state.masterPathScheduleAnchor,
    pathScheduleAnchor: state.pathScheduleAnchor, hydrated: state.hydrated,
  }));
  const { masterPath, path, masterPathScheduleAnchor, pathScheduleAnchor, hydrated } = session;
  return useMemo(() => ({ ...currentTrainingPath({ masterPath, path, masterPathScheduleAnchor, pathScheduleAnchor }), hydrated }), [masterPath, path, masterPathScheduleAnchor, pathScheduleAnchor, hydrated]);
}
