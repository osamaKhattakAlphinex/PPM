"use client";

import {
  useCallback,
  useEffect,
  useOptimistic,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Check, ChevronDown, X } from "lucide-react";
import { motion } from "framer-motion";

import {
  decideApprovalAction,
  listApprovalsAction,
  summariseApprovalsAction,
} from "@/lib/approvals/actions";
import type { ApprovalSummary, ApprovalTotals } from "@/lib/approvals/dto";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Table, type TableColumn } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import type { Page } from "@/lib/db";
import {
  APPROVAL_REF_TYPES,
  APPROVAL_STAGES,
  APPROVAL_STATUSES,
  REJECTION_REASON_MAX_LENGTH,
  type ApprovalRefType,
  type ApprovalStage,
  type ApprovalStatus,
} from "@/lib/domain/approvals";
import { ApprovalStatusBadge } from "../_components/approval-status-badge";
import { PageHeading } from "../_components/page-heading";
import { Pagination } from "../_components/pagination";
import { StageProgress } from "./stage-progress";

/**
 * The approvals screen: what is sitting at each desk, and the two buttons that
 * move it.
 *
 * A Client Component because everything on it is interactive. The first page
 * and the first header are rendered on the SERVER and handed in as props, so
 * the screen is complete on first paint and this component's fetching only ever
 * replaces what is already there.
 *
 * `canDecide` arrives per row, decided on the server from the session's role and
 * the row's own stage. It hides an affordance and nothing more: `decideApproval`
 * re-checks `canActOnStage` against the row it reads back, so a stale `true` on
 * a screen left open overnight is refused rather than honoured.
 */

/** A row plus the flag that dims it while its own decision is in flight. */
type Row = ApprovalSummary & { pending?: boolean };

function upsert(items: Row[], incoming: Row): Row[] {
  const index = items.findIndex((item) => item.id === incoming.id);
  if (index === -1) return items;
  const next = [...items];
  next[index] = incoming;
  return next;
}

