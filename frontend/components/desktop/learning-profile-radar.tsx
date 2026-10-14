import type { ProfileDim } from "@/lib/types";
import { masteryPercent } from "@/lib/knowledge-mastery";
import styles from "./knowledge-graph.module.css";

const AXES = [
  ["knowledge_level", "知识基础"], ["cognitive_style", "认知匹配"], ["goals", "目标清晰"],
  ["error_profile", "易错管理"], ["pace", "学习节奏"], ["interests", "兴趣投入"],
] as const;
const point = (index: number, radius: number) => {
  const angle = index * Math.PI / 3 - Math.PI / 2;
  return { x: 160 + Math.cos(angle) * radius, y: 108 + Math.sin(angle) * radius };
};

export function LearningProfileRadar({ profile, hasEvidence }: { profile: ProfileDim[]; hasEvidence: boolean }) {
  const axes = AXES.map(([key, label]) => {
    const dimension = profile.find((item) => item.key === key);
    return { key, label, value: hasEvidence ? masteryPercent(dimension?.value) : null };
  });
  const polygon = axes.map((axis, index) => point(index, (axis.value ?? 0) / 100 * 72));
  return <div className={styles.profileOverview}>
    <svg viewBox="0 0 320 216" role="img" aria-label="六维学习画像雷达图，详细数值见画像维度表格" className={styles.profileRadar}>
      {[.25, .5, .75, 1].map((scale) => <polygon key={scale} points={axes.map((_, i) => { const p = point(i, 72 * scale); return `${p.x},${p.y}`; }).join(" ")} fill="none" stroke="#dfd5c4" />)}
      {axes.map((axis, index) => { const p = point(index, 72); const label = point(index, 94); return <g key={axis.key}>
        <line x1="160" y1="108" x2={p.x} y2={p.y} stroke="#e4dccf" />
        <text x={label.x} y={label.y} dy=".35em" textAnchor={index === 0 || index === 3 ? "middle" : index < 3 ? "start" : "end"} fill="#6c5b46" fontSize="14">{axis.label}</text>
      </g>; })}
      {hasEvidence && <><polygon points={polygon.map((p) => `${p.x},${p.y}`).join(" ")} fill="#4c7456" fillOpacity=".18" stroke="#52795b" strokeWidth="2" />
        {polygon.map((p, index) => <circle key={axes[index].key} cx={p.x} cy={p.y} r="3" fill="#52795b" />)}</>}
      {!hasEvidence && <text x="160" y="112" textAnchor="middle" fill="#8f806b" fontSize="12">待形成画像</text>}
    </svg>
    <table className={styles.profileTable} aria-label="学习画像维度数值">
      <thead><tr><th scope="col">画像维度</th><th scope="col">当前分值</th></tr></thead>
      <tbody>{axes.map((axis) => <tr key={axis.key}><th scope="row">{axis.label}</th><td>{axis.value === null ? "—" : `${axis.value} / 100`}</td></tr>)}</tbody>
    </table>
  </div>;
}
