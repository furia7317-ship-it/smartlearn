import type { PathStep, PathTask, ResourceItem } from "./types";

export interface StudyStage {
  key: string;
  index: number;
  day: string;
  title: string;
  desc: string;
  objective?: string;
  minutes: number;
  state: PathStep["state"];
  tasks: PathTask[];
  resources: ResourceItem[];
}

function usable(resource: ResourceItem): boolean {
  return resource.status === "ready";
}

export function buildStudyPlan(
  path: PathStep[],
  resources: ResourceItem[]
): StudyStage[] {
  return path.map((step, index) => {
    const tasks = step.steps ?? [];
    const selected: ResourceItem[] = [];
    const seen = new Set<string>();
    const add = (resource: ResourceItem | undefined) => {
      if (!resource || !usable(resource) || seen.has(resource.id)) return;
      seen.add(resource.id);
      selected.push(resource);
    };

    for (const task of tasks) {
      for (const target of task.resources ?? []) {
        add(resources.find((resource) => resource.id === target.id));
      }
      for (const type of task.resource_types ?? []) {
        add(
          resources.find(
            (resource) => resource.type === type && usable(resource)
          )
        );
      }
    }

    if (tasks.length === 0) {
      for (const type of step.types ?? []) {
        add(
          resources.find(
            (resource) => resource.type === type && usable(resource)
          )
        );
      }
    }

    return {
      key: `${step.day}-${index}`,
      index,
      day: step.day,
      title: step.title,
      desc: step.desc,
      objective: step.objective,
      minutes:
        step.minutes ?? tasks.reduce((sum, task) => sum + task.minutes, 0),
      state: step.state,
      tasks,
      resources: selected,
    };
  });
}

export function defaultStudyStageIndex(stages: StudyStage[]): number {
  const current = stages.findIndex((stage) => stage.state === "current");
  return current >= 0 ? current : 0;
}
