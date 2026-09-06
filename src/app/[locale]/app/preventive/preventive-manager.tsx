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
import { CalendarCheck, CircleCheckBig, CirclePlay, Plus, Trash2 } from "lucide-react";

import type { Page, PpmTypeCount } from "@/lib/db";
import {
  PPM_DISPLAY_STATUSES,
  PPM_FREQUENCIES,
  type PpmDisplayStatus,
  type PpmFrequency,
} from "@/lib/domain/preventive";
import type { PpmScheduleSummary } from "@/lib/preventive/dto";
import {
  completePpmScheduleAction,
  createPpmScheduleAction,
  deletePpmScheduleAction,
  listPpmSchedulesAction,
  startPpmScheduleAction,
  summarisePpmSchedulesAction,
  updatePpmScheduleAction,
} from "@/lib/preventive/actions";
import type { ActionResult } from "@/lib/security/action";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Table, type TableColumn } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { Pagination } from "../_components/pagination";
import { PageHeading } from "../_components/page-heading";
import { PpmStatusBadge } from "../_components/ppm-status-badge";
import { RecordActions } from "../_components/record-actions";
import { FrequencyTiles } from "./frequency-tiles";

/** A person or a machine a schedule can be filed against. */
export interface PickerOption {
  id: string;
  name: string;
}

/** A row whose latest state may not have reached the server yet. */
type Row = PpmScheduleSummary & { pending?: boolean };

/** What the form hands to the action. Ids and the date are strings. */
interface ScheduleFormPayload {
  id?: string;
  assetId: string;
  technicianId: string;
  type: string;
  dueDate: string;
}

/**
 * The preventive-maintenance schedule.
 *
 * Nothing here branches on the client/staff split, because there is no client
 * session to branch on: `PpmSchedule` carries no `clientId`, so the data-access
 * layer refuses a CLIENT scope outright and `nav/modules.ts` keeps the route to
 * STAFF. The two role questions this screen does ask are narrower — may this
 * person PLAN work (create, edit, delete), and may they DO it (start, complete)
 * — and both are decided on the server and passed in as booleans. Hiding a
 * button hides an affordance; every action re-checks the role on every call.
 */
