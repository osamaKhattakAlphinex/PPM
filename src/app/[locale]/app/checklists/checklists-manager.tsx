"use client";

import {
  // Aliased: `useTransition()` below binds a local `startTransition` for the
  // LIST's pending state, and an unaliased import would be shadowed by it —
  // silently routing form submits through the list's spinner.
  startTransition as startFormTransition,
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useFormatter, useTranslations } from "next-intl";
import { ClipboardList, ListChecks, Play, Plus, Search, Trash2 } from "lucide-react";

import type { Page } from "@/lib/db";
import { CHECKLIST_CATEGORIES, type ChecklistCategory } from "@/lib/domain/checklists";
import type { ChecklistRunSummary, ChecklistSummary } from "@/lib/checklists/dto";
import {
  createChecklistAction,
  deleteChecklistAction,
  listChecklistRunsAction,
  listChecklistsAction,
  updateChecklistAction,
} from "@/lib/checklists/actions";
import type { ActionResult } from "@/lib/security/action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Table, type TableColumn } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { ChecklistRunBadge } from "../_components/checklist-run-badge";
import { PageHeading } from "../_components/page-heading";
import { Pagination } from "../_components/pagination";
import { RecordActions } from "../_components/record-actions";
import { ItemBuilder, toDraftItems, type DraftItem } from "./item-builder";
import { RunSheet, type JobOption } from "./run-sheet";

/**
 * Checklists — the procedure library, and the runs it has produced.
 *
 * Two tables on one screen, because they are two halves of one idea and
 * splitting them across routes would hide the half that proves the other one
 * works. The library is what the organization SAYS should happen; the runs are
 * what actually did. A supervisor opening this module wants both in one glance.
 *
 * Two capabilities, decided on the server and passed in as booleans:
 *
 *  - `canManage` — may write and delete a procedure, and discard a run
 *    (ADMIN/FM_MANAGER/SUPERVISOR)
 *  - `canRun`    — may attach a checklist to a job and tick it off (every staff
 *    role, because the person in the plant room is the technician)
 *
 * The split is the point of the module: the people who CARRY OUT a procedure
 * are deliberately not the people who decide what it contains. Hiding a button
 * hides an affordance; every action re-checks the role on every call.
 */
