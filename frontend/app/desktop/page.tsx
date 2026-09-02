"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

import { DesktopHomeDossier } from "@/components/desktop/desktop-home-dossier";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { useUserSettings } from "@/hooks/use-user-settings";
import { useDesktopModuleStringState } from "@/hooks/use-desktop-module-view-state";
import { fetchBehaviorDashboard } from "@/lib/api";
import { buildPathDashboardPlan } from "@/lib/daily-task-plan";
import {
  getMaterialData,
  listAssessments,
  listPapers,
  type AssessmentRecord,
  type PaperSummary,
} from "@/lib/library";
import {
  LEARNING_ACTIVITY_UPDATED_EVENT,
  learningActivityFromPersistedUsage,
  readLearningActivityEvents,
  type LearningActivityEvent,
} from "@/lib/learning-activity";
import {
  buildLearningAnalytics,
  type MasteryEvidence,
  type PracticeTopic,
} from "@/lib/learning-analytics";
import { resolveResourceForTaskTarget } from "@/lib/path-resource-links";
import { getStudentId } from "@/lib/student-identity";
import type { ResourceItem } from "@/lib/types";

const ResourceViewer = dynamic(
  () => import("@/components/resource-viewer").then((module) => module.ResourceViewer),
  { ssr: false },
);

