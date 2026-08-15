"use client";

import { CustomAgentWorkspace } from "@/components/custom-agent-workspace";

export default function DesktopAgents() {
  return (
    <div className="thin-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-[1080px] space-y-5 px-8 py-7">
        <header>
          <h1 className="font-display text-2xl font-semibold">我的智能体</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            自建的是资料生成的「执行者」，不是新的资料类型；产出类型仍从既有 9 种里选，随后在学习资料规划的执行者下拉里指派。
          </p>
        </header>
        <CustomAgentWorkspace />
      </div>
    </div>
  );
}