export function ChecklistsManager({
  initialChecklists,
  initialRuns,
  canManage,
  canRun,
  ppmOptions,
  workOrderOptions,
}: {
  initialChecklists: Page<ChecklistSummary>;
  initialRuns: Page<ChecklistRunSummary>;
  canManage: boolean;
  canRun: boolean;
  /** Empty for a session that cannot run — the pickers are not loaded for them. */
  ppmOptions: JobOption[];
  workOrderOptions: JobOption[];
}) {
  const t = useTranslations("checklists");
  const tm = useTranslations("masterData");
  const format = useFormatter();
  const { toast } = useToast();

  const [library, setLibrary] = useState(initialChecklists);
  const [runs, setRuns] = useState(initialRuns);
  const [category, setCategory] = useState<ChecklistCategory | "">("");
  const [term, setTerm] = useState("");
  const [isPending, startTransition] = useTransition();
  const [isRunsPending, startRunsTransition] = useTransition();

  const [editing, setEditing] = useState<ChecklistSummary | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [deleting, setDeleting] = useState<ChecklistSummary | null>(null);
  const [isDeleting, startDeleting] = useTransition();

  /** The checklist whose run sheet is open, and the run itself once it exists. */
  const [running, setRunning] = useState<ChecklistSummary | null>(null);
  const [activeRun, setActiveRun] = useState<ChecklistRunSummary | null>(null);

  const loadLibrary = useCallback(
    (page: number, overrides?: { category?: string; q?: string }) => {
      const nextCategory = overrides?.category ?? category;
      const nextTerm = overrides?.q ?? term;

      startTransition(async () => {
        const response = await listChecklistsAction({
          page,
          pageSize: library.pageSize,
          ...(nextCategory ? { category: nextCategory } : {}),
          ...(nextTerm.trim() ? { q: nextTerm.trim() } : {}),
        });

        if (response.ok) setLibrary(response.data);
        else toast({ title: response.error.message, variant: "danger" });
      });
    },
    [category, term, library.pageSize, toast],
  );

  const loadRuns = useCallback(
    (page: number) => {
      startRunsTransition(async () => {
        const response = await listChecklistRunsAction({ page, pageSize: runs.pageSize });
        if (response.ok) setRuns(response.data);
        else toast({ title: response.error.message, variant: "danger" });
      });
    },
    [runs.pageSize, toast],
  );

  // --- The builder form -----------------------------------------------------

  const [formState, submitForm, isSubmitting] = useActionState(
    async (previous: ActionResult<ChecklistSummary> | undefined, payload: unknown) =>
      editing ? updateChecklistAction(previous, payload) : createChecklistAction(previous, payload),
    undefined,
  );

  const handled = useRef<ActionResult<ChecklistSummary> | undefined>(undefined);

  useEffect(() => {
    if (!formState || formState === handled.current) return;
    handled.current = formState;

    if (formState.ok) {
      setFormOpen(false);
      setEditing(null);
      toast({ title: tm("saved"), variant: "success" });
      // Reconcile: the server decides ordering, totals and which page this row
      // actually belongs on.
      loadLibrary(library.page);
      return;
    }

    if (formState.error.code !== "VALIDATION_FAILED") {
      toast({ title: formState.error.message, variant: "danger" });
    }
  }, [formState, library.page, loadLibrary, tm, toast]);

  const fieldErrors = formState && !formState.ok ? (formState.error.fields ?? {}) : {};

  function openCreate() {
    setEditing(null);
    setItems([]);
    handled.current = formState;
    setFormOpen(true);
  }

  function openEdit(checklist: ChecklistSummary) {
    setEditing(checklist);
    // Wrapped in draft rows with client-side ids the moment the sheet opens, so
    // reordering never has to fall back to index or label identity. See
    // `item-builder.tsx`.
    setItems(toDraftItems(checklist.items));
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
     * The `uid` is stripped here — it is browser bookkeeping, and the action
     * schemas are strict objects that reject an unknown key. Order is preserved
     * exactly as the builder left it, because on the server the position IS the
     * item's identity.
     */
    const payload = {
      ...(editing ? { id: editing.id } : {}),
      name: text("name"),
      category: text("category"),
      items: items.map((item) => ({ label: item.label, required: item.required })),
    };

    // React's own `startTransition`, because this dispatch comes from a manual
    // `onSubmit` rather than a `<form action>` prop — without it `isSubmitting`
    // never flips. Not the binding from `useTransition()` above: that drives the
    // list's spinner, and a save is not a list reload.
    startFormTransition(() => submitForm(payload));
  }

  function confirmDelete() {
    if (!deleting) return;

    startDeleting(async () => {
      const response = await deleteChecklistAction({ id: deleting.id });

      if (response.ok) {
        toast({ title: tm("deleted"), variant: "success" });
        setDeleting(null);
        loadLibrary(
          library.items.length === 1 && library.page > 1 ? library.page - 1 : library.page,
        );
      } else {
        toast({ title: response.error.message, variant: "danger" });
      }
    });
  }

  // --- The run sheet --------------------------------------------------------

  function openRun(checklist: ChecklistSummary) {
    setRunning(checklist);
    setActiveRun(null);
  }

  function closeRun() {
    // The runs table is refreshed on the way OUT rather than on every tick: a
    // run in progress is already fully represented inside the sheet, and
    // reloading the table under it would move rows while someone is reading
    // them. `lastUsedAt` on the library row changes too, hence both reloads.
    if (activeRun) {
      loadRuns(1);
      loadLibrary(library.page);
    }
    setRunning(null);
    setActiveRun(null);
  }

  // --- The library table ----------------------------------------------------

  const libraryColumns: TableColumn<ChecklistSummary>[] = [
    {
      key: "name",
      header: t("name"),
      cell: (row) => <span className="font-medium text-foreground">{row.name}</span>,
    },
    {
      key: "category",
      header: t("categoryLabel"),
      cell: (row) => <Badge variant="neutral">{t(`category.${row.category}`)}</Badge>,
    },
    {
      key: "steps",
      header: t("steps"),
      cell: (row) => (
        <span className="tabular-nums numeric-isolate text-sm">
          {t("stepSummary", { count: row.itemCount, required: row.requiredCount })}
        </span>
      ),
    },
    {
      key: "lastUsed",
      header: t("lastUsed"),
      cell: (row) =>
        row.lastUsedAt ? (
          <span className="tabular-nums numeric-isolate">
            {format.dateTime(new Date(row.lastUsedAt), "short")}
          </span>
        ) : (
          // "Never" is a real and useful answer here — it is how a supervisor
          // spots a procedure that was written and then forgotten.
          <span className="text-muted-foreground">{t("neverUsed")}</span>
        ),
    },
  ];

  if (canRun) {
    libraryColumns.push({
      key: "run",
      header: <span className="sr-only">{t("run")}</span>,
      cell: (row) => (
        <Button
          size="sm"
          variant="outline"
          onClick={() => openRun(row)}
          aria-label={`${t("run")} — ${row.name}`}
        >
          <Play className="size-4" aria-hidden />
          {t("run")}
        </Button>
      ),
    });
  }

  if (canManage) {
    libraryColumns.push({
      key: "actions",
      header: <span className="sr-only">{tm("actions")}</span>,
      className: "text-end",
      cell: (row) => (
        <RecordActions
          name={row.name}
          onEdit={() => openEdit(row)}
          onDelete={() => setDeleting(row)}
          disabled={isPending || isDeleting}
        />
      ),
    });
  }

  // --- The runs table -------------------------------------------------------

  const runColumns: TableColumn<ChecklistRunSummary>[] = [
    {
      key: "checklist",
      header: t("checklist"),
      cell: (row) => <span className="font-medium text-foreground">{row.checklistName}</span>,
    },
    {
      key: "job",
      header: t("job"),
      cell: (row) => (
        <span className="block max-w-xs truncate" title={row.jobLabel ?? undefined}>
          <span className="me-1.5 text-xs uppercase tracking-wide text-muted-foreground">
            {t(`jobTypes.${row.jobType}`)}
          </span>
          {row.jobLabel ?? <span className="text-muted-foreground">{t("jobUnknown")}</span>}
        </span>
      ),
    },
    {
      key: "progress",
      header: t("progress"),
      cell: (row) => (
        <span className="tabular-nums numeric-isolate">
          {t("progressCount", { done: row.progress.done, total: row.progress.total })}
        </span>
      ),
    },
    {
      key: "status",
      header: tm("filterStatus"),
      cell: (row) => <ChecklistRunBadge status={row.status} />,
    },
    {
      key: "open",
      header: <span className="sr-only">{t("openRun")}</span>,
      className: "text-end",
      cell: (row) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            // Opening from the runs table skips the attach step entirely: the
            // run already exists, so the sheet goes straight to its second
            // state. `running` still carries the template's name for the
            // dialog title, reconstructed from the run's own snapshot so a
            // deleted template does not blank the header.
            setRunning({
              id: row.checklistId,
              name: row.checklistName,
              category: row.category,
              items: [],
              itemCount: row.progress.total,
              requiredCount: 0,
              lastUsedAt: null,
              createdAt: row.createdAt,
            });
            setActiveRun(row);
          }}
          aria-label={`${t("openRun")} — ${row.checklistName}`}
        >
          <ListChecks className="size-4" aria-hidden />
          <span className="sr-only md:not-sr-only md:inline">{t("openRun")}</span>
        </Button>
      ),
    },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeading
        title={t("title")}
        subtitle={t("subtitle")}
        note={canManage ? undefined : t("runnerOnly")}
        action={
          canManage ? (
            <Button onClick={openCreate}>
              <Plus className="size-4" aria-hidden />
              {t("new")}
            </Button>
          ) : undefined
        }
      />

      {/* --- Library filters --- */}
      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          loadLibrary(1);
        }}
      >
        <div className="w-52">
          <Field label={t("categoryLabel")}>
            <Select
              value={category}
              onChange={(event) => {
                const next = event.target.value as ChecklistCategory | "";
                setCategory(next);
                loadLibrary(1, { category: next });
              }}
            >
              <option value="">{t("allCategories")}</option>
              {CHECKLIST_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {t(`category.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="w-56">
          <Field label={tm("search")}>
            <Input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder={t("searchPlaceholder")}
              maxLength={64}
            />
          </Field>
        </div>

        <Button type="submit" variant="outline" disabled={isPending}>
          <Search className="size-4" aria-hidden />
          {tm("searchAction")}
        </Button>

        {(term || category) && (
          <Button
            variant="ghost"
            onClick={() => {
              setTerm("");
              setCategory("");
              loadLibrary(1, { category: "", q: "" });
            }}
          >
            {tm("clear")}
          </Button>
        )}
      </form>

      <Table
        columns={libraryColumns}
        data={library.items}
        emptyState={
          <EmptyState
            icon={ClipboardList}
            title={t("empty")}
            description={t("emptyBody")}
            action={
              canManage ? (
                <Button onClick={openCreate}>
                  <Plus className="size-4" aria-hidden />
                  {t("new")}
                </Button>
              ) : undefined
            }
          />
        }
      />

      <Pagination
        page={library.page}
        totalPages={library.totalPages}
        total={library.total}
        isPending={isPending}
        onChange={loadLibrary}
      />

      {/* --- Runs --- */}
      <section className="mt-10">
        <h3 className="font-display text-xl font-semibold text-foreground">{t("runsTitle")}</h3>
        <p className="mt-1 mb-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {t("runsSubtitle")}
        </p>

        <Table
          columns={runColumns}
          data={runs.items}
          emptyState={
            <EmptyState icon={ListChecks} title={t("noRuns")} description={t("noRunsBody")} />
          }
        />

        <Pagination
          page={runs.page}
          totalPages={runs.totalPages}
          total={runs.total}
          isPending={isRunsPending}
          onChange={loadRuns}
        />
      </section>

      {/* --- Builder --- */}
      <Modal
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? t("editTitle") : t("newTitle")}
        size="lg"
        icon={<ClipboardList />}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={isSubmitting}>
              {tm("cancel")}
            </Button>
            <Button type="submit" form="checklist-form" isLoading={isSubmitting}>
              {editing ? tm("save") : tm("create")}
            </Button>
          </>
        }
      >
        <form id="checklist-form" className="grid items-start gap-y-4" onSubmit={handleSubmit}>
          {/*
            Name and category go two-up from the container's `lg` breakpoint,
            which is the DIALOG's width and not the window's — see the note on
            `Modal`. The builder below always spans, because a step list squeezed
            into half a dialog is a step list nobody can read.
          */}
          <div className="grid gap-4 @lg:grid-cols-2">
            <Field label={t("name")} error={fieldErrors.name} required>
              <Input
                name="name"
                defaultValue={editing?.name ?? ""}
                minLength={2}
                maxLength={120}
                required
              />
            </Field>

            <Field
              label={t("categoryLabel")}
              hint={t("categoryHint")}
              error={fieldErrors.category}
              required
            >
              <Select name="category" defaultValue={editing?.category ?? ""} required>
                {!editing && <option value="">—</option>}
                {CHECKLIST_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {t(`category.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <ItemBuilder
            items={items}
            onChange={setItems}
            // A per-item message comes back keyed by its path; showing it on the
            // builder as a whole is honest without pretending to know which row
            // the server meant after a reorder.
            error={fieldErrors.items}
            disabled={isSubmitting}
          />
        </form>
      </Modal>

      {/* --- Run sheet --- */}
      <Modal
        open={running !== null}
        onOpenChange={(open) => !open && closeRun()}
        title={running?.name ?? ""}
        description={activeRun ? undefined : t("attachTitle")}
        size="md"
        icon={<ListChecks />}
        footer={
          <Button variant="ghost" onClick={closeRun}>
            {t("close")}
          </Button>
        }
      >
        {running && (
          <RunSheet
            checklistId={running.id}
            checklistName={running.name}
            run={activeRun}
            onRunChange={setActiveRun}
            canRun={canRun}
            ppmOptions={ppmOptions}
            workOrderOptions={workOrderOptions}
          />
        )}
      </Modal>

      {/* --- Delete confirmation --- */}
      <Modal
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={tm("deleteTitle", { name: deleting?.name ?? "" })}
        description={t("deleteBody")}
        tone="danger"
        icon={<Trash2 />}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={isDeleting}>
              {tm("cancel")}
            </Button>
            <Button variant="danger" onClick={confirmDelete} isLoading={isDeleting}>
              {tm("delete")}
            </Button>
          </>
        }
      />
    </div>
  );
}
