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
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Boxes, Paperclip, Plus, Trash2 } from "lucide-react";

import type { AssetSummary } from "@/lib/assets/dto";
import {
  createAssetAction,
  deleteAssetAction,
  listAssetsAction,
  updateAssetAction,
} from "@/lib/assets/actions";
// Type-only, so nothing from the DAL survives into the browser bundle. The
// category and status VALUES come from the pure domain module instead —
// importing them from `@/lib/db` pulls Mongoose (and `net`, `fs`, `tls`) in.
import type { Page } from "@/lib/db";
import { ASSET_CATEGORIES, ASSET_STATUSES } from "@/lib/domain/assets";
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
import { localeHref, type Locale } from "@/lib/i18n/config";
import { HealthBar } from "../_components/health-bar";
import { Pagination } from "../_components/pagination";
import { PageHeading } from "../_components/page-heading";
import { RecordActions } from "../_components/record-actions";
import { StatusBadge } from "../_components/status-badge";

export interface LocationOption {
  id: string;
  name: string;
  /** Null for an organization-wide site. Used to constrain where an asset may move. */
  clientId: string | null;
}

/** A row that may not exist on the server yet. */
type Row = AssetSummary & { pending?: boolean };

/** What the form hands to the action. Ids are strings; the schema coerces health. */
interface AssetFormPayload {
  id?: string;
  name: string;
  category: string;
  type: string;
  locationId: string;
  status: string;
  health: string;
}

/**
 * The asset register.
 *
 * This screen renders for a CLIENT session too, and nothing in it branches on
 * that. The list is already narrowed before it arrives: `Asset` carries a
 * `clientId`, so the data-access layer appends the session's own client id to
 * every filter — after anything passed in, so it cannot be displaced. What a
 * client sees here is what the database returned, not what a component chose to
 * draw.
 */