export function PreventiveManager({
  initialPage,
  initialSummary,
  canManage,
  canExecute,
  assetOptions,
  technicianOptions,
}: {
  initialPage: Page<PpmScheduleSummary>;
  initialSummary: PpmTypeCount[];
  canManage: boolean;
  canExecute: boolean;
  /** Empty for a session that cannot plan — the pickers are not loaded for them. */
  assetOptions: PickerOption[];
  technicianOptions: PickerOption[];
}) {
  const t = useTranslations("masterData");
  const tp = useTranslations("preventive");
  const tf = useTranslations("preventive.frequency");
  const ts = useTranslations("preventive.status");
  const format = useFormatter();
  const { toast } = useToast();

  const [result, setResult] = useState(initialPage);
  const [summary, setSummary] = useState(initialSummary);
  const [type, setType] = useState<PpmFrequency | "">("");
  const [status, setStatus] = useState<PpmDisplayStatus | "">("");
  const [technicianFilter, setTechnicianFilter] = useState("");
  const [isPending, startTransition] = useTransition();

  const [editing, setEditing] = useState<PpmScheduleSummary | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<PpmScheduleSummary | null>(null);
  const [isDeleting, startDeleting] = useTransition();
  const [isMoving, startMoving] = useTransition();

  /**
   * The optimistic layer.
   *
   * React discards these automatically when the action that produced them
   * settles, so there is no rollback path to write and no way for a failed
   * transition to leave a row showing a state it never reached. It matters more
   * here than on a form: pressing Start in a plant room on a slow connection has
   * to move the badge NOW, or the technician presses it again.
   */
  const [optimisticItems, applyOptimistic] = useOptimistic(
    result.items as Row[],
    (items: Row[], incoming: Row) => upsertRow(items, incoming),
  );

  const load = useCallback(
    (page: number, overrides?: { type?: string; status?: string; technicianId?: string }) => {
      const nextType = overrides?.type ?? type;
      const nextStatus = overrides?.status ?? status;
      const nextTechnician = overrides?.technicianId ?? technicianFilter;

      startTransition(async () => {
        const response = await listPpmSchedulesAction({
          page,
          pageSize: result.pageSize,
          ...(nextType ? { type: nextType } : {}),
          ...(nextStatus ? { status: nextStatus } : {}),
          ...(nextTechnician ? { technicianId: nextTechnician } : {}),
        });

        if (response.ok) setResult(response.data);
        else toast({ title: response.error.message, variant: "danger" });
      });
    },
    [type, status, technicianFilter, result.pageSize, toast],
  );

  /**
   * Refresh the tiles.
   *
   * Called only after a MUTATION, never after a filter change: the counts are of
   * everything open in the tenant, so narrowing the list below them does not
   * change them — and a tile grid that reloaded on every filter would flicker
   * its numbers for no reason.
   */
  const loadSummary = useCallback(() => {
    startTransition(async () => {
      const response = await summarisePpmSchedulesAction({});
      if (response.ok) setSummary(response.data);
    });
  }, []);

  // --- The form -------------------------------------------------------------

  const [formState, submitForm, isSubmitting] = useActionState(
    async (previous: ActionResult<PpmScheduleSummary> | undefined, payload: ScheduleFormPayload) =>
      payload.id
        ? updatePpmScheduleAction(previous, payload)
        : createPpmScheduleAction(previous, payload),
    undefined,
  );

  const handled = useRef<ActionResult<PpmScheduleSummary> | undefined>(undefined);

  useEffect(() => {
    if (!formState || formState === handled.current) return;
    handled.current = formState;

    if (formState.ok) {
      setResult((current) => upsertIntoPage(current, formState.data));
      setFormOpen(false);
      setEditing(null);
      toast({ title: t("saved"), variant: "success" });
      // Reconcile: the server decides ordering, totals and which page this row
      // actually belongs on — and a new visit changes a tile.
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

  function openEdit(schedule: PpmScheduleSummary) {
    setEditing(schedule);
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
        technicianId: text("technicianId"),
        type: text("type"),
        dueDate: text("dueDate"),
      });
    });
  }

  // --- Transitions ----------------------------------------------------------

  /**
   * Start and Complete, which are the same shape.
   *
   * The optimistic row carries BOTH statuses forward — the stored one and the
   * displayed one — because the badge reads `displayStatus` and the button reads
   * `status`. Setting only one would move the badge while leaving Start
   * pressable, which is how a visit gets started twice.
   */
  function move(row: Row, to: "IN_PROGRESS" | "COMPLETED") {
    startMoving(async () => {
      applyOptimistic({ ...row, status: to, displayStatus: to, pending: true });

      const response =
        to === "IN_PROGRESS"
          ? await startPpmScheduleAction({ id: row.id })
          : await completePpmScheduleAction({ id: row.id });

      if (response.ok) {
        setResult((current) => upsertIntoPage(current, response.data));
        toast({
          title: tp(to === "IN_PROGRESS" ? "startedToast" : "completedToast"),
          variant: "success",
        });
        loadSummary();
        return;
      }

      // A field message on a transition means the row moved under us — someone
      // else started it. Show that, then reload so the list tells the truth.
      toast({ title: response.error.fields?.id ?? response.error.message, variant: "danger" });
      load(result.page);
    });
  }

  // --- Delete ---------------------------------------------------------------

  function confirmDelete() {
    if (!deleting) return;

    startDeleting(async () => {
      const response = await deletePpmScheduleAction({ id: deleting.id });

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

  const columns: TableColumn<Row>[] = [
    {
      key: "asset",
      header: tp("asset"),
      cell: (row) =>
        dim(
          row,
          row.assetName ?? <span className="text-muted-foreground">{tp("assetUnknown")}</span>,
        ),
    },
    {
      key: "type",
      header: tp("frequencyLabel"),
      cell: (row) => dim(row, tf(row.type)),
    },
    {
      key: "dueDate",
      header: tp("dueDate"),
      cell: (row) =>
        dim(
          row,
          <span className="tabular-nums numeric-isolate">
            {format.dateTime(new Date(row.dueDate), "short")}
          </span>,
        ),
    },
    {
      key: "technician",
      header: tp("technician"),
      cell: (row) =>
        dim(
          row,
          row.technicianName ?? (
            <span className="text-muted-foreground">{tp("technicianUnknown")}</span>
          ),
        ),
    },
    {
      key: "status",
      header: t("filterStatus"),
      // NOT wrapped in `dim`: the badge's whole job during a pending transition
      // is to show the new state confidently. Fading it would say "maybe".
      cell: (row) => <PpmStatusBadge status={row.displayStatus} />,
    },
  ];

  if (canExecute) {
    columns.push({
      key: "move",
      header: <span className="sr-only">{tp("actions")}</span>,
      cell: (row) => {
        if (row.status === "COMPLETED") {
          return <span className="text-xs text-muted-foreground">{ts("COMPLETED")}</span>;
        }

        const isStart = row.status === "SCHEDULED";

        return (
          <Button
            size="sm"
            variant={isStart ? "primary" : "outline"}
            onClick={() => move(row, isStart ? "IN_PROGRESS" : "COMPLETED")}
            disabled={isMoving || isPending || row.pending}
            aria-label={`${tp(isStart ? "start" : "complete")} — ${row.assetName ?? row.assetId}`}
          >
            {isStart ? (
              <CirclePlay className="size-4" aria-hidden />
            ) : (
              <CircleCheckBig className="size-4" aria-hidden />
            )}
            {tp(isStart ? "start" : "complete")}
          </Button>
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
          name={row.assetName ?? row.assetId}
          onEdit={() => openEdit(row)}
          onDelete={() => setDeleting(row)}
          // A completed visit is a record, and the action refuses to edit one.
          disabled={isPending || isDeleting || row.pending || row.status === "COMPLETED"}
        />
      ),
    });
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeading
        title={tp("title")}
        subtitle={tp("subtitle")}
        note={canManage ? undefined : t("readOnly")}
        action={
          canManage ? (
            <Button onClick={openCreate}>
              <Plus className="size-4" aria-hidden />
              {tp("new")}
            </Button>
          ) : undefined
        }
      />

      <FrequencyTiles
        counts={summary}
        selected={type}
        onSelect={(next) => {
          setType(next);
          load(1, { type: next });
        }}
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Field label={t("filterStatus")}>
            <Select
              value={status}
              onChange={(event) => {
                const next = event.target.value as PpmDisplayStatus | "";
                setStatus(next);
                load(1, { status: next });
              }}
            >
              <option value="">{t("allStatuses")}</option>
              {PPM_DISPLAY_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {ts(value)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {technicianOptions.length > 0 && (
          <div className="w-52">
            <Field label={tp("technician")}>
              <Select
                value={technicianFilter}
                onChange={(event) => {
                  setTechnicianFilter(event.target.value);
                  load(1, { technicianId: event.target.value });
                }}
              >
                <option value="">{tp("allTechnicians")}</option>
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
            icon={CalendarCheck}
            title={tp("empty")}
            description={tp("emptyBody")}
            action={
              canManage ? (
                <Button onClick={openCreate}>
                  <Plus className="size-4" aria-hidden />
                  {tp("new")}
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

      {/* --- Create / edit --- */}
      <Modal
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? tp("editTitle") : tp("newTitle")}
        size="lg"
        icon={<CalendarCheck />}
        /**
         * Passed as `footer` rather than trailing the form inside `children`.
         * The modal scrolls its body and pins its footer, so Save stays on
         * screen instead of being something you scroll the form to reach. The
         * submit button finds the form by `form="ppm-form"`, which works across
         * the DOM — the button is not inside the <form>.
         */
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={isSubmitting}>
              {t("cancel")}
            </Button>
            <Button type="submit" form="ppm-form" isLoading={isSubmitting}>
              {editing ? t("save") : t("create")}
            </Button>
          </>
        }
      >
        {/*
          Two columns against the DIALOG's width (`@lg` = 32rem container), not
          the viewport's — the modal body is the `@container`.
        */}
        <form
          id="ppm-form"
          className="grid items-start gap-x-5 gap-y-4 @lg:grid-cols-2"
          onSubmit={handleSubmit}
        >
          <Field
            label={tp("asset")}
            hint={tp("assetHint")}
            error={fieldErrors.assetId}
            required
            className="@lg:col-span-2"
          >
            <Select name="assetId" defaultValue={editing?.assetId ?? ""} required>
              {!editing && <option value="">—</option>}
              {assetOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={tp("frequencyLabel")} error={fieldErrors.type} required>
            <Select name="type" defaultValue={editing?.type ?? "MONTHLY"}>
              {PPM_FREQUENCIES.map((value) => (
                <option key={value} value={value}>
                  {tf(value)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={tp("dueDate")} hint={tp("dueDateHint")} error={fieldErrors.dueDate} required>
            {/*
              The native date input, not a custom picker: it is keyboard- and
              screen-reader-complete for free, opens the platform's own calendar
              on a phone, and localises its own display. It submits `YYYY-MM-DD`,
              which `z.coerce.date()` reads as UTC midnight — the same instant
              the action normalises every other due date to.
            */}
            <Input
              name="dueDate"
              type="date"
              defaultValue={editing ? editing.dueDate.slice(0, 10) : ""}
              required
            />
          </Field>

          <Field
            label={tp("technician")}
            error={fieldErrors.technicianId}
            required
            className="@lg:col-span-2"
          >
            <Select name="technicianId" defaultValue={editing?.technicianId ?? ""} required>
              {!editing && <option value="">—</option>}
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
        description={tp("deleteBody")}
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
// Both helpers keep the list sorted by due date, which is the order the server
// returns (`sort: { dueDate: 1 }`). Inserting in position rather than prepending
// means a saved row does not visibly jump when the refetch lands. The dates are
// ISO 8601 strings, which sort lexicographically in exactly date order — that is
// the property the format was designed for, and why the DTO ships them as text.

function upsertRow(items: Row[], incoming: Row): Row[] {
  const index = items.findIndex((item) => item.id === incoming.id);
  if (index !== -1) {
    const next = [...items];
    next[index] = { ...next[index], ...incoming };
    return next;
  }

  const at = items.findIndex((item) => item.dueDate > incoming.dueDate);
  if (at === -1) return [...items, incoming];
  return [...items.slice(0, at), incoming, ...items.slice(at)];
}

function upsertIntoPage(
  page: Page<PpmScheduleSummary>,
  saved: PpmScheduleSummary,
): Page<PpmScheduleSummary> {
  const exists = page.items.some((item) => item.id === saved.id);
  const items = upsertRow(page.items as Row[], saved) as PpmScheduleSummary[];
  return exists ? { ...page, items } : { ...page, items, total: page.total + 1 };
}
