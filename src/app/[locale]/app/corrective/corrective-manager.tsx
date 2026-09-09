"use client";

import {
  // Aliased: `useTransition()` below binds a local `startTransition` for the
  // LIST's pending state, and an unaliased import would be shadowed by it —
  // silently routing form submits through the list's spinner.
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
import { useFormatter, useTranslations } from "next-intl";
import {
  CircleCheckBig,
  CirclePause,
  CirclePlay,
  Plus,
  SendHorizontal,
  Trash2,
  Undo2,
  UserPlus,
  Wrench,
} from "lucide-react";

import type { Page, WorkOrderPriorityCount } from "@/lib/db";
import {
  nextStatuses,
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_STATUSES,
  type WorkOrderPriority,
  type WorkOrderStatus,
} from "@/lib/domain/corrective";
import type { WorkOrderSummary } from "@/lib/corrective/dto";
import {
  assignWorkOrderAction,
  createWorkOrderAction,
  deleteWorkOrderAction,
  listWorkOrdersAction,
  summariseWorkOrdersAction,
  transitionWorkOrderAction,
  updateWorkOrderAction,
} from "@/lib/corrective/actions";
import type { ActionResult } from "@/lib/security/action";
import { cn } from "@/lib/cn";
import { createApprovalAction } from "@/lib/approvals/actions";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Table, type TableColumn } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { Pagination } from "../_components/pagination";
import { PageHeading } from "../_components/page-heading";
import { PriorityBadge } from "../_components/priority-badge";
import { RecordActions } from "../_components/record-actions";
import { WorkOrderStatusBadge } from "../_components/work-order-status-badge";
import { PriorityTiles } from "./priority-tiles";

/** A person or a machine a work order can be filed against. */
export interface PickerOption {
  id: string;
  name: string;
}

/** A row whose latest state may not have reached the server yet. */
type Row = WorkOrderSummary & { pending?: boolean };

/** What the create/edit form hands to the action. */
interface TicketFormPayload {
  id?: string;
  assetId: string;
  issue: string;
  priority: string;
}

/** The moves reachable by a single press — everything except assignment. */
type PressableStatus = Exclude<WorkOrderStatus, "ASSIGNED">;

/**
 * How each single-press move is labelled and drawn.
 *
 * Only the PRESENTATION lives here. Whether a move is offered at all is
 * answered by `nextStatuses()`, which reads the same
 * `WORK_ORDER_TRANSITIONS` map the server checks against — so an edge added to
 * the domain shows up on the rows automatically, and one removed disappears
 * without anyone having to remember this file exists. That shared source is the
 * whole reason a greyed-out button and a server rejection cannot disagree.
 *
 * `ASSIGNED` is absent because it is not reachable by a press: it needs a
 * technician, so it opens the picker and goes through its own action.
 */
const MOVE_STYLE: Record<
  PressableStatus,
  { icon: typeof CirclePlay; variant: "primary" | "outline" | "ghost" }
> = {
  IN_PROGRESS: { icon: CirclePlay, variant: "primary" },
  PENDING: { icon: CirclePause, variant: "outline" },
  CLOSED: { icon: CircleCheckBig, variant: "outline" },
  OPEN: { icon: Undo2, variant: "ghost" },
};

/**
 * The message key for a move, which is not quite the same as the status it
 * lands on.
 *
 * `PENDING -> IN_PROGRESS` and `ASSIGNED -> IN_PROGRESS` are the same edge to
 * the state machine and two different things to a person: one resumes work that
 * was blocked, the other begins it. Calling the second press "Start" again
 * would be a small lie about the row's history, and the toast that followed
 * would repeat it.
 */
function moveKey(from: WorkOrderStatus, to: PressableStatus): string {
  if (to === "IN_PROGRESS") return from === "PENDING" ? "resume" : "start";
  if (to === "PENDING") return "hold";
  if (to === "CLOSED") return "close";
  return "unassign";
}

/**
 * Corrective maintenance — the work order queue.
 *
 * The screen with the most role-dependent surface in the app, because it is the
 * only operational one a customer opens. Four capabilities, all decided on the
 * server and passed in as booleans:
 *
 *  - `canRaise`   — may report a fault (everyone, CLIENT included)
 *  - `canAssign`  — may decide whose job it is (ADMIN/FM_MANAGER/SUPERVISOR)
 *  - `canExecute` — may move a ticket through the rest of its states (staff)
 *  - `canManage`  — may rewrite or delete one (ADMIN/FM_MANAGER)
 *
 * Hiding a button hides an affordance; every action re-checks the role on every
 * call. `isClientSession` is not a fifth permission — it changes what the screen
 * SAYS, and removes the technician column, which for a client would be a column
 * of blanks the data-access layer will not let us fill.
 */
