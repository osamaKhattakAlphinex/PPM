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
import { Ban, CirclePause, CirclePlay, Plus, ScrollText, Trash2 } from "lucide-react";

import {
  createContractAction,
  deleteContractAction,
  listContractsAction,
  summariseContractsAction,
  transitionContractAction,
  updateContractAction,
} from "@/lib/amc/actions";
import type { ContractSummary, ContractTotals } from "@/lib/amc/dto";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Table, type TableColumn } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import type { Page } from "@/lib/db";
import {
  AMC_CONTRACT_TYPES,
  CONTRACT_DISPLAY_STATUSES,
  canTransitionContract,
  type AmcContractType,
  type ContractDisplayStatus,
} from "@/lib/domain/amc";
import type { ActionResult } from "@/lib/security/action";
import { ContractStatusBadge } from "../_components/contract-status-badge";
import { HealthBar } from "../_components/health-bar";
import { PageHeading } from "../_components/page-heading";
import { Pagination } from "../_components/pagination";
import { RecordActions } from "../_components/record-actions";
import { ContractTiles } from "./contract-tiles";

/**
 * The AMC screen: the KPI header, the contract book, and the sheets that edit
 * it.
 *
 * A Client Component because everything on it is interactive — four filters, a
 * paginated list, an edit sheet and three state transitions — and because the
 * optimistic badge swap has to happen on the press rather than on the response.
 * The first page and the first summary are rendered on the SERVER and handed in
 * as props, so the screen is complete on first paint and this component's
 * fetching only ever replaces what is already there.
 *
 * Every capability is a boolean decided on the server from the session's role.
 * Hiding a button only hides an affordance; each action re-checks the role on
 * every call, and `AMC_MANAGERS` excludes CLIENT entirely.
 */

export interface PickerOption {
  id: string;
  name: string;
}

/** A row plus the flag that dims it while its own mutation is in flight. */
type Row = ContractSummary & { pending?: boolean };

interface ContractFormPayload {
  id?: string;
  clientId?: string;
  contractNumber?: string;
  title: string;
  type: string;
  value: string;
  startDate: string;
  endDate: string;
  compliance: string;
}