export function AssetsManager({
  initialPage,
  canManage,
  locationOptions,
  isClientSession,
}: {
  initialPage: Page<AssetSummary>;
  canManage: boolean;
  locationOptions: LocationOption[];
  isClientSession: boolean;
}) {
  const t = useTranslations("masterData");
  const ta = useTranslations("masterData.assets");
  const tc = useTranslations("masterData.assets.category");
  const tf = useTranslations("files");
  const locale = useLocale() as Locale;
  const { toast } = useToast();

  const [result, setResult] = useState(initialPage);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [isPending, startTransition] = useTransition();

  const [editing, setEditing] = useState<AssetSummary | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<AssetSummary | null>(null);
  const [isDeleting, startDeleting] = useTransition();

  /**
   * The optimistic layer.
   *
   * React discards these automatically when the action that produced them
   * settles, so there is no rollback path to write and no way for a failed save
   * to leave a phantom row behind. The success path in the effect below folds
   * the SERVER's row into `result` before that discard lands, which is what
   * stops the row blinking out between the action resolving and the refetch
   * arriving.
   */
  const [optimisticItems, applyOptimistic] = useOptimistic(
    result.items as Row[],
    (items: Row[], incoming: Row) => upsertRow(items, incoming),
  );

  const load = useCallback(
    (
      page: number,
      overrides?: {
        q?: string;
        status?: string;
        category?: string;
        locationId?: string;
      },
    ) => {
      const q = overrides?.q ?? query;
      const nextStatus = overrides?.status ?? status;
      const nextCategory = overrides?.category ?? category;
      const nextLocation = overrides?.locationId ?? locationFilter;

      startTransition(async () => {
        const response = await listAssetsAction({
          page,
          pageSize: result.pageSize,
          ...(q ? { q } : {}),
          ...(nextStatus ? { status: nextStatus } : {}),
          ...(nextCategory ? { category: nextCategory } : {}),
          ...(nextLocation ? { locationId: nextLocation } : {}),
        });

        if (response.ok) setResult(response.data);
        else toast({ title: response.error.message, variant: "danger" });
      });
    },
    [query, status, category, locationFilter, result.pageSize, toast],
  );

  // --- The form -------------------------------------------------------------

  const [formState, submitForm, isSubmitting] = useActionState(
    async (previous: ActionResult<AssetSummary> | undefined, payload: AssetFormPayload) => {
      // Inside the action, so this counts as an optimistic update React can
      // tie to the pending transition and discard on its own when it settles.
      applyOptimistic({
        id: payload.id ?? `optimistic-${crypto.randomUUID()}`,
        name: payload.name,
        category: payload.category as AssetSummary["category"],
        type: payload.type,
        status: payload.status as AssetSummary["status"],
        health: Number(payload.health),
        locationId: payload.locationId,
        locationName: locationOptions.find((o) => o.id === payload.locationId)?.name ?? null,
        clientId: null,
        pending: true,
      });

      return payload.id
        ? updateAssetAction(previous, payload)
        : createAssetAction(previous, payload);
    },
    undefined,
  );

  const handled = useRef<ActionResult<AssetSummary> | undefined>(undefined);

  useEffect(() => {
    if (!formState || formState === handled.current) return;
    handled.current = formState;

    if (formState.ok) {
      const saved = formState.data;

      // The action leaves `locationName` null rather than paying for a second
      // scoped read. We already hold the site list, so the name is resolved
      // here instead — no request, and the row never renders with a blank cell.
      setResult((current) =>
        upsertIntoPage(current, {
          ...saved,
          locationName: locationOptions.find((o) => o.id === saved.locationId)?.name ?? null,
        }),
      );

      setFormOpen(false);
      setEditing(null);
      toast({ title: t("saved"), variant: "success" });
      // Reconcile: the server decides ordering, totals and which page this row
      // actually belongs on.
      load(result.page);
      return;
    }

    if (formState.error.code !== "VALIDATION_FAILED") {
      toast({ title: formState.error.message, variant: "danger" });
    }
  }, [formState, load, locationOptions, result.page, t, toast]);

  const fieldErrors = formState && !formState.ok ? (formState.error.fields ?? {}) : {};

  function openCreate() {
    setEditing(null);
    handled.current = formState;
    setFormOpen(true);
  }

  function openEdit(asset: AssetSummary) {
    setEditing(asset);
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
     * Wrapped in `startTransition` because this dispatch comes from a manual
     * `onSubmit` rather than a `<form action={...}>` prop. Without it React does
     * not treat the call as an action, and two things break quietly:
     *
     *  - the `useOptimistic` update inside the action is REJECTED outright
     *    ("An optimistic state update occurred outside a transition or
     *    action"), so the row only appears once the server answers;
     *  - `isSubmitting` never flips, so the button shows no pending state.
     *
     * Neither failure throws, and both are invisible on a fast connection —
     * which is exactly why this needs to be written down rather than remembered.
     *
     * React's own `startTransition`, not the one from `useTransition()` above:
     * that one drives `isPending`, which disables the filters and spins the
     * Search button. A save is not a list reload and should not look like one.
     */
    startFormTransition(() => {
      submitForm({
        ...(editing ? { id: editing.id } : {}),
        name: text("name"),
        category: text("category"),
        type: text("type"),
        locationId: text("locationId"),
        status: text("status"),
        health: text("health"),
      });
    });
  }

  // --- Delete ---------------------------------------------------------------

  function confirmDelete() {
    if (!deleting) return;

    startDeleting(async () => {
      const response = await deleteAssetAction({ id: deleting.id });

      if (response.ok) {
        toast({ title: t("deleted"), variant: "success" });
        setDeleting(null);
        load(result.items.length === 1 && result.page > 1 ? result.page - 1 : result.page);
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
      key: "name",
      header: ta("name"),
      cell: (row) =>
        dim(
          row,
          <>
            <span className="block font-medium">{row.name}</span>
            <span className="block text-xs text-muted-foreground">{row.type}</span>
          </>,
        ),
    },
    {
      key: "category",
      header: ta("filterCategory"),
      cell: (row) => dim(row, tc(row.category)),
    },
    {
      key: "location",
      header: ta("location"),
      cell: (row) =>
        dim(
          row,
          row.locationName ?? (
            <span className="text-muted-foreground">{ta("locationUnknown")}</span>
          ),
        ),
    },
    {
      key: "health",
      header: ta("health"),
      cell: (row) => (
        <span className={cn("block", row.pending && "opacity-50")}>
          <HealthBar value={row.health} label={`${ta("health")} — ${row.name}`} />
        </span>
      ),
    },
    {
      key: "status",
      header: t("filterStatus"),
      cell: (row) => dim(row, <StatusBadge status={row.status} />),
    },
  ];

  /**
   * The gallery link, for every reader rather than only for managers.
   *
   * A customer looking at their own chiller should be able to see the
   * photograph of its nameplate; what they cannot do is add to or remove from
   * it, which is decided on the files page from `UPLOADERS`.
   *
   * A `Link`, not a Button: a Button here would be a motion.button that
   * navigates, losing middle-click, open-in-new-tab and the browser's own
   * affordances.
   */
  columns.push({
    key: "files",
    header: <span className="sr-only">{tf("title")}</span>,
    cell: (row) => (
      <Link
        href={localeHref(`/app/assets/${row.id}/files`, locale)}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${tf("title")} — ${row.name}`}
      >
        <Paperclip className="size-4" aria-hidden />
        <span className="sr-only md:not-sr-only md:inline">{tf("title")}</span>
      </Link>
    ),
  });

  if (canManage) {
    columns.push({
      key: "actions",
      header: <span className="sr-only">{t("actions")}</span>,
      className: "text-end",
      cell: (row) => (
        <RecordActions
          name={row.name}
          onEdit={() => openEdit(row)}
          onDelete={() => setDeleting(row)}
          // A row that does not exist on the server yet has nothing to edit.
          disabled={isPending || isDeleting || row.pending}
        />
      ),
    });
  }

  /**
   * Sites this asset may sit at.
   *
   * On edit, narrowed to the asset's own client partition — `updateAsset`
   * refuses a cross-client move, and offering an option the server will reject
   * is a worse experience than not offering it. The server check is still the
   * control; this only keeps the form honest about it.
   */
  const availableLocations = editing
    ? locationOptions.filter((option) => option.clientId === editing.clientId)
    : locationOptions;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeading
        title={ta("title")}
        subtitle={isClientSession ? ta("clientSubtitle") : ta("subtitle")}
        note={canManage || isClientSession ? undefined : t("readOnly")}
        action={
          canManage ? (
            <Button onClick={openCreate}>
              <Plus className="size-4" aria-hidden />
              {ta("new")}
            </Button>
          ) : undefined
        }
      />

      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          load(1);
        }}
        role="search"
      >
        <div className="min-w-48 flex-1">
          <Field label={t("search")}>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={ta("searchPlaceholder")}
              maxLength={64}
              type="search"
            />
          </Field>
        </div>

        <div className="w-44">
          <Field label={ta("filterCategory")}>
            <Select
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                load(1, { category: event.target.value });
              }}
            >
              <option value="">{ta("allCategories")}</option>
              {ASSET_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {tc(value)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {locationOptions.length > 0 && (
          <div className="w-52">
            <Field label={ta("location")}>
              <Select
                value={locationFilter}
                onChange={(event) => {
                  setLocationFilter(event.target.value);
                  load(1, { locationId: event.target.value });
                }}
              >
                <option value="">{ta("allLocations")}</option>
                {locationOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        <div className="w-44">
          <Field label={t("filterStatus")}>
            <Select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                load(1, { status: event.target.value });
              }}
            >
              <option value="">{t("allStatuses")}</option>
              {ASSET_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`status.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Button type="submit" variant="outline" isLoading={isPending}>
          {t("searchAction")}
        </Button>
      </form>

      <Table
        columns={columns}
        data={optimisticItems}
        emptyState={
          <EmptyState
            icon={Boxes}
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

      {/* --- Create / edit --- */}
      <Modal
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? ta("editTitle") : ta("newTitle")}
        size="lg"
        icon={<Boxes />}
        /**
         * Passed as `footer` rather than trailing the form inside `children`.
         * The modal scrolls its body and pins its footer, so Save stays on
         * screen instead of being something you scroll the form to reach. The
         * submit button finds the form by `form="asset-form"`, which works
         * across the DOM — the button is not inside the <form>.
         */
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={isSubmitting}>
              {t("cancel")}
            </Button>
            <Button type="submit" form="asset-form" isLoading={isSubmitting}>
              {editing ? t("save") : t("create")}
            </Button>
          </>
        }
      >
        {/*
          Two columns against the DIALOG's width (`@lg` = 32rem container), not
          the viewport's — the modal body is the `@container`. `items-start`
          keeps a field with a hint from dragging its neighbour's control down.
        */}
        <form
          id="asset-form"
          className="grid items-start gap-x-5 gap-y-4 @lg:grid-cols-2"
          onSubmit={handleSubmit}
        >
          <Field label={ta("name")} error={fieldErrors.name} required className="@lg:col-span-2">
            <Input name="name" defaultValue={editing?.name ?? ""} maxLength={160} required />
          </Field>

          <Field label={ta("filterCategory")} error={fieldErrors.category} required>
            <Select name="category" defaultValue={editing?.category ?? "HVAC"}>
              {ASSET_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {tc(value)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={ta("type")} hint={ta("typeHint")} error={fieldErrors.type} required>
            <Input name="type" defaultValue={editing?.type ?? ""} maxLength={80} required />
          </Field>

          <Field
            label={ta("location")}
            hint={editing ? ta("locationHint") : undefined}
            error={fieldErrors.locationId}
            required
            className="@lg:col-span-2"
          >
            <Select name="locationId" defaultValue={editing?.locationId ?? ""} required>
              {!editing && <option value="">—</option>}
              {availableLocations.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t("filterStatus")} error={fieldErrors.status}>
            <Select name="status" defaultValue={editing?.status ?? "ACTIVE"}>
              {ASSET_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`status.${value}`)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={ta("health")} hint={ta("healthHint")} error={fieldErrors.health}>
            <Input
              name="health"
              type="number"
              min={0}
              max={100}
              step={5}
              defaultValue={editing?.health ?? 100}
              inputMode="numeric"
            />
          </Field>
        </form>
      </Modal>

      {/* --- Delete confirmation --- */}
      <Modal
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("deleteTitle", { name: deleting?.name ?? "" })}
        description={t("deleteBody")}
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
// Both helpers keep the list sorted by name, which is the order the server
// returns (`sort: { name: 1 }`). Inserting in position rather than prepending
// means a saved row does not visibly jump when the refetch lands.

function upsertRow(items: Row[], incoming: Row): Row[] {
  const index = items.findIndex((item) => item.id === incoming.id);
  if (index !== -1) {
    const next = [...items];
    next[index] = { ...next[index], ...incoming };
    return next;
  }

  const at = items.findIndex((item) => item.name.localeCompare(incoming.name) > 0);
  if (at === -1) return [...items, incoming];
  return [...items.slice(0, at), incoming, ...items.slice(at)];
}

function upsertIntoPage(page: Page<AssetSummary>, saved: AssetSummary): Page<AssetSummary> {
  const exists = page.items.some((item) => item.id === saved.id);
  const items = upsertRow(page.items as Row[], saved) as AssetSummary[];
  return exists ? { ...page, items } : { ...page, items, total: page.total + 1 };
}
