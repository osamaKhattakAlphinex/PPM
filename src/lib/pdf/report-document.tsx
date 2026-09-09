import "server-only";

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import { PDF_FONT_FAMILY } from "./fonts";

/**
 * A report, as a PDF.
 *
 * The same shape as the invoice document and for the same reasons: bilingual by
 * construction rather than by translation file, because a document is a record
 * and one that says different things depending on who downloaded it is not one;
 * and every value arrives pre-formatted, so this component reaches for no
 * repository, session or locale.
 *
 * Deliberately GENERIC over the three reports rather than three components. A
 * report is a masthead, some headline figures and some tables — the difference
 * between PM, asset and financial is entirely in the words and the numbers, and
 * three near-identical renderers would be three places for the page margins to
 * drift apart.
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
  title: { fontSize: 15, fontWeight: 700, textAlign: "right" },
  titleArabic: { fontSize: 12, textAlign: "right" },

  figures: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 20 },
  figure: {
    flexGrow: 1,
    flexBasis: "40%",
    borderWidth: 1,
    borderColor: "#e2ded7",
    borderRadius: 4,
    padding: 10,
  },
  figureLabel: { fontSize: 8, color: "#5a5a5a", textTransform: "uppercase" },
  figureValue: { fontSize: 16, fontWeight: 700 },

  sectionTitle: { fontSize: 12, fontWeight: 700, marginTop: 8, marginBottom: 6 },

  tableHead: {
    flexDirection: "row",
    backgroundColor: "#f2f0ec",
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e2ded7",
  },
  cellFirst: { flexGrow: 2, flexBasis: 0 },
  cell: { flexGrow: 1, flexBasis: 0, textAlign: "right" },

  empty: { color: "#5a5a5a", paddingVertical: 8, paddingHorizontal: 8 },

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

/** A headline figure: a label in both languages, and one number. */
export interface PdfFigure {
  labelEn: string;
  labelAr: string;
  value: string;
}

/** A table: bilingual headers, and rows of already-formatted strings. */
export interface PdfTable {
  titleEn: string;
  titleAr: string;
  headers: { en: string; ar: string }[];
  rows: string[][];
  /** Printed instead of an empty table body. */
  emptyEn: string;
  emptyAr: string;
}

export interface ReportPdfModel {
  titleEn: string;
  titleAr: string;
  organizationName: string;
  organizationVatNumber: string | null;
  clientName: string | null;
  generatedAt: string;
  figures: PdfFigure[];
  tables: PdfTable[];
}

export function ReportPdf({ model }: { model: ReportPdfModel }) {
  return (
    <Document
      title={`${model.titleEn} — ${model.organizationName}`}
      author={model.organizationName}
      subject={model.titleEn}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.orgName}>{model.organizationName}</Text>
            {model.clientName && <Text style={styles.muted}>{model.clientName}</Text>}
            {model.organizationVatNumber && (
              <Text style={styles.muted}>
                VAT / الرقم الضريبي: {model.organizationVatNumber}
              </Text>
            )}
          </View>

          <View>
            <Text style={styles.title}>{model.titleEn}</Text>
            <Text style={styles.titleArabic}>{model.titleAr}</Text>
            <Text style={[styles.muted, { textAlign: "right", fontSize: 9 }]}>
              {model.generatedAt}
            </Text>
          </View>
        </View>

        <View style={styles.figures}>
          {model.figures.map((figure) => (
            <View key={figure.labelEn} style={styles.figure}>
              <Text style={styles.figureLabel}>
                {figure.labelEn} / {figure.labelAr}
              </Text>
              <Text style={styles.figureValue}>{figure.value}</Text>
            </View>
          ))}
        </View>

        {model.tables.map((table) => (
          <View key={table.titleEn} wrap={false}>
            <Text style={styles.sectionTitle}>
              {table.titleEn} / {table.titleAr}
            </Text>

            <View style={styles.tableHead}>
              {table.headers.map((header, index) => (
                <View key={header.en} style={index === 0 ? styles.cellFirst : styles.cell}>
                  <Text>{header.en}</Text>
                  <Text style={styles.muted}>{header.ar}</Text>
                </View>
              ))}
            </View>

            {table.rows.length === 0 ? (
              <Text style={styles.empty}>
                {table.emptyEn} / {table.emptyAr}
              </Text>
            ) : (
              table.rows.map((row, rowIndex) => (
                <View key={rowIndex} style={styles.tableRow}>
                  {row.map((cell, cellIndex) => (
                    <Text
                      key={cellIndex}
                      style={cellIndex === 0 ? styles.cellFirst : styles.cell}
                    >
                      {cell}
                    </Text>
                  ))}
                </View>
              ))
            )}
          </View>
        ))}

        <Text style={styles.footer} fixed>
          {model.organizationName} · {model.titleEn} · {model.generatedAt}
        </Text>
      </Page>
    </Document>
  );
}