export function AmcManager({
  initialPage,
  initialTotals,
  canManage,
  isClientSession,
  clientOptions,
}: {
  initialPage: Page<ContractSummary>;
  initialTotals: ContractTotals;
  canManage: boolean;
  isClientSession: boolean;
  clientOptions: PickerOption[];
}) {
  const t = useTranslations("masterData");
  const ta = useTranslations("amc");
  const tt = useTranslations("amc.type");
  const ts = useTranslations("amc.status");
  const format = useFormatter();
  const { toast } = useToast();

  const [result, setResult] = useState(initialPage);
  const [totals, setTotals] = useState(initialTotals);

  const [status, setStatus] = useState<ContractDisplayStatus | "">("");
  const [type, setType] = useState<AmcContractType | "">("");
  const [clientFilter, setClientFilter] = useState("");
  const [isPending, startTransition] = useTransition();

  const [editing, setEditing] = useState<ContractSummary | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<ContractSummary | null>(null);
  const [cancelling, setCancelling] = useState<ContractSummary | null>(null);
  const [isDeleting, startDeleting] = useTransition();
  const [isMoving, startMoving] = useTransition();

  const [optimisticItems, applyOptimistic] = useOptimistic(
    result.items as Row[],
    (items: Row[], incoming: Row) => upsertRow(items, incoming),
  );

  /**
   * The refetch, called by every filter and by pagination.
   *
   * Overrides exist because a `useState` setter does not update the value this
   * closure already captured — pressing a tile has to pass the new status in
   * rather than rely on the re-render that has not happened yet.
   */
  const load = useCallback(
    (
      page: number,
      overrides?: { status?: ContractDisplayStatus | ""; type?: string; clientId?: string },
    ) => {
      const nextStatus = overrides?.status ?? status;
      const nextType = overrides?.type ?? type;
      const nextClient = overrides?.clientId ?? clientFilter;

      startTransition(async () => {
        const response = await listContractsAction({
          page,
          pageSize: result.pageSize,
          ...(nextStatus ? { status: nextStatus } : {}),
          ...(nextType ? { type: nextType } : {}),
          ...(nextClient ? { clientId: nextClient } : {}),
        });

        if (response.ok) setResult(response.data);
        else toast({ title: response.error.message, variant: "danger" });
      });
    },
    [status, type, clientFilter, result.pageSize, toast],
  );

  /**
   * Called only after a MUTATION, never after a filter change.
   *
   * The header counts the whole tenant's book, so narrowing the list does not
   * change them — refetching on every filter press would be four round trips
   * for four identical answers, and a header that flickered while the list
   * settled.
   */
  const loadTotals = useCallback(async () => {
    const response = await summariseContractsAction({});
    if (response.ok) setTotals(response.data);
  }, []);

  const [formState, submitForm, isSubmitting] = useActionState(
    async (previous: ActionResult<ContractSummary> | undefined, payload: ContractFormPayload) =>
      payload.id ? updateContractAction(previous, payload) : createContractAction(previous, payload),
    undefined,
  );

  /**
   * `useActionState` keeps the last result forever, so the effect below has to
   * know whether it has already acted on this one. Without the ref, closing and
   * reopening the sheet would replay the previous success and close it again.
   */
  const handled = useRef<ActionResult<ContractSummary> | undefined>(undefined);

  useEffect(() => {
    if (!formState || formState === handled.current) return;
    handled.current = formState;

    if (formState.ok) {
      setResult((current) => upsertIntoPage(current, formState.data));
      setFormOpen(false);
      setEditing(null);
      toast({ title: t("saved"), variant: "success" });
      // The server owns ordering and totals: a contract whose end date moved
      // belongs somewhere else in the list, and only a refetch knows where.
      load(result.page);
      void loadTotals();
      return;
    }

    // Field errors are rendered against the inputs themselves; a toast on top of
    // them would say the same thing twice, further from the fix.
    if (formState.error.code !== "VALIDATION_FAILED") {
      toast({ title: formState.error.message, variant: "danger" });
    }
  }, [formState, load, loadTotals, result.page, t, toast]);

  const fieldErrors = formState && !formState.ok ? (formState.error.fields ?? {}) : {};

  function openCreate() {
    setEditing(null);
    handled.current = formState;
    setFormOpen(true);
  }

  function openEdit(row: ContractSummary) {
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
          : { clientId: text("clientId"), contractNumber: text("contractNumber") }),
        title: text("title"),
        type: text("type"),
        // Submitted as the STRING the input produced. `sarInputSchema` is built
        // to take exactly that and convert riyals to halalas by integer
        // arithmetic; a `Number()` here would reintroduce the float the schema
        // exists to avoid.
        value: text("value"),
        startDate: text("startDate"),
        endDate: text("endDate"),
        compliance: text("compliance"),
      });
    });
  }

  function confirmDelete() {
    const row = deleting;
    if (!row) return;

    startDeleting(async () => {
      const response = await deleteContractAction({ id: row.id });
      if (response.ok) {
        setDeleting(null);
        toast({ title: t("deleted"), variant: "success" });
        load(result.page);
        void loadTotals();
        return;
      }
      toast({ title: response.error.message, variant: "danger" });
    });
  }

  /**
   * Suspend, resume, cancel.
   *
   * The badge is swapped optimistically so the press reads as having done
   * something before the round trip lands. On failure the row is reloaded rather
   * than patched back: a rejected transition means the row moved under whoever
   * pressed the button, and the truthful thing to show is what it actually is
   * now.
   */
  function move(row: Row, to: "ACTIVE" | "SUSPENDED" | "CANCELLED") {
    startMoving(async () => {
      applyOptimistic({
        ...row,
        status: to,
        // The DISPLAY status is derived from dates on the server and cannot be
        // recomputed here without a clock this component must not trust. For
        // the two stored non-ACTIVE states the derivation is an early return —
        // the stored value IS the display value — so those are exact. Resuming
        // is the one case that has to wait for the server to say which of
        // UPCOMING/ACTIVE/EXPIRING/EXPIRED the term makes it, so the badge holds
        // its previous value for that one beat rather than guessing wrong.
        ...(to === "ACTIVE" ? {} : { displayStatus: to }),
        pending: true,
      });

      const response = await transitionContractAction({ id: row.id, to });

      if (response.ok) {
        setResult((current) => upsertIntoPage(current, response.data));
        setCancelling(null);
        toast({ title: ta(TOAST_KEY[to]), variant: "success" });
        void loadTotals();
        return;
      }

      toast({
        title: response.error.fields?.id ?? response.error.message,
        variant: "danger",
      });
      load(result.page);
    });
  }

  const busy = isPending || isDeleting || isMoving;

  /** Dim a cell while the row's own mutation is in flight. */
  const dim = (row: Row, node: ReactNode) => (
    <span className={cn("block", row.pending && "opacity-50")}>{node}</span>
  );

  const columns: TableColumn<Row>[] = [
    {
      key: "contract",
      header: ta("contract"),
      cell: (row) =>
        dim(
          row,
          <span className="block">
            <span className="block max-w-xs truncate font-medium text-foreground" title={row.title}>
              {row.title}
            </span>
            {/*
              A contract reference is Latin text that must not reorder inside an
              Arabic row. `bidi-isolate` rather than `numeric-isolate`: it is a
              code, not a figure, so it should not be forced to tabular digits.
            */}
            <span className="block text-xs text-muted-foreground bidi-isolate">
              {row.contractNumber}
            </span>
          </span>,
        ),
    },
  ];

  // A customer already knows whose contracts these are, and the server does not
  // resolve client names for a client session at all — `clientsRepository`
  // refuses a client scope, so the column would be blanks even if it were shown.
  if (!isClientSession) {
    columns.push({
      key: "client",
      header: ta("client"),
      cell: (row) => dim(row, <span>{row.clientName ?? ta("clientUnknown")}</span>),
    });
  }

  columns.push(
    {
      key: "type",
      header: ta("typeLabel"),
      cell: (row) => dim(row, <span>{tt(row.type)}</span>),
    },
    {
      key: "term",
      header: ta("term"),
      cell: (row) =>
        dim(
          row,
          <span className="whitespace-nowrap tabular-nums numeric-isolate">
            {format.dateTime(new Date(row.startDate), "short")}
            {" – "}
            {format.dateTime(new Date(row.endDate), "short")}
          </span>,
        ),
    },
    {
      key: "value",
      header: ta("value"),
      className: "text-end",
      cell: (row) =>
        dim(
          row,
          <span className="tabular-nums numeric-isolate">
            {format.number(row.value, "currency")}
          </span>,
        ),
    },
    {
      key: "compliance",
      header: ta("compliance"),
      cell: (row) =>
        dim(row, <HealthBar value={row.compliance} label={`${ta("compliance")} — ${row.title}`} />),
    },
    {
      key: "status",
      // NOT wrapped in `dim`: the badge's whole job during a pending transition
      // is to show the new state confidently. Fading it would say "maybe".
      header: t("filterStatus"),
      cell: (row) => <ContractStatusBadge status={row.displayStatus} />,
    },
  );

  if (canManage) {
    columns.push({
      key: "moves",
      header: <span className="sr-only">{ta("actions")}</span>,
      cell: (row) => (
        <span className="flex items-center gap-1">
          {canTransitionContract(row.status, "SUSPENDED") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => move(row, "SUSPENDED")}
              disabled={busy || row.pending}
              aria-label={`${ta("suspend")} — ${row.title}`}
            >
              <CirclePause className="size-4" aria-hidden />
              <span className="sr-only sm:not-sr-only">{ta("suspend")}</span>
            </Button>
          )}
          {canTransitionContract(row.status, "ACTIVE") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => move(row, "ACTIVE")}
              disabled={busy || row.pending}
              aria-label={`${ta("resume")} — ${row.title}`}
            >
              <CirclePlay className="size-4" aria-hidden />
              <span className="sr-only sm:not-sr-only">{ta("resume")}</span>
            </Button>
          )}
          {/*
            Cancelling is terminal and irreversible, so it goes through a
            confirmation rather than straight to the action — the same treatment
            delete gets, for the same reason.
          */}
          {canTransitionContract(row.status, "CANCELLED") && (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:bg-danger/10"
              onClick={() => setCancelling(row)}
              disabled={busy || row.pending}
              aria-label={`${ta("cancelContract")} — ${row.title}`}
            >
              <Ban className="size-4" aria-hidden />
              <span className="sr-only">{ta("cancelContract")}</span>
            </Button>
          )}
        </span>
      ),
    });

    columns.push({
      key: "actions",
      header: <span className="sr-only">{t("actions")}</span>,
      className: "text-end",
      cell: (row) => (
        <RecordActions
          name={row.title}
          onEdit={() => openEdit(row)}
          onDelete={() => setDeleting(row)}
          // A cancelled contract is a record of what was agreed and then ended.
          // The server refuses the edit; the button says so first.
          disabled={busy || row.pending || row.status === "CANCELLED"}
        />
      ),
    });
  }

  const hasFilters = status !== "" || type !== "" || clientFilter !== "";

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeading
        title={ta("title")}
        subtitle={isClientSession ? ta("clientSubtitle") : ta("subtitle")}
        note={canManage ? undefined : t("readOnly")}
        action={
          canManage ? (
            <Button onClick={openCreate}>
              <Plus className="size-4" aria-hidden />
              {ta("new")}
            </Button>
          ) : undefined
        }
      />

      <ContractTiles
        totals={totals}
        selected={status}
        onSelect={(next) => {
          setStatus(next);
          load(1, { status: next });
        }}
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-52">
          <Field label={t("filterStatus")}>
            <Select
              value={status}
              onChange={(event) => {
                const next = event.target.value as ContractDisplayStatus | "";
                setStatus(next);
                load(1, { status: next });
              }}
            >
              <option value="">{t("allStatuses")}</option>
              {CONTRACT_DISPLAY_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {ts(value)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="w-52">
          <Field label={ta("typeLabel")}>
            <Select
              value={type}
              onChange={(event) => {
                const next = event.target.value as AmcContractType | "";
                setType(next);
                load(1, { type: next });
              }}
            >
              <option value="">{ta("allTypes")}</option>
              {AMC_CONTRACT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {tt(value)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* Only staff get a client filter; a customer's list is already theirs. */}
        {clientOptions.length > 0 && (
          <div className="w-52">
            <Field label={ta("client")}>
              <Select
                value={clientFilter}
                onChange={(event) => {
                  const next = event.target.value;
                  setClientFilter(next);
                  load(1, { clientId: next });
                }}
              >
                <option value="">{t("allClients")}</option>
                {clientOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        {hasFilters && (
          <Button
            variant="ghost"
            onClick={() => {
              setStatus("");
              setType("");
              setClientFilter("");
              load(1, { status: "", type: "", clientId: "" });
            }}
            disabled={isPending}
          >
            {t("clear")}
          </Button>
        )}
      </div>

      <Table
        columns={columns}
        data={optimisticItems}
        isLoading={isPending && optimisticItems.length === 0}
        emptyState={
          <EmptyState
            icon={ScrollText}
            title={ta("empty")}
            description={isClientSession ? ta("clientEmptyBody") : ta("emptyBody")}
            action={
              canManage ? (
                <Button onClick={openCreate}>
                  <Plus className="size-4" aria-hidden />
                  {ta("new")}
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

      {/* --- Create / edit --------------------------------------------------- */}
      <Modal
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? ta("editTitle") : ta("newTitle")}
        size="lg"
        icon={<ScrollText />}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={isSubmitting}>
              {t("cancel")}
            </Button>
            {/*
              Reaches the form across the DOM by id, because the modal pins its
              footer outside the scrolling body.
            */}
            <Button type="submit" form="amc-form" isLoading={isSubmitting}>
              {editing ? t("save") : t("create")}
            </Button>
          </>
        }
      >
        {/*
          The modal body is a `@container`, so the two-column split is a
          CONTAINER query rather than a viewport one — the sheet is narrow on a
          phone regardless of how wide the window is behind it.
        */}
        <form
          id="amc-form"
          className="grid items-start gap-x-5 gap-y-4 @lg:grid-cols-2"
          onSubmit={handleSubmit}
        >
          <Field
            label={ta("titleLabel")}
            hint={ta("titleHint")}
            error={fieldErrors.title}
            required
            className="@lg:col-span-2"
          >
            <Input name="title" defaultValue={editing?.title ?? ""} maxLength={160} required />
          </Field>

          {/*
            Both are create-only. The client is the counterparty — moving a
            contract between customers is a new contract — and the reference goes
            on invoices, so neither is editable once saved. The server enforces
            it independently: they are simply not fields on the update schema.
          */}
          {!editing && (
            <>
              <Field label={ta("client")} hint={ta("clientHint")} error={fieldErrors.clientId} required>
                <Select name="clientId" defaultValue="" required>
                  <option value="">—</option>
                  {clientOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label={ta("contractNumber")}
                hint={ta("contractNumberHint")}
                error={fieldErrors.contractNumber}
                required
              >
                <Input name="contractNumber" maxLength={32} required />
              </Field>
            </>
          )}

          <Field label={ta("typeLabel")} hint={ta("typeHint")} error={fieldErrors.type} required>
            <Select name="type" defaultValue={editing?.type ?? ""} required>
              {!editing && <option value="">—</option>}
              {AMC_CONTRACT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {tt(value)}
                </option>
              ))}
            </Select>
          </Field>

          {/*
            Riyals, to two decimals. `type="number"` with `step="0.01"` gives a
            numeric keypad and the browser's own bounds; `FormData` still hands
            back a STRING, which is exactly what `sarInputSchema` takes.
            `toFixed(2)` round-trips the DTO's major-unit float back into a
            two-decimal string the schema's regex accepts.
          */}
          <Field label={ta("value")} hint={ta("valueHint")} error={fieldErrors.value} required>
            <Input
              name="value"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              defaultValue={editing ? editing.value.toFixed(2) : ""}
              required
            />
          </Field>

          {/*
            Both date inputs always render and always submit, which is what makes
            the update schema's "both dates together, or neither" rule invisible
            to anyone using the screen. `slice(0, 10)` turns the DTO's ISO string
            into the `YYYY-MM-DD` a date input wants.
          */}
          <Field
            label={ta("startDate")}
            hint={ta("startDateHint")}
            error={fieldErrors.startDate}
            required
          >
            <Input
              name="startDate"
              type="date"
              defaultValue={editing ? editing.startDate.slice(0, 10) : ""}
              required
            />
          </Field>

          <Field label={ta("endDate")} hint={ta("endDateHint")} error={fieldErrors.endDate} required>
            <Input
              name="endDate"
              type="date"
              defaultValue={editing ? editing.endDate.slice(0, 10) : ""}
              required
            />
          </Field>

          <Field
            label={ta("compliance")}
            hint={ta("complianceHint")}
            error={fieldErrors.compliance}
            required
          >
            <Input
              name="compliance"
              type="number"
              min={0}
              max={100}
              step="1"
              inputMode="numeric"
              defaultValue={editing ? String(editing.compliance) : "100"}
              required
            />
          </Field>
        </form>
      </Modal>

      {/* --- Cancel confirmation --------------------------------------------- */}
      <Modal
        open={cancelling !== null}
        onOpenChange={(open) => !open && setCancelling(null)}
        title={ta("cancelTitle")}
        description={ta("cancelBody")}
        tone="danger"
        icon={<Ban />}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelling(null)} disabled={isMoving}>
              {t("cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => cancelling && move(cancelling, "CANCELLED")}
              isLoading={isMoving}
            >
              {ta("cancelContract")}
            </Button>
          </>
        }
      />

      {/* --- Delete confirmation --------------------------------------------- */}
      <Modal
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("deleteTitle", { name: deleting?.title ?? "" })}
        description={ta("deleteBody")}
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

/** Which toast a completed transition raises. */
const TOAST_KEY = {
  ACTIVE: "resumedToast",
  SUSPENDED: "suspendedToast",
  CANCELLED: "cancelledToast",
} as const;

/**
 * Merge a saved row into the list without moving it.
 *
 * A row that jumped to the top the instant it was saved, then jumped back when
 * the refetch landed, would read as two separate edits. New rows are inserted at
 * their sorted position — `endDate` ascending, soonest renewal first — which is
 * the order the server returns.
 */
function upsertRow(items: Row[], incoming: Row): Row[] {
  const index = items.findIndex((item) => item.id === incoming.id);
  if (index !== -1) {
    const next = [...items];
    next[index] = { ...next[index], ...incoming };
    return next;
  }

  // ISO 8601 strings sort lexicographically in date order, which is why the DTO
  // ships them as strings rather than timestamps.
  const at = items.findIndex((item) => item.endDate > incoming.endDate);
  if (at === -1) return [...items, incoming];
  return [...items.slice(0, at), incoming, ...items.slice(at)];
}

function upsertIntoPage(
  page: Page<ContractSummary>,
  saved: ContractSummary,
): Page<ContractSummary> {
  const exists = page.items.some((item) => item.id === saved.id);
  const items = upsertRow(page.items as Row[], saved) as ContractSummary[];
  return exists ? { ...page, items } : { ...page, items, total: page.total + 1 };
}
