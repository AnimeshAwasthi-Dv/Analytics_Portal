export type IconName =
  | "activity"
  | "alert"
  | "arrow-down"
  | "arrow-left"
  | "arrow-up"
  | "coins"
  | "database"
  | "scan";

interface IconProps {
  name: IconName;
  className?: string;
}

export function Icon({ name, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <use href={`${import.meta.env.BASE_URL}ui-icons.svg#${name}`} />
    </svg>
  );
}
