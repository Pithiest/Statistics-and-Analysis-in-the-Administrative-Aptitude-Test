import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

type TrendDatum = {
  label: string;
  total: number;
  rate: number | null;
  pace: number | null;
};

type RadarDatum = {
  module: string;
  健康度: number;
};

type SubTypeDatum = {
  name: string;
  rate: number;
};

export function OverviewTrendChart({ data, targetRate }: { data: TrendDatum[]; targetRate: number }) {
  const showRateDots = data.filter((item) => item.rate !== null).length < 4;
  return (
    <ResponsiveContainer>
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis yAxisId="left" tickLine={false} axisLine={false} />
        <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} domain={[0, 100]} />
        <Tooltip formatter={chartFormatter} />
        <Legend verticalAlign="top" height={28} />
        <ReferenceLine yAxisId="right" y={targetRate} stroke="#64748b" strokeDasharray="4 4" />
        <Area yAxisId="left" type="monotone" dataKey="total" name="题量" stroke="#2563eb" fill="#2563eb22" isAnimationActive={false} />
        <Line yAxisId="right" type="monotone" dataKey="rate" name="正确率" stroke="#0f766e" strokeWidth={2.4} dot={showRateDots ? { r: 3 } : false} connectNulls isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ModuleRadarChart({ data }: { data: RadarDatum[] }) {
  return (
    <ResponsiveContainer>
      <RadarChart data={data}>
        <PolarGrid />
        <PolarAngleAxis dataKey="module" />
        <PolarRadiusAxis angle={90} domain={[0, 100]} tickCount={5} />
        <Radar dataKey="健康度" stroke="#2563eb" fill="#2563eb" fillOpacity={0.18} strokeWidth={2} isAnimationActive={false} />
        <Tooltip formatter={chartFormatter} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

export function ModuleTrendChart({ data, targetRate }: { data: TrendDatum[]; targetRate: number }) {
  const showDots = data.filter((item) => item.rate !== null).length < 4;
  return (
    <ResponsiveContainer>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis yAxisId="left" tickLine={false} axisLine={false} domain={[0, 100]} />
        <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} />
        <Tooltip formatter={chartFormatter} />
        <Legend verticalAlign="top" height={28} />
        <ReferenceLine yAxisId="left" y={targetRate} stroke="#64748b" strokeDasharray="4 4" />
        <Line yAxisId="left" type="monotone" dataKey="rate" name="正确率" stroke="#2563eb" strokeWidth={2.6} dot={showDots ? { r: 3 } : false} connectNulls isAnimationActive={false} />
        <Line yAxisId="right" type="monotone" dataKey="pace" name="配速" stroke="#b45309" strokeWidth={2.2} dot={showDots ? { r: 3 } : false} strokeDasharray="5 5" connectNulls isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SubTypeBarChart({ data }: { data: SubTypeDatum[] }) {
  const vertical = data.length > 4;
  return (
    <ResponsiveContainer>
      <BarChart data={data} layout={vertical ? "vertical" : "horizontal"}>
        <CartesianGrid strokeDasharray="3 3" horizontal={!vertical} vertical={vertical} />
        <XAxis type={vertical ? "number" : "category"} dataKey={vertical ? undefined : "name"} tickLine={false} axisLine={false} domain={vertical ? [0, 100] : undefined} />
        <YAxis type={vertical ? "category" : "number"} dataKey={vertical ? "name" : undefined} tickLine={false} axisLine={false} width={82} domain={vertical ? undefined : [0, 100]} />
        <Tooltip formatter={chartFormatter} />
        <Bar dataKey="rate" name="正确率" fill="#2563eb" radius={vertical ? [0, 8, 8, 0] : [8, 8, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function chartFormatter(value: unknown, name: unknown): [string, string] {
  const label = String(name || "");
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === null || raw === undefined || raw === "") return ["--", label];
  if (label.includes("正确率")) return [`${raw}%`, label];
  if (label.includes("健康度")) return [`${raw}/100`, label];
  if (label.includes("配速")) return [`${raw}s/题`, label];
  if (label.includes("题量") || label.includes("样本")) return [`${raw}题`, label];
  return [String(raw), label];
}
