"use client";

import {
  startTransition as startFormTransition,
  useActionState,
  useCallback,
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { BanknoteArrowUp, FileDown, Plus, Trash2, Undo2 } from "lucide-react";

import {
  createInvoiceAction,
  createInvoiceFromApprovalAction,
  deleteInvoiceAction,
  listInvoicesAction,
  settleInvoiceAction,
  summariseInvoicesAction,
  updateInvoiceAction,
} from "@/lib/invoicing/actions";
import type {
  InvoiceableApproval,
  InvoiceSummary,
  InvoiceTotalsView,
} from "@/lib/invoicing/dto";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Table, type TableColumn } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import type { Page } from "@/lib/db";
import { INVOICE_DISPLAY_STATUSES, type InvoiceDisplayStatus } from "@/lib/domain/invoicing";
import type { ActionResult } from "@/lib/security/action";
import { InvoiceStatusBadge } from "../_components/invoice-status-badge";
import { PageHeading } from "../_components/page-heading";
import { Pagination } from "../_components/pagination";
import { RecordActions } from "../_components/record-actions";
import { InvoiceTiles } from "./invoice-tiles";

/**
 * The invoicing screen: the KPI header, the ledger, and the sheets that raise
 * and settle it.
 *
 * A Client Component because everything on it is interactive. The first page and
 * the first summary are rendered on the SERVER and handed in as props, so the
 * screen is complete on first paint.
 *
 * Every capability is a boolean decided on the server from the session's role.
 * Hiding a button only hides an affordance; each action re-checks the role on
 * every call, and `INVOICE_RAISERS` excludes CLIENT entirely — a customer may
 * read their own ledger and download their own documents, and nothing else.
 *
 * Note what this component does NOT do: it never computes a VAT figure or a
 * total. The form carries the net amount and nothing else, because the payload
 * schemas have no field for the other two. The numbers rendered in the table are
 * the numbers the server stored.
 */

export interface PickerOption {
  id: string;
  name: string;
}

type Row = InvoiceSummary & { pending?: boolean };

interface InvoiceFormPayload {
  id?: string;
  approvalId?: string;
  clientId?: string;
  invoiceNumber?: string;
  workRef?: string;
  amount: string;
  issueDate: string;
  dueDate: string;
  notes: string;
}

function upsertIntoPage(page: Page<InvoiceSummary>, incoming: InvoiceSummary): Page<InvoiceSummary> {
  const index = page.items.findIndex((item) => item.id === incoming.id);
  if (index === -1) return page;
  const items = [...page.items];
  items[index] = incoming;
  return { ...page, items };
}

