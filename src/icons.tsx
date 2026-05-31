import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;
type PathDef = string | { d: string; fill?: string; stroke?: string };

function Icon({ children, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

function paths(items: PathDef[]) {
  return items.map((item, index) => (typeof item === "string" ? <path key={index} d={item} /> : <path key={index} {...item} />));
}

function makeIcon(items: PathDef[]) {
  return function GeneratedIcon(props: IconProps) {
    return <Icon {...props}>{paths(items)}</Icon>;
  };
}

export const BarChart3 = makeIcon(["M4 19V9", "M12 19V5", "M20 19v-8"]);
export const CalendarDays = makeIcon(["M8 2v4", "M16 2v4", "M3 10h18", "M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2", "M8 14h.01", "M12 14h.01", "M16 14h.01", "M8 18h.01", "M12 18h.01", "M16 18h.01"]);
export const CheckCircle2 = makeIcon(["M9 12l2 2 4-5", "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0"]);
export const Clock3 = makeIcon(["M12 7v5l3 2", "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0"]);
export const Cloud = makeIcon(["M17.5 19H7a5 5 0 0 1-.6-10A6 6 0 0 1 18 10.2 4.5 4.5 0 0 1 17.5 19Z"]);
export const CloudOff = makeIcon(["M2 2l20 20", "M10 5.3A6 6 0 0 1 18 10.2 4.5 4.5 0 0 1 19.5 19H12", "M7.5 19H7a5 5 0 0 1-.6-10 6 6 0 0 1 .8-1.9"]);
export const Download = makeIcon(["M12 3v12", "M7 10l5 5 5-5", "M5 21h14"]);
export const Edit3 = makeIcon(["M12 20h9", "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"]);
export const Flame = makeIcon(["M12 22c4 0 7-3 7-7 0-4-4-7-5-12-3 2-5 5-5 8-1-1-2-2-3-3-1 2-1 4-1 6 0 5 3 8 7 8Z"]);
export const Gauge = makeIcon(["M4 14a8 8 0 0 1 16 0", "M12 14l4-4", "M4 18h16"]);
export const KeyRound = makeIcon(["M2 18l6-6", "M7 17l2 2", "M10 14l2 2", "M14 10a5 5 0 1 0-2-2"]);
export const LayoutDashboard = makeIcon(["M4 4h7v7H4Z", "M13 4h7v4h-7Z", "M13 10h7v10h-7Z", "M4 13h7v7H4Z"]);
export const ListChecks = makeIcon(["M3 6l1.5 1.5L7 5", "M3 12l1.5 1.5L7 11", "M3 18l1.5 1.5L7 17", "M10 6h11", "M10 12h11", "M10 18h11"]);
export const Moon = makeIcon(["M21 12.8A8.5 8.5 0 1 1 11.2 3 6.5 6.5 0 0 0 21 12.8Z"]);
export const Pause = makeIcon(["M8 5v14", "M16 5v14"]);
export const Play = makeIcon([{ d: "M7 5v14l12-7Z", fill: "currentColor", stroke: "currentColor" }]);
export const Plus = makeIcon(["M12 5v14", "M5 12h14"]);
export const RefreshCw = makeIcon(["M3 12a9 9 0 0 1 15.4-6.4L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-15.4 6.4L3 16", "M3 21v-5h5"]);
export const Save = makeIcon(["M5 3h12l2 2v16H5Z", "M8 3v6h8", "M8 21v-7h8"]);
export const Search = makeIcon(["M21 21l-4.4-4.4", "M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"]);
export const Sparkles = makeIcon(["M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z", "M5 3v3", "M3.5 4.5h3", "M19 17v4", "M17 19h4"]);
export const Sun = makeIcon(["M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z", "M12 2v2", "M12 20v2", "M4.9 4.9l1.4 1.4", "M17.7 17.7l1.4 1.4", "M2 12h2", "M20 12h2", "M4.9 19.1l1.4-1.4", "M17.7 6.3l1.4-1.4"]);
export const Table2 = makeIcon(["M4 5h16v14H4Z", "M4 10h16", "M10 5v14"]);
export const Target = makeIcon(["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z", "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"]);
export const TimerReset = makeIcon(["M10 2h4", "M12 14v-4", "M4 5l2 2", "M20 5l-2 2", "M7 20a8 8 0 1 0-1.8-11"]);
export const Trash2 = makeIcon(["M3 6h18", "M8 6V4h8v2", "M6 6l1 15h10l1-15", "M10 11v6", "M14 11v6"]);
export const Upload = makeIcon(["M12 21V9", "M7 14l5-5 5 5", "M5 3h14"]);
export const Wand2 = makeIcon(["M15 4l5 5", "M3 21l12-12", "M14 4l1-2", "M20 10l2-1", "M9 4l-1-2", "M4 9l-2-1", "M19 15l1 2", "M15 19l-1 2"]);
