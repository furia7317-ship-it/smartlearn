"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

export function DesktopHomeProgressChart({ progress }: { progress: number }) {
  return (
    <ResponsiveContainer
      width="100%"
      height="100%"
      minWidth={0}
      minHeight={0}
      initialDimension={{ width: 112, height: 112 }}
    >
      <RadialBarChart
        data={[{ value: progress, fill: "#b73727" }]}
        startAngle={90}
        endAngle={-270}
        innerRadius="72%"
        outerRadius="98%"
      >
        <RadialBar dataKey="value" background={{ fill: "#e9e1d5" }} cornerRadius={8} />
      </RadialBarChart>
    </ResponsiveContainer>
  );
}

export function DesktopHomeMiniTrendChart({
  data,
}: {
  data: Array<{ label: string; score: number }>;
}) {
  return (
    <ResponsiveContainer
      width="100%"
      height="100%"
      minWidth={0}
      minHeight={0}
      initialDimension={{ width: 180, height: 72 }}
    >
      <LineChart data={data}>
        <Line
          dataKey="score"
          stroke="#37654b"
          strokeWidth={2.5}
          dot={{ r: 3, fill: "#f8f2e8", strokeWidth: 2 }}
        />
        <XAxis dataKey="label" hide />
        <YAxis domain={[0, 100]} hide />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function DesktopHomeAnalysisTrendChart({
  data,
  metric,
}: {
  data: Array<{ date: string; value: number; topic: string }>;
  metric: "mastery" | "minutes";
}) {
  return (
    <ResponsiveContainer
      width="100%"
      height="100%"
      minWidth={0}
      minHeight={0}
      initialDimension={{ width: 640, height: 260 }}
    >
      <AreaChart data={data} margin={{ top: 14, right: 18, bottom: 4, left: -16 }}>
        <CartesianGrid vertical={false} stroke="#ded4c6" />
        <XAxis
          dataKey="date"
          axisLine={false}
          tickLine={false}
          tick={{ fill: "#786b5a", fontSize: 12 }}
        />
        <YAxis
          domain={metric === "mastery" ? [0, 100] : [0, "auto"]}
          axisLine={false}
          tickLine={false}
          tick={{ fill: "#786b5a", fontSize: 12 }}
        />
        <Tooltip
          contentStyle={{
            border: "1px solid #cfbea7",
            background: "#fffaf2",
            borderRadius: 6,
            fontSize: 11,
          }}
        />
        <Area
          type="monotone"
          dataKey="value"
          name={metric === "mastery" ? "掌握度" : "学习分钟"}
          stroke="#37654b"
          strokeWidth={3}
          fill="#dbe3d8"
          fillOpacity={0.72}
          dot={{ r: 4, fill: "#fffaf2", strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

type KnowledgePoint = {
  name: string;
  score: number;
  x: number;
  y: number;
  z: number;
};

export function DesktopHomeKnowledgeScatterChart({
  graphData,
  graphEdges,
}: {
  graphData: KnowledgePoint[];
  graphEdges: KnowledgePoint[];
}) {
  return (
    <ResponsiveContainer
      width="100%"
      height="100%"
      minWidth={0}
      minHeight={0}
      initialDimension={{ width: 560, height: 230 }}
    >
      <ScatterChart margin={{ top: 18, right: 22, bottom: 18, left: 22 }}>
        <XAxis type="number" dataKey="x" domain={[0, 100]} hide />
        <YAxis type="number" dataKey="y" domain={[0, 100]} hide />
        <ZAxis type="number" dataKey="z" range={[3200, 9200]} />
        <Scatter
          data={graphEdges}
          line={{ stroke: "#72917d", strokeWidth: 1.35 }}
          lineType="joint"
          fill="transparent"
        />
        <Scatter data={graphData} dataKey="z">
          {graphData.map((item) => (
            <Cell
              key={item.name}
              fill={item.score < 65 ? "#b93b2b" : item.score < 78 ? "#bd7a24" : "#37654b"}
            />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

export function DesktopHomeGrowthChart({
  data,
}: {
  data: Array<{ date: string; minutes: number; cumulative: number }>;
}) {
  return (
    <ResponsiveContainer
      width="100%"
      height="100%"
      minWidth={0}
      minHeight={0}
      initialDimension={{ width: 760, height: 280 }}
    >
      <AreaChart data={data} margin={{ top: 16, right: 18, bottom: 2, left: -12 }}>
        <CartesianGrid vertical={false} stroke="#ded4c6" />
        <XAxis
          dataKey="date"
          axisLine={false}
          tickLine={false}
          tick={{ fill: "#786b5a", fontSize: 12 }}
          interval={2}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fill: "#786b5a", fontSize: 12 }}
        />
        <Tooltip
          contentStyle={{
            border: "1px solid #cfbea7",
            background: "#fffaf2",
            borderRadius: 6,
            fontSize: 11,
          }}
        />
        <Area
          type="monotone"
          dataKey="cumulative"
          name="累计小时"
          stroke="#37654b"
          strokeWidth={3}
          fill="#dbe3d8"
          fillOpacity={0.72}
          dot={(props) => {
            const { cx, cy, index } = props;
            const show = index === 0 || index === data.length - 1 || index % 4 === 0;
            return show ? (
              <circle cx={cx} cy={cy} r={4} fill="#fffaf2" stroke="#37654b" strokeWidth={2} />
            ) : (
              <g />
            );
          }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
