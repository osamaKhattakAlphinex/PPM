import {
  Boxes,
  Building2,
  CalendarCheck,
  ChartColumn,
  ClipboardList,
  HardHat,
  LayoutDashboard,
  ListChecks,
  MapPin,
  Receipt,
  ScrollText,
  Sparkles,
  Stamp,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import type { ModuleKey } from "@/lib/nav/modules";

/**
 * Icons live here rather than in `src/lib/nav/modules.ts` because that table
 * is imported by the Edge middleware, and a React component tree has no place
 * in an Edge bundle that only needs to compare two strings.
 *
 * Chosen to read as tools and paperwork rather than abstract glyphs — a
 * technician scanning a bottom bar with one thumb identifies a wrench faster
 * than a differently-shaped rounded square. DESIGN.md §1.
 */
export const MODULE_ICONS: Readonly<Record<ModuleKey, LucideIcon>> = {
  dashboard: LayoutDashboard,
  myJobs: ClipboardList,
  assets: Boxes,
  preventive: CalendarCheck,
  corrective: Wrench,
  checklists: ListChecks,
  amc: ScrollText,
  reports: ChartColumn,
  approvals: Stamp,
  invoicing: Receipt,
  technicians: HardHat,
  clients: Building2,
  locations: MapPin,
  aiInsights: Sparkles,
};
