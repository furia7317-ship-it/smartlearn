"use client";

import { HomeScrollStory } from "@/components/home/home-scroll-story";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { buildPathDashboardPlan } from "@/lib/daily-task-plan";
import {
  getDashboardInsights,
  getHomeModules,
  hasLearningSession,
} from "@/lib/session-insights";

export default function DashboardPage() {
  const session = useOrchestratorContext();
  const dashboardSession = { ...session, path: session.masterPath };
  const hasSession = hasLearningSession(dashboardSession);
  const insights = getDashboardInsights(dashboardSession);
  const modules = getHomeModules(dashboardSession);
  const pathDashboard = buildPathDashboardPlan(session.masterPath, session.completedMaterials, {
    anchorDate: session.masterPathScheduleAnchor,
  });
  const todayPlan = pathDashboard.today?.plan;
  const studyTime = {
    plannedMinutes: todayPlan?.totalMinutes ?? 0,
    completedMinutes: todayPlan?.tasks
      .filter((task) => task.completed)
      .reduce((total, task) => total + task.minutes, 0) ?? 0,
    days: pathDashboard.stages.slice(0, 7).map((stage) => ({
      day: stage.day,
      minutes: stage.totalMinutes,
      current: stage.current,
    })),
  };

  return (
    <HomeScrollStory
      hasSession={hasSession}
      hydrated={session.hydrated}
      mode={session.mode}
      pathReady={session.masterPath.length > 0}
      insights={insights}
      modules={modules}
      resources={session.resources}
      studyTime={studyTime}
    />
  );
}