export function CorrectiveManager({
  initialPage,
  initialSummary,
  canRaise,
  canAssign,
  canExecute,
  canManage,
  canSubmitForApproval,
  isClientSession,
  assetOptions,
  technicianOptions,
}: {
  initialPage: Page<WorkOrderSummary>;
  initialSummary: WorkOrderPriorityCount[];
  canRaise: boolean;
  canAssign: boolean;
  canExecute: boolean;
  canManage: boolean;
  /**
   * Whether this session may send a CLOSED ticket up the approval chain.
   *
   * Decided on the server from `APPROVAL_REQUESTERS`. Hiding the button hides an
   * affordance and nothing more — `createApproval` re-checks the role, and reads
   * the work order back through its OWN scoped repository before it will name a
   * counterparty.
   */
  canSubmitForApproval: boolean;
  isClientSession: boolean;
  /** Empty for a session that cannot raise — the picker is not loaded for them. */
  assetOptions: PickerOption[];
  /** Empty for a session that cannot assign — likewise. */
  technicianOptions: PickerOption[];
}) {
  const t = useTranslations("masterData");
  const tc = useTranslations("corrective");
  const tp = useTranslations("corrective.priority");
  const ts = useTranslations("corrective.status");
  const format = useFormatter();
  const { toast } = useToast();

  const [result, setResult] = useState(initialPage);
  const [summary, setSummary] = useState(initialSummary);
  const [priority, setPriority] = useState<WorkOrderPriority | "">("");
  const [status, setStatus] = useState<WorkOrderStatus | "">("");
  const [technicianFilter, setTechnicianFilter] = useState("");
  const [isPending, startTransition] = useTransition();

  const [editing, setEditing] = useState<WorkOrderSummary | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [assigning, setAssigning] = useState<WorkOrderSummary | null>(null);
  const [deleting, setDeleting] = useState<WorkOrderSummary | null>(null);
  const [isAssigning, startAssigning] = useTransition();
  const [isDeleting, startDeleting] = useTransition();
  const [isMoving, startMoving] = useTransition();
  const [isSendingForApproval, startSendingForApproval] = useTransition();

  /**
   * The optimistic layer.
   *
   * React discards these automatically when the action that produced them
   * settles, so there is no rollback path to write and no way for a failed
   * transition to leave a row showing a state it never reached. It matters more
   * here than anywhere else in the app: a work order is moved four or five times
   * over its life, usually on a phone in a plant room on a bad connection, and a
   * badge that does not move on the press is a button that gets pressed twice.
   */
  const [optimisticItems, applyOptimistic] = useOptimistic(
    result.items as Row[],
    (items: Row[], incoming: Row) => upsertRow(items, incoming),
  );

  const load = useCallback(
    (page: number, overrides?: { priority?: string; status?: string; technicianId?: string }) => {
      const nextPriority = overrides?.priority ?? priority;
      const nextStatus = overrides?.status ?? status;
      const nextTechnician = overrides?.technicianId ?? technicianFilter;

      startTransition(async () => {
        const response = await listWorkOrdersAction({
          page,
          pageSize: result.pageSize,
          ...(nextPriority ? { priority: nextPriority } : {}),
          ...(nextStatus ? { status: nextStatus } : {}),
          ...(nextTechnician ? { technicianId: nextTechnician } : {}),
        });

        if (response.ok) setResult(response.data);
        else toast({ title: response.error.message, variant: "danger" });
      });
    },
    [priority, status, technicianFilter, result.pageSize, toast],
  );

  /**
   * Refresh the tiles.
   *
   * Called only after a MUTATION, never after a filter change: the counts are of
   * everything unfinished in the tenant, so narrowing the list below them does
   * not change them — and a tile grid that reloaded on every filter would
   * flicker its numbers for no reason.
   */
  const loadSummary = useCallback(() => {
    startTransition(async () => {
      const response = await summariseWorkOrdersAction({});
      if (response.ok) setSummary(response.data);
    });
  }, []);

  // --- The raise / edit form ------------------------------------------------

  const [formState, submitForm, isSubmitting] = useActionState(
    async (previous: ActionResult<WorkOrderSummary> | undefined, payload: TicketFormPayload) =>
      payload.id
        ? updateWorkOrderAction(previous, payload)
        : createWorkOrderAction(previous, payload),
    undefined,
  );

  const handled = useRef<ActionResult<WorkOrderSummary> | undefined>(undefined);

  useEffect(() => {
    if (!formState || formState === handled.current) return;
    handled.current = formState;

    if (formState.ok) {
      setResult((current) => upsertIntoPage(current, formState.data));
      setFormOpen(false);
      setEditing(null);
      toast({ title: t("saved"), variant: "success" });
      // Reconcile: the server decides ordering, totals and which page this row
      // actually belongs on — and a new ticket changes a tile.
      load(result.page);
      loadSummary();
      return;
    }

    if (formState.error.code !== "VALIDATION_FAILED") {
      toast({ title: formState.error.message, variant: "danger" });
    }
  }, [formState, load, loadSummary, result.page, t, toast]);

  const fieldErrors = formState && !formState.ok ? (formState.error.fields ?? {}) : {};

  function openCreate() {
    setEditing(null);
    handled.current = formState;
    setFormOpen(true);
  }

  function openEdit(workOrder: WorkOrderSummary) {
    setEditing(workOrder);
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

    /**
     * Wrapped in React's own `startTransition` because this dispatch comes from
     * a manual `onSubmit` rather than a `<form action={...}>` prop — without it
     * `isSubmitting` never flips and the button shows no pending state. Not the
     * binding from `useTransition()` above: that drives the list's spinner, and
     * a save is not a list reload.
     */
    startFormTransition(() => {
      submitForm({
        ...(editing ? { id: editing.id } : {}),
        assetId: text("assetId"),
        issue: text("issue"),
        priority: text("priority"),
      });
    });
  }

  // --- Transitions ----------------------------------------------------------

  /**
   * Start, hold, resume, close and unassign — one function, because they are
   * one action on the server.
   *
   * The optimistic row carries the new status forward immediately. Unlike the
   * preventive equivalent there is only ONE status field to move, so the badge
   * and the buttons cannot fall out of step with each other; what does need
   * carrying is the assignee, which an unassign clears — otherwise the row shows
   * a technician's name beside an OPEN badge until the refetch lands.
   */
  function move(row: Row, to: PressableStatus) {
    const key = moveKey(row.status, to);

    startMoving(async () => {
      applyOptimistic({
        ...row,
        status: to,
        ...(to === "OPEN" ? { technicianId: null, technicianName: null } : {}),
        pending: true,
      });

      const response = await transitionWorkOrderAction({ id: row.id, to });

      if (response.ok) {
        setResult((current) => upsertIntoPage(current, response.data));
        toast({ title: tc(`${key}Toast`), variant: "success" });
        loadSummary();
        return;
      }

      // A field message on a transition means the row moved under us — someone
      // else started it, or closed it. Show that, then reload so the list tells
      // the truth rather than leaving a stale row with a confident badge.
      toast({ title: response.error.fields?.id ?? response.error.message, variant: "danger" });
      load(result.page);
    });
  }

  function confirmAssign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assigning) return;

    const raw = new FormData(event.currentTarget).get("technicianId");
    const technicianId = typeof raw === "string" ? raw : "";
    if (!technicianId) return;

    const row = assigning;
    // The name is already on this client — the picker was rendered from it — so
    // the optimistic row can show WHO it went to, not just that it moved.
    const person = technicianOptions.find((option) => option.id === technicianId);

    startAssigning(async () => {
      applyOptimistic({
        ...row,
        status: "ASSIGNED",
        technicianId,
        technicianName: person?.name ?? null,
        pending: true,
      });

      const response = await assignWorkOrderAction({ id: row.id, technicianId });
      setAssigning(null);

      if (response.ok) {
        setResult((current) => upsertIntoPage(current, response.data));
        toast({ title: tc("assignedToast"), variant: "success" });
        loadSummary();
        return;
      }

      toast({
        title:
          response.error.fields?.id ??
          response.error.fields?.technicianId ??
          response.error.message,
        variant: "danger",
      });
      load(result.page);
    });
  }

  // --- Delete ---------------------------------------------------------------

  function confirmDelete() {
    if (!deleting) return;

    startDeleting(async () => {
      const response = await deleteWorkOrderAction({ id: deleting.id });

      if (response.ok) {
        toast({ title: t("deleted"), variant: "success" });
        setDeleting(null);
        load(result.items.length === 1 && result.page > 1 ? result.page - 1 : result.page);
        loadSummary();
      } else {
        toast({ title: response.error.message, variant: "danger" });
      }
    });
  }

  // --- Table ----------------------------------------------------------------

  /** Dim a cell while its row is still in flight. */
  const dim = (row: Row, node: ReactNode) => (
    <span className={cn("block", row.pending && "opacity-50")}>{node}</span>
  );

  /**
   * Send a closed ticket up the approval chain.
   *
   * The label is composed here, from what is already on screen, because the
   * queue has to be readable without a cross-collection read per row and this
   * is the only place that knows a good handle for the job. Everything that
   * matters — the counterparty, the tenant — is resolved on the SERVER from the
   * work order itself; the id in this payload is a filter term with
   * organizationId layered on top, so a ticket outside the caller's scope simply
   * matches nothing.
   */
  function submitForApproval(row: Row) {
    startSendingForApproval(async () => {
      const response = await createApprovalAction({
        refType: "WORK_ORDER",
        refId: row.id,
        refLabel: [row.assetName, row.issue].filter(Boolean).join(" · ").slice(0, 120),
      });

      if (response.ok) {
        toast({ title: tc("sentForApproval"), variant: "success" });
        return;
      }

      toast({
        title: response.error.fields?.refId ?? response.error.message,
        variant: "danger",
      });
    });
  }

  const columns: TableColumn<Row>[] = [
    {
      key: "issue",
      header: tc("issue"),
      cell: (row) =>
        dim(
          row,
          // Truncated with the full text in `title`: the fault report is the
          // first thing a person reads, but a 2000-character one must not be
          // allowed to set the row height for everything else in the list.
          <span className="block max-w-md truncate font-medium text-foreground" title={row.issue}>
            {row.issue}
          </span>,
        ),
    },
    {
      key: "asset",
      header: tc("asset"),
      cell: (row) =>
        dim(
          row,
          row.assetName ?? <span className="text-muted-foreground">{tc("assetUnknown")}</span>,
        ),
    },
    {
      key: "priority",
      header: tc("priorityLabel"),
      cell: (row) => dim(row, <PriorityBadge priority={row.priority} />),
    },
    {
      key: "raised",
      header: tc("raised"),
      cell: (row) =>
        dim(
          row,
          <span className="tabular-nums numeric-isolate">
            {format.dateTime(new Date(row.createdAt), "short")}
          </span>,
        ),
    },
  ];

  /**
   * The technician column exists for staff only, and its absence for a client
   * is a correctness decision rather than a courtesy.
   *
   * `Technician` has no `clientId` and is not shared with clients, so the DAL
   * refuses a client-scoped read of that collection — which means
   * `technicianName` is always null in a client's payload. Rendering the column
   * anyway would print "Unassigned" beside every ticket a technician is actively
   * working on: not a gap in the data, but a false statement about it.
   */
  if (!isClientSession) {
    columns.push({
      key: "technician",
      header: tc("technician"),
      cell: (row) =>
        dim(
          row,
          row.technicianName ?? (
            <span className="text-muted-foreground">{tc("technicianUnknown")}</span>
          ),
        ),
    });
  }

  columns.push({
    key: "status",
    header: t("filterStatus"),
    // NOT wrapped in `dim`: the badge's whole job during a pending transition is
    // to show the new state confidently. Fading it would say "maybe".
    cell: (row) => <WorkOrderStatusBadge status={row.status} />,
  });

  if (canAssign || canExecute || canSubmitForApproval) {
    columns.push({
      key: "move",
      header: <span className="sr-only">{tc("actions")}</span>,
      cell: (row) => {
        const moves = nextStatuses(row.status);
        if (moves.length === 0) {
          /**
           * A closed ticket has nowhere left to go operationally — but it is
           * exactly the thing an approval chain starts from, so this is where
           * that button belongs rather than in a menu of its own.
           */
          if (!canSubmitForApproval) {
            return <span className="text-xs text-muted-foreground">{ts("CLOSED")}</span>;
          }

          return (
            <Button
              size="sm"
              variant="outline"
              onClick={() => submitForApproval(row)}
              disabled={isSendingForApproval || isPending || row.pending}
              aria-label={`${tc("sendForApproval")} — ${row.assetName ?? row.issue}`}
            >
              <SendHorizontal className="size-4 rtl:rotate-180" aria-hidden />
              {tc("sendForApproval")}
            </Button>
          );
        }

        const busy = isMoving || isAssigning || isPending || row.pending;

        return (
          <div className="flex flex-wrap items-center gap-1.5">
            {moves.map((to) => {
              /**
               * `-> ASSIGNED` is the one move that cannot be a single press: it
               * needs a technician, so it opens the picker instead of calling
               * the transition action. Gated on `canAssign`, which is a
               * narrower role list than the rest of the row's buttons.
               */
              if (to === "ASSIGNED") {
                if (!canAssign) return null;
                return (
                  <Button
                    key={to}
                    size="sm"
                    variant={row.status === "OPEN" ? "primary" : "outline"}
                    onClick={() => setAssigning(row)}
                    disabled={busy}
                    aria-label={`${tc("assign")} — ${row.assetName ?? row.issue}`}
                  >
                    <UserPlus className="size-4" aria-hidden />
                    {tc("assign")}
                  </Button>
                );
              }

              if (!canExecute) return null;

              const key = moveKey(row.status, to);
              const style = MOVE_STYLE[to];
              const Icon = style.icon;

              return (
                <Button
                  key={to}
                  size="sm"
                  variant={style.variant}
                  onClick={() => move(row, to)}
                  disabled={busy}
                  aria-label={`${tc(key)} — ${row.assetName ?? row.issue}`}
                >
                  <Icon className="size-4" aria-hidden />
                  {tc(key)}
                </Button>
              );
            })}
          </div>
        );
      },
    });
  }

  if (canManage) {
    columns.push({
      key: "actions",
      header: <span className="sr-only">{t("actions")}</span>,
      className: "text-end",
      cell: (row) => (
        <RecordActions
          name={row.assetName ?? row.issue}
          onEdit={() => openEdit(row)}
          onDelete={() => setDeleting(row)}
          // A closed ticket is a record, and the action refuses to edit one.
          disabled={isPending || isDeleting || row.pending || row.status === "CLOSED"}
        />
      ),
    });
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeading
        title={tc("title")}
        subtitle={isClientSession ? tc("clientSubtitle") : tc("subtitle")}
        // A client is not "read-only" — they raise the tickets. The note is for
        // a staff session that may look but not act.
        note={canRaise ? undefined : t("readOnly")}
        action={
          canRaise ? (
            <Button onClick={openCreate}>
              <Plus className="size-4" aria-hidden />
              {tc("new")}
            </Button>
          ) : undefined
        }
      />

      <PriorityTiles
        counts={summary}
        selected={priority}
        onSelect={(next) => {
          setPriority(next);
          load(1, { priority: next });
        }}
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Field label={t("filterStatus")}>
            <Select
              value={status}
              onChange={(event) => {
                const next = event.target.value as WorkOrderStatus | "";
                setStatus(next);
                load(1, { status: next });
              }}
            >
              <option value="">{t("allStatuses")}</option>
              {WORK_ORDER_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {ts(value)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {technicianOptions.length > 0 && (
          <div className="w-52">
            <Field label={tc("technician")}>
              <Select
                value={technicianFilter}
                onChange={(event) => {
                  setTechnicianFilter(event.target.value);
                  load(1, { technicianId: event.target.value });
                }}
              >
                <option value="">{tc("allTechnicians")}</option>
                {technicianOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
      </div>

      <Table
        columns={columns}
        data={optimisticItems}
        emptyState={
          <EmptyState
            icon={Wrench}
            title={tc("empty")}
            description={isClientSession ? tc("clientEmptyBody") : tc("emptyBody")}
            action={
              canRaise ? (
                <Button onClick={openCreate}>
                  <Plus className="size-4" aria-hidden />
                  {tc("new")}
                </Button>
              ) : undefined
            }
          />
        }
      />

      <Pagination
        page={result.page}
        totalPages={result.totalPages}
        total={result.total}
        isPending={isPending}
        onChange={load}
      />

      {/* --- Raise / edit --- */}
      <Modal
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? tc("editTitle") : tc("newTitle")}
        size="lg"
        icon={<Wrench />}
        /**
         * Passed as `footer` rather than trailing the form inside `children`.
         * The modal scrolls its body and pins its footer, so Save stays on
         * screen instead of being something you scroll the form to reach. The
         * submit button finds the form by `form="wo-form"`, which works across
         * the DOM — the button is not inside the <form>.
         */
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={isSubmitting}>
              {t("cancel")}
            </Button>
            <Button type="submit" form="wo-form" isLoading={isSubmitting}>
              {editing ? t("save") : t("create")}
            </Button>
          </>
        }
      >
        <form id="wo-form" className="grid items-start gap-y-4" onSubmit={handleSubmit}>
          {/*
            One column, unlike the preventive sheet. The fault report is the
            substance of this form and wants the dialog's full width; pairing it
            with a half-width control beside it would make the field people
            actually type into the smallest thing on screen.
          */}
          <Field label={tc("asset")} hint={tc("assetHint")} error={fieldErrors.assetId} required>
            <Select name="assetId" defaultValue={editing?.assetId ?? ""} required>
              {!editing && <option value="">—</option>}
              {assetOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={tc("issue")} hint={tc("issueHint")} error={fieldErrors.issue} required>
            {/*
              `minLength`/`maxLength` mirror the model's own bounds so the
              browser catches the obvious case before a round trip. They are not
              the control: `workOrderInputSchema` is, and the action parses
              against it regardless of what the form allows.
            */}
            <Textarea
              name="issue"
              defaultValue={editing?.issue ?? ""}
              minLength={5}
              maxLength={2000}
              required
            />
          </Field>

          <Field
            label={tc("priorityLabel")}
            hint={tc("priorityHint")}
            error={fieldErrors.priority}
            required
          >
            {/*
              No pre-selected value on create, matching the model, which gives
              `priority` no default either. The person raising the ticket is the
              person standing in front of the problem; a pre-picked MEDIUM would
              make every unconsidered ticket look considered.
            */}
            <Select name="priority" defaultValue={editing?.priority ?? ""} required>
              {!editing && <option value="">—</option>}
              {WORK_ORDER_PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {tp(value)}
                </option>
              ))}
            </Select>
          </Field>
        </form>
      </Modal>

      {/* --- Assign --- */}
      <Modal
        open={assigning !== null}
        onOpenChange={(open) => !open && setAssigning(null)}
        title={tc("assignTitle")}
        description={assigning?.issue}
        icon={<UserPlus />}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAssigning(null)} disabled={isAssigning}>
              {t("cancel")}
            </Button>
            <Button type="submit" form="wo-assign-form" isLoading={isAssigning}>
              {tc("assign")}
            </Button>
          </>
        }
      >
        <form id="wo-assign-form" onSubmit={confirmAssign}>
          <Field label={tc("technician")} hint={tc("technicianHint")} required>
            <Select
              name="technicianId"
              // Pre-selects the current assignee on a reassignment, so the
              // picker opens showing who has it rather than a blank.
              defaultValue={assigning?.technicianId ?? ""}
              required
            >
              <option value="">—</option>
              {technicianOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </Field>
        </form>
      </Modal>

      {/* --- Delete confirmation --- */}
      <Modal
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("deleteTitle", { name: deleting?.assetName ?? "" })}
        description={tc("deleteBody")}
        tone="danger"
        icon={<Trash2 />}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={isDeleting}>
              {t("cancel")}
            </Button>
            <Button variant="danger" onClick={confirmDelete} isLoading={isDeleting}>
              {t("delete")}
            </Button>
          </>
        }
      />
    </div>
  );
}

// --- Row merging ------------------------------------------------------------
//
// Both helpers keep the list newest-first, which is the order the server returns
// (`sort: { createdAt: -1 }`). Inserting in position rather than prepending means
// a saved row does not visibly jump when the refetch lands. The timestamps are
// ISO 8601 strings, which sort lexicographically in exactly date order — that is
// the property the format was designed for, and why the DTO ships them as text.

function upsertRow(items: Row[], incoming: Row): Row[] {
  const index = items.findIndex((item) => item.id === incoming.id);
  if (index !== -1) {
    const next = [...items];
    next[index] = { ...next[index], ...incoming };
    return next;
  }

  // Descending, so the insertion point is the first row OLDER than this one.
  const at = items.findIndex((item) => item.createdAt < incoming.createdAt);
  if (at === -1) return [...items, incoming];
  return [...items.slice(0, at), incoming, ...items.slice(at)];
}

function upsertIntoPage(
  page: Page<WorkOrderSummary>,
  saved: WorkOrderSummary,
): Page<WorkOrderSummary> {
  const exists = page.items.some((item) => item.id === saved.id);
  const items = upsertRow(page.items as Row[], saved) as WorkOrderSummary[];
  return exists ? { ...page, items } : { ...page, items, total: page.total + 1 };
}