export function ApprovalsQueue({
  initialPage,
  initialTotals,
  isClientSession,
}: {
  initialPage: Page<ApprovalSummary>;
  initialTotals: ApprovalTotals;
  isClientSession: boolean;
}) {
  const t = useTranslations("approvals");
  const tStage = useTranslations("approvals.stage");
  const tRef = useTranslations("approvals.refType");
  const tStatus = useTranslations("approvals.status");
  const format = useFormatter();
  const { toast } = useToast();

  const [result, setResult] = useState(initialPage);
  const [totals, setTotals] = useState(initialTotals);

  const [status, setStatus] = useState<ApprovalStatus | "">("");
  const [stage, setStage] = useState<ApprovalStage | "">("");
  const [refType, setRefType] = useState<ApprovalRefType | "">("");
  const [mine, setMine] = useState(false);

  const [isPending, startTransition] = useTransition();
  const [isDeciding, startDeciding] = useTransition();

  /** The row whose rejection reason is being typed. Null when the sheet is shut. */
  const [rejecting, setRejecting] = useState<ApprovalSummary | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);

  /** Which trails are expanded. Ids, so the set survives a refetch. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const [optimisticItems, applyOptimistic] = useOptimistic(
    result.items as Row[],
    (items: Row[], incoming: Row) => upsert(items, incoming),
  );

  /**
   * The refetch, called by every filter and by pagination.
   *
   * Overrides exist because a `useState` setter does not update the value this
   * closure already captured — pressing a tile has to pass the new stage in
   * rather than rely on a re-render that has not happened yet.
   */
  const load = useCallback(
    (
      page: number,
      overrides?: {
        status?: ApprovalStatus | "";
        stage?: ApprovalStage | "";
        refType?: ApprovalRefType | "";
        mine?: boolean;
      },
    ) => {
      const nextStatus = overrides?.status ?? status;
      const nextStage = overrides?.stage ?? stage;
      const nextRef = overrides?.refType ?? refType;
      const nextMine = overrides?.mine ?? mine;

      startTransition(async () => {
        const response = await listApprovalsAction({
          page,
          pageSize: result.pageSize,
          ...(nextStatus ? { status: nextStatus } : {}),
          ...(nextStage ? { stage: nextStage } : {}),
          ...(nextRef ? { refType: nextRef } : {}),
          ...(nextMine ? { mine: true } : {}),
        });

        if (response.ok) setResult(response.data);
        else toast({ title: response.error.message, variant: "danger" });
      });
    },
    [status, stage, refType, mine, result.pageSize, toast],
  );

  /**
   * Called only after a DECISION, never after a filter change.
   *
   * The header counts the whole tenant's queue, so narrowing the list does not
   * change it — refetching on every filter press would be a round trip for an
   * identical answer, and a header that flickered while the list settled.
   */
  const loadTotals = useCallback(async () => {
    const response = await summariseApprovalsAction({});
    if (response.ok) setTotals(response.data);
  }, []);

  // Close the reason sheet whenever the row it belongs to leaves the page.
  useEffect(() => {
    if (rejecting && !result.items.some((item) => item.id === rejecting.id)) {
      setRejecting(null);
    }
  }, [result.items, rejecting]);

  /**
   * Approve or reject.
   *
   * The status is swapped optimistically so the press reads as having done
   * something before the round trip lands — but only for a REJECTION, which is
   * terminal and therefore exactly predictable here. An approval's outcome
   * depends on which desk the row was at (the last one flips the status to
   * APPROVED, the others leave it PENDING and move the stage), and that is the
   * server's arithmetic; guessing it in the browser would show the wrong badge
   * on the one press that matters most. The row is dimmed instead.
   */
  function decide(row: Row, action: "APPROVED" | "REJECTED", why?: string) {
    startDeciding(async () => {
      applyOptimistic({
        ...row,
        ...(action === "REJECTED" ? { status: "REJECTED" as const } : {}),
        pending: true,
      });

      const response = await decideApprovalAction({
        id: row.id,
        action,
        ...(why ? { reason: why } : {}),
      });

      if (response.ok) {
        setResult((current) => ({
          ...current,
          items: current.items.map((item) =>
            item.id === response.data.id ? response.data : item,
          ),
        }));
        setRejecting(null);
        setReason("");
        setReasonError(undefined);
        toast({
          title: action === "APPROVED" ? t("approved") : t("rejected"),
          variant: "success",
        });
        void loadTotals();
        return;
      }

      /**
       * A field error on `id` means the row moved under whoever pressed the
       * button — someone else decided it, or it advanced past this desk. The
       * truthful thing to show is what it actually is now, so the page is
       * reloaded rather than patched back.
       */
      if (response.error.fields?.reason) {
        setReasonError(response.error.fields.reason);
        return;
      }
      toast({
        title: response.error.fields?.id ?? response.error.message,
        variant: "danger",
      });
      load(result.page);
    });
  }

  function toggleTrail(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const busy = isPending || isDeciding;

  const dim = (row: Row, node: ReactNode) => (
    <span className={cn("block", row.pending && "opacity-50")}>{node}</span>
  );

  const columns: TableColumn<Row>[] = [
    {
      key: "item",
      header: t("item"),
      cell: (row) =>
        dim(
          row,
          <span className="block">
            <span className="block max-w-xs truncate font-medium text-foreground" title={row.refLabel}>
              {row.refLabel}
            </span>
            <span className="block text-xs text-muted-foreground">
              {tRef(row.refType)}
              {row.clientName ? ` · ${row.clientName}` : ""}
            </span>
          </span>,
        ),
    },
    {
      key: "progress",
      header: t("progress"),
      cell: (row) => dim(row, <StageProgress stage={row.currentStage} status={row.status} />),
      className: "min-w-[180px]",
    },
    {
      key: "status",
      header: t("statusLabel"),
      cell: (row) => dim(row, <ApprovalStatusBadge status={row.status} />),
    },
    {
      key: "raised",
      header: t("raised"),
      cell: (row) =>
        dim(
          row,
          <span className="block text-sm">
            <span className="block tabular-nums numeric-isolate">
              {format.dateTime(new Date(row.createdAt), { dateStyle: "medium" })}
            </span>
            {row.requestedByName && (
              <span className="block text-xs text-muted-foreground">{row.requestedByName}</span>
            )}
          </span>,
        ),
    },
    {
      key: "actions",
      header: <span className="sr-only">{t("actions")}</span>,
      className: "text-end",
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => toggleTrail(row.id)}
            aria-expanded={expanded.has(row.id)}
            aria-label={`${t("trail")} — ${row.refLabel}`}
          >
            <ChevronDown
              className={cn("size-4 transition-transform", expanded.has(row.id) && "rotate-180")}
              aria-hidden
            />
            <span className="sr-only md:not-sr-only md:inline">{t("trail")}</span>
          </Button>

          {row.canDecide && (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => decide(row, "APPROVED")}
                aria-label={`${t("approve")} — ${row.refLabel}`}
                className="text-success hover:bg-success/10"
              >
                <Check className="size-4" aria-hidden />
                <span className="sr-only md:not-sr-only md:inline">{t("approve")}</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setReason("");
                  setReasonError(undefined);
                  setRejecting(row);
                }}
                aria-label={`${t("reject")} — ${row.refLabel}`}
                className="text-danger hover:bg-danger/10"
              >
                <X className="size-4" aria-hidden />
                <span className="sr-only md:not-sr-only md:inline">{t("reject")}</span>
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const rows = optimisticItems;

  return (
    <section>
      <PageHeading
        title={t("title")}
        subtitle={isClientSession ? t("clientSubtitle") : t("subtitle")}
        note={isClientSession ? t("clientNote") : undefined}
      />

      {/* The desks, as counts. Each is a filter, which is why they are buttons. */}
      <motion.div
        className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        initial="hidden"
        animate="visible"
        variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.03 } } }}
      >
        {totals.byStage.map((entry) => {
          const selected = stage === entry.stage && !mine;
          return (
            <motion.button
              key={entry.stage}
              type="button"
              variants={{
                hidden: { opacity: 0, y: 6 },
                visible: { opacity: 1, y: 0, transition: { duration: 0.18, ease: "easeOut" } },
              }}
              aria-pressed={selected}
              onClick={() => {
                const next = selected ? "" : entry.stage;
                setStage(next);
                setMine(false);
                setStatus("");
                load(1, { stage: next, mine: false, status: "" });
              }}
              className={cn(
                "flex flex-col items-start gap-1 rounded-md border p-4 text-start transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                selected
                  ? "border-accent bg-accent/10"
                  : "border-border bg-surface hover:border-border-strong",
              )}
            >
              <span className="text-sm font-medium text-muted-foreground">
                {tStage(entry.stage)}
              </span>
              <span className="font-display text-3xl font-semibold tabular-nums numeric-isolate text-foreground">
                {format.number(entry.count)}
              </span>
              <span className="text-xs text-muted-foreground">{t("waiting")}</span>
            </motion.button>
          );
        })}
      </motion.div>

      {/* Filters */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("filterStatus")}>
          <Select
            value={status}
            onChange={(event) => {
              const next = event.target.value as ApprovalStatus | "";
              setStatus(next);
              setMine(false);
              load(1, { status: next, mine: false });
            }}
          >
            <option value="">{t("allStatuses")}</option>
            {APPROVAL_STATUSES.map((entry) => (
              <option key={entry} value={entry}>
                {tStatus(entry)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t("filterStage")}>
          <Select
            value={stage}
            onChange={(event) => {
              const next = event.target.value as ApprovalStage | "";
              setStage(next);
              setMine(false);
              load(1, { stage: next, mine: false });
            }}
          >
            <option value="">{t("allStages")}</option>
            {APPROVAL_STAGES.map((entry) => (
              <option key={entry} value={entry}>
                {tStage(entry)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t("filterType")}>
          <Select
            value={refType}
            onChange={(event) => {
              const next = event.target.value as ApprovalRefType | "";
              setRefType(next);
              load(1, { refType: next });
            }}
          >
            <option value="">{t("allTypes")}</option>
            {APPROVAL_REF_TYPES.map((entry) => (
              <option key={entry} value={entry}>
                {tRef(entry)}
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex items-end">
          <Button
            type="button"
            variant={mine ? "primary" : "outline"}
            aria-pressed={mine}
            className="w-full"
            onClick={() => {
              const next = !mine;
              setMine(next);
              setStage("");
              setStatus("");
              load(1, { mine: next, stage: "", status: "" });
            }}
          >
            {t("mine")}
          </Button>
        </div>
      </div>

      <Table
        columns={columns}
        data={rows}
        isLoading={isPending && rows.length === 0}
        emptyState={<EmptyState title={t("empty")} description={t("emptyBody")} />}
      />

      {/* The audit trails, rendered under the table so a row can expand without
          fighting the responsive card layout for space. */}
      {rows
        .filter((row) => expanded.has(row.id))
        .map((row) => (
          <div key={row.id} className="mt-4 rounded-md border border-border bg-surface p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground">
              {t("trailFor", { item: row.refLabel })}
            </h3>
            <ol className="grid gap-3">
              {row.history.map((entry, index) => (
                <li key={`${entry.at}-${index}`} className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="font-medium text-foreground">
                    {t(`action.${entry.action}`)}
                  </span>
                  <span className="text-muted-foreground">
                    {tStage(entry.stage)} ·{" "}
                    {entry.actorName ?? t(`byRole.${entry.actorRole}`)}
                  </span>
                  <span className="tabular-nums numeric-isolate text-xs text-muted-foreground">
                    {format.dateTime(new Date(entry.at), { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                  {entry.reason && (
                    <span className="w-full text-xs text-danger">{entry.reason}</span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        ))}

      <Pagination
        page={result.page}
        totalPages={result.totalPages}
        total={result.total}
        isPending={busy}
        onChange={(page) => load(page)}
      />

      <Modal
        open={rejecting !== null}
        onOpenChange={(open) => {
          if (!open) setRejecting(null);
        }}
        title={t("rejectTitle")}
        description={t("rejectBody")}
        tone="danger"
        footer={
          <>
            <Button variant="outline" onClick={() => setRejecting(null)} disabled={isDeciding}>
              {t("cancel")}
            </Button>
            <Button
              variant="danger"
              disabled={isDeciding}
              onClick={() => {
                const trimmed = reason.trim();
                if (!trimmed) {
                  // Checked here as well as on the server so the person is told
                  // before a round trip; the server check is the one that counts.
                  setReasonError(t("reasonRequired"));
                  return;
                }
                if (rejecting) decide(rejecting, "REJECTED", trimmed);
              }}
            >
              {t("reject")}
            </Button>
          </>
        }
      >
        <Field label={t("reason")} hint={t("reasonHint")} error={reasonError} required>
          <Textarea
            value={reason}
            maxLength={REJECTION_REASON_MAX_LENGTH}
            rows={4}
            onChange={(event) => {
              setReason(event.target.value);
              setReasonError(undefined);
            }}
          />
        </Field>
      </Modal>
    </section>
  );
}
