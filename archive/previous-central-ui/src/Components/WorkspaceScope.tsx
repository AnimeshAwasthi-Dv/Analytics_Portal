import { Link, useLocation, type LinkProps } from "react-router-dom";

import { scopedHref } from "./workspaceNavigation";

export function WorkspaceLink(props: LinkProps) {
  const location = useLocation();
  return (
    <Link
      {...props}
      to={
        typeof props.to === "string"
          ? scopedHref(props.to, location.search, location.pathname)
          : props.to
      }
    />
  );
}
