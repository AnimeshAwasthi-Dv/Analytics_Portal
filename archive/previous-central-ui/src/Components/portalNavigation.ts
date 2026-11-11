import type { WorkspaceIconName } from "./WorkspaceIcon";

export type PortalModule = {
  slug: string;
  label: string;
  icon: WorkspaceIconName;
  view?:
    | "overview"
    | "centers"
    | "reports"
    | "sources"
    | "controls"
    | "clients"
    | "studies"
    | "processing"
    | "generated-reports"
    | "users"
    | "services"
    | "activity"
    | "licenses"
    | "workstations"
    | "assistant";
  role?: "RADIOLOGIST" | "GROUP_ADMIN";
  permission?: string;
  columns?: string[];
  description?: string;
};
export type PortalNavigationGroup = { label: string; items: PortalModule[] };
export const portalNames: Record<string, string> = {
  marengo: "Marengo",
  goyal: "Goyal MRI",
  pacs: "Common PACS",
  onprem: "On-prem applications",
};
const module = (
  slug: string,
  label: string,
  icon: WorkspaceIconName,
  extra: Partial<PortalModule> = {},
): PortalModule => ({ slug, label, icon, ...extra });

// Labels, grouping and order match each repository's SUPER_ADMIN portalAccess.ts.
export function portalNavigation(code: string): PortalNavigationGroup[] {
  if (code === "onprem")
    return [
      {
        label: "Management",
        items: [
          module("dashboard", "Overview", "overview", { view: "overview" }),
          module("clients", "Client directory", "centers", { view: "clients" }),
          module("licenses", "License management", "key", { view: "licenses" }),
          module("processing", "Teleradiology", "studies", {
            view: "processing",
          }),
          module("plans", "License plans", "plans", {
            columns: [
              "Plan",
              "Edition",
              "Services",
              "Credits",
              "Validity",
              "Status",
            ],
            description:
              "Manage the plans issued by the on-prem licensing server.",
          }),
        ],
      },
      {
        label: "Central controls",
        items: [
          module("workstations", "Workstations", "portals", {
            view: "workstations",
          }),
          module("access-controls", "Access controls", "controls", {
            view: "controls",
            permission: "portals:control",
          }),
          module("analytics", "Analytics", "chart", { view: "reports" }),
          module("healthcheck", "Healthcheck", "sync", { view: "sources" }),
        ],
      },
    ];
  if (!portalNames[code]) return [];
  return [
    {
      label: "Command",
      items: [
        module("dashboard", "Dashboard", "overview", { view: "overview" }),
      ],
    },
    {
      label: "Access Management",
      items: [
        module("group-admins", "Group Admins", "team", {
          view: "users",
          role: "GROUP_ADMIN",
        }),
        module("radiologists", "Radiologists", "team", {
          view: "users",
          role: "RADIOLOGIST",
        }),
      ],
    },
    {
      label: "Operations",
      items: [
        ...(code === "pacs"
          ? [module("clients", "Clients", "centers", { view: "clients" })]
          : []),
        module("centers", "Centers", "centers", { view: "centers" }),
        module("patients", "Patients", "team", {
          columns: [
            "Patient",
            "Center",
            "Patient ID",
            "Studies",
            "Last activity",
          ],
          description:
            "Patient directory and linked clinical studies for this portal.",
        }),
        module("follow-ups", "Follow-ups", "activity", {
          columns: [
            "Patient",
            "Center",
            "Follow-up date",
            "Status",
            "Assigned to",
          ],
          description: "Track follow-ups and scheduled patient activity.",
        }),
        module("studies", "Studies", "studies", { view: "studies" }),
        module("processing", "Processing", "activity", { view: "processing" }),
        module("reports", "Reports", "report", { view: "generated-reports" }),
        module("processing-notifications", "Processing Notifications", "sync", {
          columns: ["Study", "Center", "Status", "Channel", "Updated"],
          description: "Delivery of study processing notifications.",
        }),
        module("queries", "Queries", "report", {
          columns: ["Query", "Center", "Status", "Assigned to", "Created"],
          description: "Review queries raised by centers and clinical teams.",
        }),
        module("demo-requests", "Demo Requests", "portals", {
          columns: [
            "Request",
            "Organization",
            "Requested service",
            "Status",
            "Created",
          ],
          description: "Review demonstration requests for this portal.",
        }),
        module("call-requests", "Call Requests", "team", {
          columns: ["Request", "Center", "Requested by", "Status", "Created"],
          description: "Coordinate call requests from portal users.",
        }),
        module("ai-report-feedback", "AI Report Feedback", "report", {
          columns: ["Report", "Center", "Service", "Feedback", "Reviewed"],
          description: "Review feedback on AI-generated reports.",
        }),
      ],
    },
    {
      label: "Platform",
      items: [
        module("whatsapp-configuration", "WhatsApp Configuration", "settings", {
          columns: ["Configuration", "Scope", "Delivery channel", "Status"],
          description: "Manage the portal's WhatsApp delivery settings.",
        }),
        module("technical-alerts", "Technical Alerts", "alert", {
          columns: ["Alert", "Component", "Severity", "Status", "Detected"],
          description:
            "Investigate technical incidents reported by this portal.",
        }),
      ],
    },
    {
      label: "Intelligence",
      items: [
        module("analytics", "Analytics", "chart", { view: "reports" }),
        ...(code !== "pacs"
          ? [
              module("billing", "Billing", "plans", {
                columns: [
                  "Transaction",
                  "Client / center",
                  "Service",
                  "Amount",
                  "Status",
                  "Date",
                ],
                description:
                  "Portal invoices, tariffs and financial billing transactions.",
              }),
            ]
          : []),
      ],
    },
    {
      label: "Governance",
      items: [
        module("notification-history", "Notification History", "activity", {
          columns: ["Notification", "Recipient", "Channel", "Status", "Sent"],
          description: "Review notification delivery history.",
        }),
        module("support", "Support", "team", {
          columns: ["Ticket", "Center", "Priority", "Status", "Updated"],
          description: "Support requests and conversations for this portal.",
        }),
        module("whatsapp-whitelist", "WhatsApp Whitelist", "check", {
          columns: ["Recipient", "Center", "Purpose", "Status", "Updated"],
          description: "Manage approved recipients for WhatsApp notifications.",
        }),
        module("audit-logs", "Audit Logs", "audit", {
          view: "activity",
          permission: "audit:read",
        }),
      ],
    },
  ];
}

