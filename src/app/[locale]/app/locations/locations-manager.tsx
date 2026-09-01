"use client";

import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { MapPin, Plus } from "lucide-react";

import type { LocationSummary } from "@/lib/master-data/dto";
import {
  createLocationAction,
  deleteLocationAction,
  listLocationsAction,
  updateLocationAction,
} from "@/lib/master-data/actions";
import type { ActionResult } from "@/lib/security/action";
import type { Page } from "@/lib/db";
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
import { RecordActions } from "../_components/record-actions";
import { StatusBadge } from "../_components/status-badge";

export interface ClientOption {
  id: string;
  name: string;
}

/**
 * The location list.
 *
 * This screen renders for a CLIENT session too, and nothing in it branches on
 * that. The list is already narrowed before it arrives: `Location` carries a
 * `clientId`, so the data-access layer appends the session's own client id to
 * every filter — after anything passed in, so it cannot be displaced. What a
 * client sees here is what the database returned, not what a component chose to
 * draw.
 *
 * `clientOptions` is empty for a client session, which is why the client column
 * and the client filter simply do not appear for one.
 */
export function LocationsManager({
  initialPage,
  canManage,
  clientOptions,
  isClientSession,
}: {
  initialPage: Page<LocationSummary>;
  canManage: boolean;
  clientOptions: ClientOption[];
  isClientSession: boolean;
}) {
  const t = useTranslations("masterData");
  const tl = useTranslations("masterData.locations");
  const { toast } = useToast();

  const [result, setResult] = useState(initialPage);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [isPending, startTransition] = useTransition();

  const [editing, setEditing] = useState<LocationSummary | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<LocationSummary | null>(null);
  const [isDeleting, startDeleting] = useTransition();

  const load = useCallback(
    (page: number, overrides?: { q?: string; status?: string; clientId?: string }) => {
      const q = overrides?.q ?? query;
      const nextStatus = overrides?.status ?? status;
      const nextClient = overrides?.clientId ?? clientFilter;

      startTransition(async () => {
        const response = await listLocationsAction({
          page,
          pageSize: result.pageSize,
          ...(q ? { q } : {}),
          ...(nextStatus ? { status: nextStatus } : {}),
          ...(nextClient ? { clientId: nextClient } : {}),
        });

        if (response.ok) setResult(response.data);
        else toast({ title: response.error.message, variant: "danger" });
      });
    },
    [query, status, clientFilter, result.pageSize, toast],
  );

  // --- The form -------------------------------------------------------------

  const [formState, submitForm, isSubmitting] = useActionState(
    async (previous: ActionResult<LocationSummary> | undefined, payload: unknown) => {
      const hasId = typeof (payload as { id?: unknown }).id === "string";
      return hasId
        ? updateLocationAction(previous, payload)
        : createLocationAction(previous, payload);
    },
    undefined,
  );

  const handled = useRef<ActionResult<LocationSummary> | undefined>(undefined);

  useEffect(() => {
    if (!formState || formState === handled.current) return;
    handled.current = formState;

    if (formState.ok) {
      setFormOpen(false);
      setEditing(null);
      toast({ title: t("saved"), variant: "success" });
      load(result.page);
      return;
    }

    if (formState.error.code !== "VALIDATION_FAILED") {
      toast({ title: formState.error.message, variant: "danger" });
    }
  }, [formState, load, result.page, t, toast]);

  const fieldErrors = formState && !formState.ok ? (formState.error.fields ?? {}) : {};

  function openCreate() {
    setEditing(null);
    handled.current = formState;
    setFormOpen(true);
  }

  function openEdit(location: LocationSummary) {
    setEditing(location);
    handled.current = formState;
    setFormOpen(true);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => {
      const value = form.get(key);
      return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
    };

    // Nested, so it is built here rather than posted as flat FormData — a
    // dotted `address.city` field name is exactly what the DAL's sanitizer
    // rejects, and rightly.
    const address = {
      line1: text("line1") ?? "",
      line2: text("line2"),
      district: text("district"),
      city: text("city") ?? "",
      region: text("region"),
      postalCode: text("postalCode"),
      country: text("country") ?? "SA",
    };

    submitForm({
      ...(editing
        ? { id: editing.id }
        : // Only sent on create. A location's client is fixed afterwards: the
          // update schema has no such field, and the DAL strips it regardless.
          { clientId: text("clientId") }),
      name: text("name") ?? "",
      building: text("building"),
      status: form.get("status"),
      address,
    });
  }

  // --- Delete ---------------------------------------------------------------

  function confirmDelete() {
    if (!deleting) return;

    startDeleting(async () => {
      const response = await deleteLocationAction({ id: deleting.id });

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

  const columns: TableColumn<LocationSummary>[] = [
    {
      key: "name",
      header: tl("name"),
      cell: (row) => (
        <div>
          <div className="font-medium">{row.name}</div>
          {row.building && <div className="text-xs text-muted-foreground">{row.building}</div>}
        </div>
      ),
    },
    {
      key: "address",
      header: tl("address"),
      cell: (row) => (
        <div className="text-sm">
          <div>{row.address.line1}</div>
          <div className="text-xs text-muted-foreground">
            {[row.address.district, row.address.city].filter(Boolean).join(", ")}
          </div>
        </div>
      ),
    },
  ];

  // A client session has exactly one client — its own — so a column repeating
  // that on every row would be noise.
  if (!isClientSession) {
    columns.push({
      key: "client",
      header: tl("client"),
      cell: (row) =>
        row.clientName ? (
          <span>{row.clientName}</span>
        ) : (
          <span className="text-muted-foreground">{tl("clientNone")}</span>
        ),
    });
  }

  columns.push({
    key: "status",
    header: t("filterStatus"),
    cell: (row) => <StatusBadge status={row.status} />,
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
          disabled={isPending || isDeleting}
        />
      ),
    });
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeading
        title={tl("title")}
        subtitle={isClientSession ? tl("clientSubtitle") : tl("subtitle")}
        note={canManage || isClientSession ? undefined : t("readOnly")}
        action={
          canManage ? (
            <Button onClick={openCreate}>
              <Plus className="size-4" aria-hidden />
              {tl("new")}
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
              placeholder={tl("name")}
              maxLength={64}
              type="search"
            />
          </Field>
        </div>

        {!isClientSession && clientOptions.length > 0 && (
          <div className="w-52">
            <Field label={tl("client")}>
              <Select
                value={clientFilter}
                onChange={(event) => {
                  setClientFilter(event.target.value);
                  load(1, { clientId: event.target.value });
                }}
              >
                <option value="">{t("allClients")}</option>
                {clientOptions.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
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
              <option value="ACTIVE">{t("status.ACTIVE")}</option>
              <option value="INACTIVE">{t("status.INACTIVE")}</option>
            </Select>
          </Field>
        </div>

        <Button type="submit" variant="outline" isLoading={isPending}>
          {t("searchAction")}
        </Button>
      </form>

      <Table
        columns={columns}
        data={result.items}
        emptyState={
          <EmptyState
            icon={MapPin}
            title={tl("empty")}
            description={isClientSession ? tl("clientEmptyBody") : tl("emptyBody")}
            action={
              canManage ? (
                <Button onClick={openCreate}>
                  <Plus className="size-4" aria-hidden />
                  {tl("new")}
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
        title={editing ? tl("editTitle") : tl("newTitle")}
      >
        <form id="location-form" className="grid gap-4" onSubmit={handleSubmit}>
          <Field label={tl("name")} error={fieldErrors.name} required>
            <Input name="name" defaultValue={editing?.name ?? ""} maxLength={160} required />
          </Field>

          <Field label={tl("building")} error={fieldErrors.building}>
            <Input name="building" defaultValue={editing?.building ?? ""} maxLength={120} />
          </Field>

          {/* Create only. A site cannot be moved between clients — see the
              model. On edit the current owner is shown as static text. */}
          {editing ? (
            <Field label={tl("client")} hint={tl("clientHint")}>
              <Input value={editing.clientName ?? tl("clientNone")} disabled readOnly />
            </Field>
          ) : (
            <Field label={tl("client")} hint={tl("clientHint")} error={fieldErrors.clientId}>
              <Select name="clientId" defaultValue="">
                <option value="">{tl("clientNone")}</option>
                {clientOptions.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field label={t("filterStatus")} error={fieldErrors.status}>
            <Select name="status" defaultValue={editing?.status ?? "ACTIVE"}>
              <option value="ACTIVE">{t("status.ACTIVE")}</option>
              <option value="INACTIVE">{t("status.INACTIVE")}</option>
            </Select>
          </Field>

          <fieldset className="grid gap-4 border-t border-border pt-4">
            <legend className="mb-1 text-sm font-medium text-foreground">{tl("address")}</legend>

            <Field label={tl("line1")} error={fieldErrors["address.line1"]} required>
              <Input
                name="line1"
                defaultValue={editing?.address.line1 ?? ""}
                maxLength={160}
                required
              />
            </Field>
            <Field label={tl("line2")} error={fieldErrors["address.line2"]}>
              <Input name="line2" defaultValue={editing?.address.line2 ?? ""} maxLength={160} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={tl("district")} error={fieldErrors["address.district"]}>
                <Input
                  name="district"
                  defaultValue={editing?.address.district ?? ""}
                  maxLength={120}
                />
              </Field>
              <Field label={tl("city")} error={fieldErrors["address.city"]} required>
                <Input
                  name="city"
                  defaultValue={editing?.address.city ?? ""}
                  maxLength={120}
                  required
                />
              </Field>
              <Field label={tl("region")} error={fieldErrors["address.region"]}>
                <Input name="region" defaultValue={editing?.address.region ?? ""} maxLength={120} />
              </Field>
              <Field label={tl("postalCode")} error={fieldErrors["address.postalCode"]}>
                <Input
                  name="postalCode"
                  defaultValue={editing?.address.postalCode ?? ""}
                  maxLength={16}
                  inputMode="numeric"
                />
              </Field>
            </div>

            <Field label={tl("country")} error={fieldErrors["address.country"]} required>
              <Input
                name="country"
                defaultValue={editing?.address.country ?? "SA"}
                maxLength={2}
                minLength={2}
                required
                className="uppercase"
              />
            </Field>
          </fieldset>
        </form>

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-border pt-4">
          <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={isSubmitting}>
            {t("cancel")}
          </Button>
          <Button type="submit" form="location-form" isLoading={isSubmitting}>
            {editing ? t("save") : t("create")}
          </Button>
        </div>
      </Modal>

      {/* --- Delete confirmation --- */}
      <Modal
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("deleteTitle", { name: deleting?.name ?? "" })}
        description={t("deleteBody")}
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
