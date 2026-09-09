import "server-only";

import { Document, Page, StyleSheet, Text, View, type Styles } from "@react-pdf/renderer";

import { BASIS_POINTS_PER_UNIT } from "@/lib/domain/invoicing";
import { PDF_FONT_FAMILY } from "./fonts";

/**
 * The invoice, as a PDF.
 *
 * Bilingual by construction rather than by translation file: every label is
 * printed in BOTH languages, one above the other, on the same document. That is
 * not a compromise between the two — it is what a Saudi tax invoice actually
 * looks like, because the customer's accounts department and the tax authority
 * do not necessarily read the same language, and issuing two different documents
 * for one transaction is how a reconciliation goes wrong.
 *
 * The labels are literals here rather than `next-intl` messages, and that is
 * deliberate: `useTranslations` needs a request context this renderer does not
 * run inside, and a document that says different things depending on who
 * downloaded it is not a legal record. The strings below are the DOCUMENT's
 * language, not the reader's.
 *
 * Numbers are formatted by the caller (`toPdfModel`) rather than here, so the
 * money on the page is the money the ledger holds — one formatting decision, in
 * one place, in the layer that already knows halalas from riyals.
 */

const styles = StyleSheet.create({
  page: {
    fontFamily: PDF_FONT_FAMILY,
    fontSize: 10,
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 40,
    color: "#1c1c1c",
    lineHeight: 1.4,
  },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: "#1c1c1c",
    paddingBottom: 12,
    marginBottom: 20,
  },
  orgName: { fontSize: 16, fontWeight: 700 },
  muted: { color: "#5a5a5a" },
  title: { fontSize: 18, fontWeight: 700, textAlign: "right" },
  titleArabic: { fontSize: 13, textAlign: "right" },

  columns: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20, gap: 24 },
  column: { flexGrow: 1, flexBasis: 0 },

  sectionLabel: {
    fontSize: 8,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: "#5a5a5a",
    marginBottom: 4,
  },

  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },

  tableHead: {
    flexDirection: "row",
    backgroundColor: "#f2f0ec",
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginTop: 8,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e2ded7",
  },
  cellWide: { flexGrow: 1, flexBasis: 0 },
  cellMoney: { width: 120, textAlign: "right" },

  totals: { marginTop: 16, marginLeft: "auto", width: 240 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  grandTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    marginTop: 4,
    borderTopWidth: 2,
    borderTopColor: "#1c1c1c",
    fontSize: 12,
    fontWeight: 700,
  },

  notes: { marginTop: 24, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#e2ded7" },

  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    fontSize: 8,
    color: "#5a5a5a",
    textAlign: "center",
  },
});

/** A label printed in both languages, English above Arabic. */
/**
 * `Styles[string]` rather than a bare `object`: the renderer's own style type is
 * not exported on its own, and a loose `object` fails the prop's type. Indexing
 * the exported map type gets exactly the shape `StyleSheet.create` produces.
 */
function Bilingual({ en, ar, style }: { en: string; ar: string; style?: Styles[string] }) {
  return (
    <View style={style}>
      <Text>{en}</Text>
      <Text style={styles.muted}>{ar}</Text>
    </View>
  );
}

/**
 * Everything the document prints, already formatted.
 *
 * A flat, string-only model on purpose: this component must not reach for a
 * repository, a session or a locale, so every decision that needs any of those
 * has been made before it is called. It is also what makes the renderer
 * testable without a database.
 */
export interface InvoicePdfModel {
  organizationName: string;
  organizationVatNumber: string | null;
  clientName: string;
  invoiceNumber: string;
  workRef: string;
  issueDate: string;
  dueDate: string;
  status: string;
  statusArabic: string;
  amount: string;
  vat: string;
  vatRateLabel: string;
  total: string;
  notes: string | null;
  generatedAt: string;
}

export function InvoicePdf({ model }: { model: InvoicePdfModel }) {
  return (
    <Document
      title={`Invoice ${model.invoiceNumber}`}
      author={model.organizationName}
      subject={model.workRef}
      /**
       * No `creator`/`producer` override, so the PDF carries the renderer's own
       * identity and nothing about the host. A document's metadata travels with
       * it to whoever it is forwarded to.
       */
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.orgName}>{model.organizationName}</Text>
            {model.organizationVatNumber ? (
              <Text style={styles.muted}>
                VAT / الرقم الضريبي: {model.organizationVatNumber}
              </Text>
            ) : (
              // Printed rather than omitted: "not registered" and "we forgot to
              // fill it in" must not look the same on a tax document.
              <Text style={styles.muted}>VAT number not registered / غير مسجل ضريبياً</Text>
            )}
          </View>

          <View>
            <Text style={styles.title}>TAX INVOICE</Text>
            <Text style={styles.titleArabic}>فاتورة ضريبية</Text>
          </View>
        </View>

        <View style={styles.columns}>
          <View style={styles.column}>
            <Text style={styles.sectionLabel}>Billed to / العميل</Text>
            <Text>{model.clientName}</Text>
          </View>

          <View style={styles.column}>
            <View style={styles.row}>
              <Bilingual en="Invoice no." ar="رقم الفاتورة" />
              <Text>{model.invoiceNumber}</Text>
            </View>
            <View style={styles.row}>
              <Bilingual en="Issued" ar="تاريخ الإصدار" />
              <Text>{model.issueDate}</Text>
            </View>
            <View style={styles.row}>
              <Bilingual en="Due" ar="تاريخ الاستحقاق" />
              <Text>{model.dueDate}</Text>
            </View>
            <View style={styles.row}>
              <Bilingual en="Status" ar="الحالة" />
              <Text>
                {model.status} / {model.statusArabic}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.tableHead}>
          <View style={styles.cellWide}>
            <Bilingual en="Description" ar="الوصف" />
          </View>
          <View style={styles.cellMoney}>
            <Bilingual en="Amount (SAR)" ar="المبلغ (ر.س)" />
          </View>
        </View>

        <View style={styles.tableRow}>
          <View style={styles.cellWide}>
            <Text>{model.workRef}</Text>
          </View>
          <Text style={styles.cellMoney}>{model.amount}</Text>
        </View>

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text>Subtotal / المجموع الفرعي</Text>
            <Text>{model.amount}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text>
              VAT {model.vatRateLabel} / ضريبة القيمة المضافة
            </Text>
            <Text>{model.vat}</Text>
          </View>
          <View style={styles.grandTotal}>
            <Text>Total / الإجمالي</Text>
            <Text>{model.total}</Text>
          </View>
        </View>

        {model.notes && (
          <View style={styles.notes}>
            <Text style={styles.sectionLabel}>Notes / ملاحظات</Text>
            <Text>{model.notes}</Text>
          </View>
        )}

        <Text style={styles.footer} fixed>
          {model.organizationName} · {model.invoiceNumber} · generated {model.generatedAt}
        </Text>
      </Page>
    </Document>
  );
}

/** 1500 basis points -> "15%". Kept beside the document that prints it. */
export function formatVatRate(basisPoints: number): string {
  const percent = (basisPoints / BASIS_POINTS_PER_UNIT) * 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
}

/** The English/Arabic pair for each display status the document may print. */
export const PDF_STATUS_LABELS: Record<string, { en: string; ar: string }> = {
  PENDING: { en: "Unpaid", ar: "غير مدفوعة" },
  OVERDUE: { en: "Overdue", ar: "متأخرة" },
  PAID: { en: "Paid", ar: "مدفوعة" },
};