export const portalModules = (code: string) =>
  portalNavigation(code).flatMap((g) => g.items);
export const portalPath = (code: string, slug = "dashboard") =>
  `/portal/${encodeURIComponent(code)}/${slug}`;
export const portalFromPath = (pathname: string) =>
  /^\/portal\/([^/]+)(?:\/|$)/.exec(pathname)?.[1] || "";
export const legacyPortalModules: Record<string, string> = {
  "/command": "dashboard",
  "/clients": "clients",
  "/centers": "centers",
  "/services": "services",
  "/users": "users",
  "/studies": "studies",
  "/processing": "processing",
  "/generated-reports": "reports",
  "/reports": "analytics",
  "/sources": "healthcheck",
  "/operations": "access-controls",
};
// Central tools are available from a separate tools menu; they do not pollute the source tabs.
export const portalTools = (code: string): PortalModule[] => [
  module("assistant", "Analysis assistant", "assistant", { view: "assistant" }),
  ...(code === "onprem"
    ? []
    : [
        module("services", "Services & subscriptions", "plans", {
          view: "services",
        }),
        module("users", "All portal users", "team", { view: "users" }),
        module("access-controls", "Access controls", "controls", {
          view: "controls",
          permission: "portals:control",
        }),
        module("healthcheck", "Healthcheck", "sync", { view: "sources" }),
      ]),
];
export const findPortalModule = (code: string, slug: string) =>
  [...portalModules(code), ...portalTools(code)].find((m) => m.slug === slug);
