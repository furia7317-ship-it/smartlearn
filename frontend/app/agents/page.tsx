"use client";

import { CustomAgentWorkspace } from "@/components/custom-agent-workspace";
import { PageHeader } from "@/components/layout/page-header";

export default function AgentsPage() {
  return (
    <div className="thin-scroll h-full overflow-y-auto">
      <div className="web-route-frame">
        <PageHeader
          eyebrow="我的智能体"
          title="自建学习智能体"
          desc="给资料生成配一个属于你的执行者：写清职责与系统提示词，再从既有 9 种资料类型里挑一种产出。"
        />
        <CustomAgentWorkspace />
      </div>
    </div>
  );
}
