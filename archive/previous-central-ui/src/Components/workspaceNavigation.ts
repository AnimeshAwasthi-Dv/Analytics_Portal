import {
  legacyPortalModules,
  portalFromPath,
  portalPath,
} from "./portalNavigation";
export const scopeKeys = [
  "portal",
  "client",
  "center",
  "start",
  "end",
  "service",
  "modality",
];
export const scopedPaths = [
  "/command",
  "/portals",
  "/clients",
  "/centers",
  "/services",
  "/users",
  "/studies",
  "/processing",
  "/generated-reports",
  "/reports",
  "/assistant",
  "/operations",
  "/sources",
];
export const supportsScope = (pathname: string) =>
  !!portalFromPath(pathname) ||
  scopedPaths.some(
    (p) =>
      pathname === p || (p === "/portals" && pathname.startsWith("/portals/")),
  );

export function scopedHref(to: string, search: string, contextPath = "") {
  let [pathname, query = ""] = to.split("?");
  if (!supportsScope(pathname)) return to;
  const source = new URLSearchParams(search);
  const target = new URLSearchParams(query);
  const pathPortal = portalFromPath(contextPath);
  const declaredPortal =
    target.get("portal") || /^\/portals\/([^/]+)$/.exec(pathname)?.[1] || "";
  const destinationPortal =
    portalFromPath(pathname) || declaredPortal || pathPortal;
  if (/^\/portals\/[^/]+$/.test(pathname))
    pathname = portalPath(destinationPortal);
  else if (destinationPortal && legacyPortalModules[pathname])
    pathname = portalPath(destinationPortal, legacyPortalModules[pathname]);
  // A destination that declares an entity scope is an intentional drill-down.
  if (declaredPortal) target.set("portal", declaredPortal);
  const explicitScope =
    ["portal", "client", "center"].some((k) => target.has(k)) ||
    (!!portalFromPath(pathname) && portalFromPath(pathname) !== pathPortal);
  for (const key of scopeKeys) {
    if (key === "portal" && portalFromPath(pathname)) continue;
    if (explicitScope && !["start", "end"].includes(key)) continue;
    if (!target.has(key) && source.has(key)) target.set(key, source.get(key)!);
  }
  if (portalFromPath(pathname)) target.delete("portal");
  return pathname + (target.size ? `?${target}` : "");
}
