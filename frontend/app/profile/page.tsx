"use client";

import { UserRound } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { ProfilePanel } from "@/components/profile-panel";

export default function ProfilePage() {
  const { hydrated, profile, tags } = useOrchestratorContext((state) => ({
    hydrated: state.hydrated,
    profile: state.profile,
    tags: state.tags,
  }));

  return (
    <div className="thin-scroll h-full overflow-y-auto">
      <div className="web-route-frame space-y-4">
        <PageHeader
          title="学习画像"
          desc="由对话、练习与行为数据持续生成，不需要填任何表单"
        />
        {!hydrated ? (
          <div className="rounded-xl border border-dashed px-5 py-12 text-center text-sm text-muted-foreground">
            正在恢复学习画像…
          </div>
        ) : tags.length === 0 ? (
          <EmptyState
            icon={UserRound}
            mascot="red-panda"
            title="画像尚未生成"
            desc="和 AI 答疑的智能体聊聊你的学习目标与卡点，学情画像师会从对话里抽取 6 维特征、定位易错点，随后在这里实时呈现。"
            cta={{ href: "/studio", label: "去 AI 答疑对话" }}
          />
        ) : (
          <div className="min-h-[540px] overflow-hidden rounded-xl border bg-card">
            <ProfilePanel profile={profile} tags={tags} />
          </div>
        )}
      </div>
    </div>
  );
}
