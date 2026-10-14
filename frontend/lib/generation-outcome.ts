export function generationOutcome(data: Record<string, unknown>) {
  const ready = Math.max(0, Number(data.ready_total) || 0);
  const complete = data.status === "completed" && data.completed === true;
  if (complete) return { failed: false, message: `已完成并保存 ${ready} 份资料` };
  if (data.error_code === "review_unavailable") return { failed: true, message: ready > 0 ? `已保存 ${ready} 份资料；其余资料审核未完成` : "审核暂未完成，内容未发布。可以重试。" };
  const detail = typeof data.message === "string" ? data.message : "生成或审核未完成，可以重试。";
  return { failed: true, message: ready > 0 ? `部分完成：已保存 ${ready} 份资料。${detail}` : detail };
}
