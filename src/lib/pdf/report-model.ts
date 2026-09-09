import "server-only";

import type { Report } from "@/lib/reports/queries";
import type { PdfFigure, PdfTable, ReportPdfModel } from "./report-document";

/**
 * A built report, turned into the flat, pre-formatted model the PDF renderer
 * takes.
 *
 * This is where every formatting decision for the document lives — one place,
 * so the three reports cannot end up formatting a percentage three ways.
 *
 * The labels are literals in both languages rather than `next-intl` messages,
 * and that is deliberate: `getTranslations` needs a request locale, and a
 * document that says different things depending on who downloaded it is not a
 * record. The strings below are the DOCUMENT's language, not the reader's — the
 * same decision `invoice-document.tsx` makes and for the same reason.
 */

/**
 * `en-US` deliberately, and not the reader's locale.
 *
 * A total rendered with Eastern Arabic numerals for one reader and Western
 * digits for another is two different-looking documents for one set of figures.
 * The money values arriving here are already RIYALS — the halala division
 * happened once, in the report builder — so this is the last step.
 */
function money(value: number): string {
  return `SAR ${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function count(value: number): string {
  return value.toLocaleString("en-US");
}

/** An em dash for `null`. "Nothing has fallen due" is not "zero per cent". */
function percent(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

/** Title case from an enum key: `HALF_YEARLY` -> `Half yearly`. */
function humanise(key: string): string {
  const lower = key.toLowerCase().replace(/_/g, " ");
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

const TITLES: Record<Report["kind"], { en: string; ar: string }> = {
  PM: { en: "Preventive maintenance report", ar: "تقرير الصيانة الوقائية" },
  ASSET: { en: "Asset report", ar: "تقرير الأصول" },
  FINANCIAL: { en: "Financial report", ar: "التقرير المالي" },
};

export function toReportPdfModel(report: Report): ReportPdfModel {
  const base = {
    titleEn: TITLES[report.kind].en,
    titleAr: TITLES[report.kind].ar,
    organizationName: report.organizationName,
    organizationVatNumber: report.organizationVatNumber,
    clientName: report.clientName,
    generatedAt: day(report.generatedAt),
  };

  switch (report.kind) {
    case "PM": {
      const figures: PdfFigure[] = [
        {
          labelEn: "Compliance",
          labelAr: "نسبة الالتزام",
          value: percent(report.compliance),
        },
        { labelEn: "Completed", labelAr: "منجزة", value: count(report.completed) },
        { labelEn: "Missed", labelAr: "فائتة", value: count(report.missed) },
        { labelEn: "Upcoming (7 days)", labelAr: "قادمة (٧ أيام)", value: count(report.upcoming) },
      ];

      const tables: PdfTable[] = [
        {
          titleEn: "By frequency",
          titleAr: "حسب التكرار",
          headers: [
            { en: "Frequency", ar: "التكرار" },
            { en: "Scheduled", ar: "مجدولة" },
            { en: "Completed", ar: "منجزة" },
            { en: "Overdue", ar: "متأخرة" },
            { en: "Compliance", ar: "الالتزام" },
          ],
          rows: report.byFrequency.map((row) => [
            humanise(row.frequency),
            count(row.total),
            count(row.completed),
            count(row.overdue),
            percent(row.compliance),
          ]),
          emptyEn: "No planned maintenance recorded.",
          emptyAr: "لا توجد صيانة مخططة مسجلة.",
        },
        {
          titleEn: "Overdue visits",
          titleAr: "الزيارات المتأخرة",
          headers: [
            { en: "Asset", ar: "الأصل" },
            { en: "Frequency", ar: "التكرار" },
            { en: "Due", ar: "الاستحقاق" },
          ],
          rows: report.overdue.map((row) => [
            row.assetName ?? "—",
            humanise(row.type),
            day(row.dueDate),
          ]),
          emptyEn: "Nothing is overdue.",
          emptyAr: "لا يوجد متأخرات.",
        },
      ];

      return { ...base, figures, tables };
    }

    case "ASSET": {
      const figures: PdfFigure[] = [
        { labelEn: "Assets", labelAr: "الأصول", value: count(report.total) },
        { labelEn: "In service", labelAr: "في الخدمة", value: count(report.active) },
        {
          labelEn: "Under maintenance",
          labelAr: "تحت الصيانة",
          value: count(report.inMaintenance),
        },
        {
          labelEn: "Average health",
          labelAr: "متوسط الحالة",
          value: percent(report.averageHealth),
        },
      ];

      const tables: PdfTable[] = [
        {
          titleEn: "By category",
          titleAr: "حسب الفئة",
          headers: [
            { en: "Category", ar: "الفئة" },
            { en: "Total", ar: "الإجمالي" },
            { en: "In service", ar: "في الخدمة" },
            { en: "Maintenance", ar: "صيانة" },
            { en: "Health", ar: "الحالة" },
          ],
          rows: report.byCategory.map((row) => [
            humanise(row.category),
            count(row.total),
            count(row.active),
            count(row.maintenance),
            percent(row.averageHealth),
          ]),
          emptyEn: "No assets registered.",
          emptyAr: "لا توجد أصول مسجلة.",
        },
        {
          titleEn: "Worst condition",
          titleAr: "الأسوأ حالة",
          headers: [
            { en: "Asset", ar: "الأصل" },
            { en: "Category", ar: "الفئة" },
            { en: "Status", ar: "الحالة" },
            { en: "Health", ar: "الصحة" },
          ],
          rows: report.worst.map((row) => [
            row.name,
            humanise(row.category),
            humanise(row.status),
            `${row.health}%`,
          ]),
          emptyEn: "No assets registered.",
          emptyAr: "لا توجد أصول مسجلة.",
        },
      ];

      return { ...base, figures, tables };
    }

    case "FINANCIAL": {
      const figures: PdfFigure[] = [
        { labelEn: "Invoiced", labelAr: "المفوتر", value: money(report.invoiced) },
        { labelEn: "Collected", labelAr: "المحصّل", value: money(report.paid) },
        { labelEn: "Outstanding", labelAr: "المستحق", value: money(report.pending) },
        { labelEn: "Overdue", labelAr: "المتأخر", value: money(report.overdue) },
      ];

      const tables: PdfTable[] = [
        {
          titleEn: "Contracts",
          titleAr: "العقود",
          headers: [
            { en: "Measure", ar: "المؤشر" },
            { en: "Value", ar: "القيمة" },
          ],
          rows: [
            ["Contract value / قيمة العقود", money(report.contractValue)],
            ["Active / سارية", count(report.activeContracts)],
            ["Expiring / قاربت الانتهاء", count(report.expiringContracts)],
            ["Average compliance / متوسط الالتزام", percent(report.averageCompliance)],
          ],
          emptyEn: "No contracts.",
          emptyAr: "لا توجد عقود.",
        },
        {
          titleEn: "Workload, last 6 months",
          titleAr: "حجم العمل، آخر ٦ أشهر",
          headers: [
            { en: "Month", ar: "الشهر" },
            { en: "Preventive", ar: "وقائية" },
            { en: "Corrective", ar: "علاجية" },
          ],
          rows: report.trend.map((point) => [
            point.month,
            count(point.preventive),
            count(point.corrective),
          ]),
          emptyEn: "No work recorded.",
          emptyAr: "لا توجد أعمال مسجلة.",
        },
      ];

      return { ...base, figures, tables };
    }
  }
}
