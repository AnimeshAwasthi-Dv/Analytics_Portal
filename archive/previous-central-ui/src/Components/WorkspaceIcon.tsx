export type WorkspaceIconName =
  | "overview"
  | "portals"
  | "centers"
  | "chart"
  | "assistant"
  | "controls"
  | "activity"
  | "sync"
  | "key"
  | "plans"
  | "team"
  | "audit"
  | "settings"
  | "search"
  | "menu"
  | "close"
  | "chevron"
  | "arrow"
  | "logout"
  | "refresh"
  | "check"
  | "alert"
  | "download"
  | "filter"
  | "plus"
  | "studies"
  | "report";
const paths: Record<WorkspaceIconName, string> = {
  studies: "M3 5h18v14H3z M8 5v14 M3 10h18 M11 14h6",
  report: "M5 3h10l4 4v14H5z M14 3v5h5 M8 12h8 M8 16h6",
  overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  portals: "M3 4h18v12H3z M8 21h8 M12 16v5 M7 8h4 M7 12h8",
  centers: "M4 21V5h11v16 M15 10h5v11 M2 21h20 M8 9h3 M8 13h3 M8 17h3",
  chart: "M4 3v17h17 M8 15v-4 M13 15V7 M18 15V4",
  assistant:
    "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z M20 2v4 M18 4h4",
  controls: "M4 7h7 M15 7h5 M4 17h3 M11 17h9 M11 4v6 M7 14v6",
  activity: "M2 12h4l3-8 6 16 3-8h4",
  sync: "M20 8a8 8 0 0 0-14-3L3 8 M3 3v5h5 M4 16a8 8 0 0 0 14 3l3-3 M21 21v-5h-5",
  key: "M14 4a5 5 0 1 1-3.5 8.5L4 19H1v-3l6.5-6.5A5 5 0 0 1 14 4z M16 7h.01",
  plans: "M6 3h12v18H6z M9 7h6 M9 11h6 M9 15h3",
  team: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8 M17 4a4 4 0 0 1 0 7 M22 21v-2a4 4 0 0 0-3-3.9",
  audit: "M7 3h10v3H7z M7 4H4v17h16V4h-3 M8 11h8 M8 15h6",
  settings: "M4 7h16 M4 17h16 M8 4v6 M16 14v6",
  search: "M10.5 3a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15 M16 16l5 5",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  close: "m6 6 12 12 M18 6 6 18",
  chevron: "m9 5 7 7-7 7",
  arrow: "M4 12h16 M14 6l6 6-6 6",
  logout: "M9 4H4v16h5 M13 8l4 4-4 4 M8 12h13",
  refresh: "M20 7v5h-5 M20 12a8 8 0 1 1-2-6",
  check: "m5 12 4 4L19 6",
  alert: "m12 3 10 18H2z M12 9v4 M12 17h.01",
  download: "M12 3v12 M7 10l5 5 5-5 M4 17v4h16v-4",
  filter: "M3 4h18l-7 8v7l-4 2V12z",
  plus: "M12 5v14 M5 12h14",
};
export function WorkspaceIcon({
  name,
  size = 18,
  className,
}: {
  name: WorkspaceIconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