export default function DesktopHome() {
  const session = useOrchestratorContext();
  const { name, major, grade } = useUserSettings();
  const [assessments, setAssessments] = useState<AssessmentRecord[]>([]);
  const [papers, setPapers] = useState<PaperSummary[]>([]);
  const [activities, setActivities] = useState<LearningActivityEvent[]>([]);
  const [serverActivities, setServerActivities] = useState<LearningActivityEvent[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [openItem, setOpenItem] = useState<ResourceItem | null>(null);
  const [resourceViewerActivated, setResourceViewerActivated] = useState(false);
  const [selectedTaskKey, setSelectedTaskKey] = useDesktopModuleStringState<string>(
    "home",
    "dossier.task",
    ""
  );
  const displayName = name.trim() || "同学";

  useEffect(() => {
    if (!session.hydrated || session.mode === "checking") return;
    let active = true;
    setAnalyticsLoading(true);
    void Promise.all([
      listAssessments(session.mode),
      listPapers(session.mode),
    ]).then(([nextAssessments, nextPapers]) => {
      if (!active) return;
      setAssessments(nextAssessments);
      setPapers(nextPapers);
    }).finally(() => {
      if (active) setAnalyticsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [session.hydrated, session.mode]);

  useEffect(() => {
    const learnerId = getStudentId();
    const refresh = () => setActivities(readLearningActivityEvents(window.localStorage, learnerId));
    refresh();
    window.addEventListener(LEARNING_ACTIVITY_UPDATED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(LEARNING_ACTIVITY_UPDATED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  useEffect(() => {
    if (!session.hydrated || session.mode !== "live") {
      setServerActivities([]);
      return;
    }
    const learnerId = getStudentId();
    const controller = new AbortController();
    void fetchBehaviorDashboard(learnerId, 30, controller.signal)
      .then((dashboard) => {
        setServerActivities(
          dashboard.usage_history
            .map((day) => learningActivityFromPersistedUsage(day, learnerId))
            .filter((event): event is LearningActivityEvent => Boolean(event)),
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setServerActivities([]);
      });
    return () => controller.abort();
  }, [session.hydrated, session.mode]);

  const analyticsActivities = useMemo(() => {
    const byId = new Map<string, LearningActivityEvent>();
    for (const event of [...serverActivities, ...activities]) byId.set(event.id, event);
    return Array.from(byId.values());
  }, [activities, serverActivities]);

  const resources = useMemo(() => {
    const seen = new Set<string>();
    const merged: ResourceItem[] = [];
    for (const resource of session.resources) {
      if (resource.status !== "ready" || seen.has(resource.id)) continue;
      seen.add(resource.id);
      merged.push(resource);
    }
    return merged;
  }, [session.resources]);

  const dashboard = useMemo(
    () => buildPathDashboardPlan(session.masterPath, session.completedMaterials, {
      anchorDate: session.masterPathScheduleAnchor,
    }),
    [session.masterPath, session.completedMaterials, session.masterPathScheduleAnchor]
  );
  const totalTasks = dashboard.stages.reduce((sum, stage) => sum + stage.taskCount, 0);
  const completedTasks = dashboard.stages.reduce(
    (sum, stage) => sum + stage.completedTaskCount,
    0
  );
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const todayPlan = dashboard.today?.plan;
  const deskSteps = todayPlan?.tasks.slice(0, 7) ?? [];
  const currentTaskIndex = Math.max(0, deskSteps.findIndex((task) => !task.completed));
  const selectedTaskIndex = deskSteps.findIndex((task) => task.key === selectedTaskKey);
  const activeTaskIndex = selectedTaskIndex >= 0 ? selectedTaskIndex : currentTaskIndex;
  const selectedTask = deskSteps[activeTaskIndex];
  const selectedResource = selectedTask?.resourceTargets
    .map((target) => resolveResourceForTaskTarget(target, selectedTask, resources))
    .find((resource): resource is ResourceItem => Boolean(resource));

  const masteryEvidence = useMemo<MasteryEvidence[]>(() => [
    ...assessments.flatMap((assessment) =>
      Object.entries(assessment.analysis.knowledge_seed ?? {}).flatMap(([knowledgePoint, score]) =>
        Number.isFinite(score)
          ? [{
              knowledgePoint,
              subject: assessment.subject || knowledgePoint,
              score,
              measuredAt: assessment.created_at,
              source: "diagnostic" as const,
            }]
          : [])),
    ...papers.flatMap((paper) => paper.overall_score === null
      ? []
      : [{
          knowledgePoint: paper.topic || paper.title,
          subject: paper.topic || paper.title,
          score: paper.overall_score,
          measuredAt: paper.created_at,
          source: "practice" as const,
        }]),
  ], [assessments, papers]);

  const practiceTopics = useMemo<Record<string, PracticeTopic>>(() => {
    const topics: Record<string, PracticeTopic> = {};
    session.subjectPaths.forEach((subject) => {
      subject.path.forEach((stage) => {
        (stage.steps ?? []).forEach((task) => {
          (task.resources ?? []).forEach((resource) => {
            topics[resource.id] = {
              subject: subject.title,
              knowledgePoints: [stage.title, task.title].filter(Boolean),
            };
          });
        });
      });
    });
    return topics;
  }, [session.subjectPaths]);

  const analytics = useMemo(() => buildLearningAnalytics({
    activities: analyticsActivities,
    masteryEvidence,
    practiceAttempts: session.practiceAttempts,
    practiceTopics,
    subjectPaths: session.subjectPaths,
    tasks: Object.entries(session.taskEvidence).map(([id, evidence]) => ({
      id,
      occurredAt: evidence.completedAt,
      completed: evidence.passed !== false,
      passed: evidence.passed,
    })),
    rangeDays: 30,
  }), [
    analyticsActivities,
    masteryEvidence,
    practiceTopics,
    session.practiceAttempts,
    session.subjectPaths,
    session.taskEvidence,
  ]);

  const openResource = async (resource: ResourceItem) => {
    setResourceViewerActivated(true);
    setOpenItem(resource);
    if (resource.data || session.mode !== "live") return;
    const data = await getMaterialData(session.mode, resource.id);
    if (data) {
      setOpenItem((current) =>
        current?.id === resource.id ? { ...current, data } : current
      );
    }
  };

  return (
    <>
      <DesktopHomeDossier
        displayName={displayName}
        major={major}
        grade={grade}
        progress={progress}
        todayPlan={todayPlan}
        tasks={deskSteps}
        activeTaskIndex={activeTaskIndex}
        selectedTask={selectedTask}
        selectedResource={selectedResource}
        resources={resources}
        analytics={analytics}
        activities={analyticsActivities}
        masteryEvidence={masteryEvidence}
        loading={analyticsLoading || !session.hydrated}
        hasLearningPath={session.masterPath.length > 0}
        onSelectTask={setSelectedTaskKey}
        onOpenResource={openResource}
      />
      {resourceViewerActivated ? (
        <ResourceViewer item={openItem} onClose={() => setOpenItem(null)} />
      ) : null}
    </>
  );
}