export function InvoicingManager({
  initialPage,
  initialTotals,
  canRaise,
  isClientSession,
  clientOptions,
  invoiceable,
}: {
  initialPage: Page<InvoiceSummary>;
  initialTotals: InvoiceTotalsView;
  canRaise: boolean;
  isClientSession: boolean;
  /** Empty for a session that cannot raise — the picker is not loaded for them. */
  clientOptions: PickerOption[];
  /** Approvals that reached INVOICE_TRIGGER and carry no invoice yet. */
  invoiceable: InvoiceableApproval[];
}) {
  const t = useTranslations("masterData");
  const ti = useTranslations("invoicing");
  const locale = useLocale();
  const format = useFormatter();
  const { toast } = useToast();

  const [result, setResult] = useState(initialPage);
  const [totals, setTotals] = useState(initialTotals);

  const [status, setStatus] = useState<InvoiceDisplayStatus | "">("");
  const [clientFilter, setClientFilter] = useState("");
  const [isPending, startTransition] = useTransition();

  const [editing, setEditing] = useState<InvoiceSummary | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  /** "approval" raises from a signed-off chain; "direct" raises a standalone. */
  const [source, setSource] = useState<"approval" | "direct">("approval");
  const [deleting, setDeleting] = useState<InvoiceSummary | null>(null);
  const [isDeleting, startDeleting] = useTransition();
  const [isSettling, startSettling] = useTransition();

  const [optimisticItems, applyOptimistic] = useOptimistic(
    result.items as Row[],
    (items: Row[], incoming: Row) => {
      const index = items.findIndex((item) => item.id === incoming.id);
      if (index === -1) return items;
      const next = [...items];
      next[index] = incoming;
      return next;
    },
  );

  const load = useCallback(
    (page: number, overrides?: { status?: InvoiceDisplayStatus | ""; clientId?: string }) => {
      const nextStatus = overrides?.status ?? status;
      const nextClient = overrides?.clientId ?? clientFilter;

      startTransition(async () => {
        const response = await listInvoicesAction({
          page,
          pageSize: result.pageSize,
          ...(nextStatus ? { status: nextStatus } : {}),
          ...(nextClient ? { clientId: nextClient } : {}),
        });

        if (response.ok) setResult(response.data);
        else toast({ title: response.error.message, variant: "danger" });
      });
    },
    [status, clientFilter, result.pageSize, toast],
  );

  /**
   * Called only after a MUTATION, never after a filter change: the header counts
   * the whole ledger, so narrowing the list does not change it.
   */
  const loadTotals = useCallback(async () => {
    const response = await summariseInvoicesAction({});
    if (response.ok) setTotals(response.data);
  }, []);

  const [formState, submitForm, isSubmitting] = useActionState(
    async (previous: ActionResult<InvoiceSummary> | undefined, payload: InvoiceFormPayload) => {
      if (payload.id) return updateInvoiceAction(previous, payload);
      if (payload.approvalId) return createInvoiceFromApprovalAction(previous, payload);
      return createInvoiceAction(previous, payload);
    },
    undefined,
  );

  /**
   * `useActionState` keeps the last result forever, so this has to know whether
   * it has already acted on this one — without the ref, closing and reopening
   * the sheet would replay the previous success and close it again.
   */
  const handled = useRef<ActionResult<InvoiceSummary> | undefined>(undefined);

  useEffect(() => {
    if (!formState || formState === handled.current) return;
    handled.current = formState;

    if (formState.ok) {
      setResult((current) => upsertIntoPage(current, formState.data));
      setFormOpen(false);
      setEditing(null);
      toast({ title: t("saved"), variant: "success" });
      // The server owns ordering and totals: a new invoice belongs at the top of
      // the ledger, and only a refetch knows what else moved.
      load(result.page);
      void loadTotals();
      return;
    }

    // Field errors render against the inputs; a toast would say the same thing
    // twice, further from the fix.
    if (formState.error.code !== "VALIDATION_FAILED") {
      toast({ title: formState.error.message, variant: "danger" });
    }
  }, [formState, load, loadTotals, result.page, t, toast]);

  const fieldErrors = formState && !formState.ok ? (formState.error.fields ?? {}) : {};

  function openCreate() {
    setEditing(null);
    setSource(invoiceable.length > 0 ? "approval" : "direct");
    handled.current = formState;
    setFormOpen(true);
  }

  function openEdit(row: InvoiceSummary) {
    setEditing(row);
    handled.current = formState;
    setFormOpen(true);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => {
      const value = form.get(key);
      return typeof value === "string" ? value.trim() : "";
    };

    startFormTransition(() => {
      submitForm({
        ...(editing
          ? { id: editing.id }
          : source === "approval"
            ? { approvalId: text("approvalId"), invoiceNumber: text("invoiceNumber") }
            : {
                clientId: text("clientId"),
                invoiceNumber: text("invoiceNumber"),
                workRef: text("workRef"),
              }),
        ...(editing ? { workRef: text("workRef") } : {}),
        /**
         * Submitted as the STRING the input produced. `sarInputSchema` takes
         * exactly that and converts riyals to halalas by integer arithmetic; a
         * `Number()` here would reintroduce the float the schema exists to
         * avoid. And there is no VAT or total field to submit — the server
         * computes both.
         */
        amount: text("amount"),
        issueDate: text("issueDate"),
        dueDate: text("dueDate"),
        notes: text("notes"),
      });
    });
  }

  function confirmDelete() {
    const row = deleting;
    if (!row) return;

    startDeleting(async () => {
      const response = await deleteInvoiceAction({ id: row.id });
      if (response.ok) {
        setDeleting(null);
        toast({ title: ti("withdrawn"), variant: "success" });
        load(result.page);
        void loadTotals();
        return;
      }
      toast({ title: response.error.fields?.id ?? response.error.message, variant: "danger" });
    });
  }

  /**
   * Mark paid, or reverse that.
   *
   * The badge is swapped optimistically so the press reads as having done
   * something before the round trip lands. Both directions are exactly
   * predictable here — PAID is PAID, and reversing gives back PENDING or
   * OVERDUE depending only on a due date this component already holds — so
   * unlike the approvals queue there is nothing to guess.
   */
  function settle(row: Row, paid: boolean) {
    startSettling(async () => {
      const reverted: InvoiceDisplayStatus =
        new Date(row.dueDate) < new Date(new Date().toISOString().slice(0, 10))
          ? "OVERDUE"
          : "PENDING";

      applyOptimistic({
        ...row,
        status: paid ? "PAID" : "PENDING",
        displayStatus: paid ? "PAID" : reverted,
        pending: true,
      });

      const response = await settleInvoiceAction({ id: row.id, paid });

      if (response.ok) {
        setResult((current) => upsertIntoPage(current, response.data));
        toast({ title: paid ? ti("markedPaid") : ti("paymentReversed"), variant: "success" });
        void loadTotals();
        return;
      }

      toast({ title: response.error.fields?.id ?? response.error.message, variant: "danger" });
      load(result.page);
    });
  }

  const busy = isPending || isDeleting || isSettling;

  const dim = (row: Row, node: ReactNode) => (
    <span className={cn("block", row.pending && "opacity-50")}>{node}</span>
  );

  const columns: TableColumn<Row>[] = [
    {
      key: "invoice",
      header: ti("invoice"),
      cell: (row) =>
        dim(
          row,
          <span className="block">
            <span className="block font-medium uppercase text-foreground">
              {row.invoiceNumber}
            </span>
            <span className="block max-w-xs truncate text-xs text-muted-foreground" title={row.workRef}>
              {row.workRef}
            </span>
          </span>,
        ),
    },
  ];

  // A customer already knows whose invoices these are, and their session cannot
  // read the client collection at all — so the column simply does not exist.
  if (!isClientSession) {
    columns.push({
      key: "client",
      header: ti("client"),
      cell: (row) =>
        dim(row, row.clientName ?? <span className="text-muted-foreground">{ti("clientUnknown")}</span>),
    });
  }

  columns.push(
    {
      key: "total",
      header: ti("total"),
      cell: (row) =>
        dim(
          row,
          <span className="block text-end">
            <span className="block tabular-nums numeric-isolate font-medium">
              {format.number(row.total, "currency")}
            </span>
            <span className="block text-xs tabular-nums numeric-isolate text-muted-foreground">
              {ti("vatLine", {
                net: format.number(row.amount, "currency"),
                vat: format.number(row.vat, "currency"),
              })}
            </span>
          </span>,
        ),
      className: "text-end",
    },
    {
      key: "dates",
      header: ti("due"),
      cell: (row) =>
        dim(
          row,
          <span className="block text-sm tabular-nums numeric-isolate">
            {format.dateTime(new Date(row.dueDate), { dateStyle: "medium" })}
          </span>,
        ),
    },
    {
      key: "status",
      header: ti("statusLabel"),
      // NOT wrapped in `dim`: the badge's whole job during a pending settle is
      // to show the new state confidently. Fading it would say "maybe".
      cell: (row) => <InvoiceStatusBadge status={row.displayStatus} />,
    },
    {
      key: "pdf",
      header: <span className="sr-only">{ti("download")}</span>,
      cell: (row) => (
        /**
         * A plain link, not a fetch. The route answers with a PDF and a
         * `Content-Disposition`, so the browser's own viewer handles it — and a
         * link works with middle-click, with "open in new tab", and without
         * JavaScript. The locale prefix is deliberately absent: this is an API
         * route, not a page.
         */
        <a
          href={`/api/invoices/${row.id}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          hrefLang={locale}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FileDown className="size-4" aria-hidden />
          <span className="sr-only md:not-sr-only md:inline">{ti("pdf")}</span>
        </a>
      ),
    },
  );

  if (canRaise) {
    columns.push({
      key: "settle",
      header: <span className="sr-only">{ti("actions")}</span>,
      cell: (row) =>
        row.status === "PAID" ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => settle(row, false)}
            disabled={busy || row.pending}
            aria-label={`${ti("reversePayment")} — ${row.invoiceNumber}`}
          >
            <Undo2 className="size-4" aria-hidden />
            <span className="sr-only md:not-sr-only md:inline">{ti("reversePayment")}</span>
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => settle(row, true)}
            disabled={busy || row.pending}
            aria-label={`${ti("markPaid")} — ${row.invoiceNumber}`}
          >
            <BanknoteArrowUp className="size-4" aria-hidden />
            {ti("markPaid")}
          </Button>
        ),
    });

    columns.push({
      key: "actions",
      header: <span className="sr-only">{t("actions")}</span>,
      className: "text-end",
      cell: (row) => (
        <RecordActions
          name={row.invoiceNumber}
          onEdit={() => openEdit(row)}
          onDelete={() => setDeleting(row)}
          // A paid invoice is a record. The actions refuse to touch one.
          disabled={busy || row.pending || row.status === "PAID"}
        />
      ),
    });
  }

  const rows = optimisticItems;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeading
        title={ti("title")}
        subtitle={isClientSession ? ti("clientSubtitle") : ti("subtitle")}
        note={canRaise ? undefined : t("readOnly")}
        action={
          canRaise ? (
            <Button onClick={openCreate}>
              <Plus className="size-4" aria-hidden />
              {ti("new")}
            </Button>
          ) : undefined
        }
      />

      <InvoiceTiles
        totals={totals}
        selected={status}
        onSelect={(next) => {
          setStatus(next);
          load(1, { status: next });
        }}
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Field label={ti("filterStatus")}>
            <Select
              value={status}
              onChange={(event) => {
                const next = event.target.value as InvoiceDisplayStatus | "";
                setStatus(next);
                load(1, { status: next });
              }}
            >
              <option value="">{ti("allStatuses")}</option>
              {INVOICE_DISPLAY_STATUSES.map((entry) => (
                <option key={entry} value={entry}>
                  {ti(`status.${entry}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {!isClientSession && clientOptions.length > 0 && (
          <div className="w-56">
            <Field label={ti("filterClient")}>
              <Select
                value={clientFilter}
                onChange={(event) => {
                  const next = event.target.value;
                  setClientFilter(next);
                  load(1, { clientId: next });
                }}
              >
                <option value="">{ti("allClients")}</option>
                {clientOptions.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
      </div>

      <Table
        columns={columns}
        data={rows}
        isLoading={isPending && rows.length === 0}
        emptyState={
          <EmptyState
            title={ti("empty")}
            description={isClientSession ? ti("clientEmptyBody") : ti("emptyBody")}
          />
        }
      />

      <Pagination
        page={result.page}
        totalPages={result.totalPages}
        total={result.total}
        isPending={busy}
        onChange={(page) => load(page)}
      />

      <Modal
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        title={editing ? ti("editTitle") : ti("newTitle")}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={isSubmitting}>
              {t("cancel")}
            </Button>
            <Button type="submit" form="invoice-form" isLoading={isSubmitting}>
              {t("save")}
            </Button>
          </>
        }
      >
        <form id="invoice-form" onSubmit={handleSubmit} className="grid gap-4 @lg:grid-cols-2">
          {!editing && (
            <Field
              label={ti("source")}
              hint={ti("sourceHint")}
              className="@lg:col-span-2"
            >
              <Select
                name="source"
                value={source}
                onChange={(event) => setSource(event.target.value as "approval" | "direct")}
              >
                <option value="approval" disabled={invoiceable.length === 0}>
                  {invoiceable.length === 0 ? ti("noneApproved") : ti("fromApproval")}
                </option>
                <option value="direct">{ti("direct")}</option>
              </Select>
            </Field>
          )}

          {!editing && source === "approval" && (
            <Field
              label={ti("approval")}
              hint={ti("approvalHint")}
              error={fieldErrors.approvalId}
              required
              className="@lg:col-span-2"
            >
              <Select name="approvalId" defaultValue={invoiceable[0]?.id ?? ""} required>
                {invoiceable.map((approval) => (
                  <option key={approval.id} value={approval.id}>
                    {approval.refLabel}
                    {approval.clientName ? ` · ${approval.clientName}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {!editing && source === "direct" && (
            <>
              <Field label={ti("client")} error={fieldErrors.clientId} required>
                <Select name="clientId" defaultValue="" required>
                  <option value="" disabled>
                    {ti("selectClient")}
                  </option>
                  {clientOptions.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label={ti("workRef")}
                hint={ti("workRefHint")}
                error={fieldErrors.workRef}
                required
              >
                <Input name="workRef" defaultValue="" maxLength={160} required />
              </Field>
            </>
          )}

          {editing && (
            <Field
              label={ti("workRef")}
              hint={ti("workRefHint")}
              error={fieldErrors.workRef}
              className="@lg:col-span-2"
            >
              <Input name="workRef" defaultValue={editing.workRef} maxLength={160} />
            </Field>
          )}

          {!editing && (
            <Field
              label={ti("invoiceNumber")}
              hint={ti("invoiceNumberHint")}
              error={fieldErrors.invoiceNumber}
              required
            >
              <Input name="invoiceNumber" defaultValue="" maxLength={32} required />
            </Field>
          )}

          <Field
            label={ti("amount")}
            hint={ti("amountHint")}
            error={fieldErrors.amount}
            required
          >
            <Input
              name="amount"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              defaultValue={editing ? editing.amount.toFixed(2) : ""}
              required
            />
          </Field>

          <Field label={ti("issueDate")} error={fieldErrors.issueDate}>
            <Input
              name="issueDate"
              type="date"
              defaultValue={editing ? editing.issueDate.slice(0, 10) : today}
            />
          </Field>

          <Field label={ti("dueDate")} hint={ti("dueDateHint")} error={fieldErrors.dueDate}>
            <Input
              name="dueDate"
              type="date"
              defaultValue={editing ? editing.dueDate.slice(0, 10) : ""}
            />
          </Field>

          <Field
            label={ti("notes")}
            hint={ti("notesHint")}
            error={fieldErrors.notes}
            className="@lg:col-span-2"
          >
            <Textarea name="notes" defaultValue={editing?.notes ?? ""} maxLength={500} />
          </Field>

          {/*
            No VAT and no total input, anywhere in this form — by design rather
            than by omission. The payload schemas have no field for either, so
            the server computes both from the net above and there is nothing a
            browser could send to disagree with it.
          */}
          <p className="text-xs text-muted-foreground @lg:col-span-2">{ti("vatNotice")}</p>
        </form>
      </Modal>

      <Modal
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={ti("withdrawTitle")}
        description={deleting ? ti("withdrawBody", { number: deleting.invoiceNumber }) : undefined}
        tone="danger"
        icon={<Trash2 className="size-4" aria-hidden />}
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={isDeleting}>
              {t("cancel")}
            </Button>
            <Button variant="danger" onClick={confirmDelete} isLoading={isDeleting}>
              {ti("withdraw")}
            </Button>
          </>
        }
      />
    </div>
  );
}
