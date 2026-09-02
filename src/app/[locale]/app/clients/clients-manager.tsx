"use client";

import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Building2, Plus, Trash2 } from "lucide-react";

import type { ClientSummary } from "@/lib/master-data/dto";
import {
  createClientAction,
  deleteClientAction,
  listClientsAction,
  updateClientAction,
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

/**
 * The client list, and the form that writes to it.
 *
 * The first page is rendered on the server and handed in as `initialPage`, so
 * the screen is complete on first paint. Every page change and filter after
 * that goes through `listClientsAction` — the SAME implementation and the same
 * role list as the server read, so paginating in the browser cannot reach a row
 * the first render was not allowed to show.
 *
 * `canManage` only decides what is drawn. Each action re-checks the caller's
 * role server-side, so a session that forges the request gets a FORBIDDEN
 * envelope rather than a write.
 */
export function ClientsManager({
  initialPage,
  canManage,
}: {
  initialPage: Page<ClientSummary>;
  canManage: boolean;
}) {
  const t = useTranslations("masterData");
  const tc = useTranslations("masterData.clients");
  const { toast } = useToast();

  const [result, setResult] = useState(initialPage);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();

  const [editing, setEditing] = useState<ClientSummary | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<ClientSummary | null>(null);
  const [isDeleting, startDeleting] = useTransition();

  /** Re-read the current page after a write, so the table reflects the database. */
  const load = useCallback(
    (page: number, overrides?: { q?: string; status?: string }) => {
      const q = overrides?.q ?? query;
      const nextStatus = overrides?.status ?? status;

      startTransition(async () => {
        const response = await listClientsAction({
          page,
          pageSize: result.pageSize,
          ...(q ? { q } : {}),
          ...(nextStatus ? { status: nextStatus } : {}),
        });

        if (response.ok) setResult(response.data);
        else toast({ title: response.error.message, variant: "danger" });
      });
    },
    [query, status, result.pageSize, toast],
  );

  // --- The form -------------------------------------------------------------

  const [formState, submitForm, isSubmitting] = useActionState(
    async (previous: ActionResult<ClientSummary> | undefined, payload: unknown) => {
      // One form, two actions. Which one is decided by whether the payload
      // carries an id, not by a flag the form could get out of sync with.
      const hasId = typeof (payload as { id?: unknown }).id === "string";
      return hasId ? updateClientAction(previous, payload) : createClientAction(previous, payload);
    },
    undefined,
  );

  // Tracks the last state we reacted to, so re-renders do not re-fire the toast.
  const handled = useRef<ActionResult<ClientSummary> | undefined>(undefined);

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

    // A field-level failure stays in the form, where the messages are shown
    // next to the inputs. Anything else is a toast, because there is no field
    // to attach it to.
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

  function openEdit(client: ClientSummary) {
    setEditing(client);
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

    // The payload is assembled here rather than posted as raw FormData because
    // `contactInfo` is nested, and a flat `contactInfo.email` field name would
    // be a dotted key — which the DAL's sanitizer rejects outright, correctly.
    const contactInfo = {
      name: text("contactName"),
      email: text("contactEmail"),
      phone: text("contactPhone"),
    };

    submitForm({
      ...(editing ? { id: editing.id } : { code: text("code") ?? "" }),
      name: text("name") ?? "",
      status: form.get("status"),
      contactInfo,
    });
  }

  // --- Delete ---------------------------------------------------------------

  function confirmDelete() {
    if (!deleting) return;

    startDeleting(async () => {
      const response = await deleteClientAction({ id: deleting.id });

      if (response.ok) {
        toast({ title: t("deleted"), variant: "success" });
        setDeleting(null);
        // Step back a page when the last row on it has just gone.
        load(result.items.length === 1 && result.page > 1 ? result.page - 1 : result.page);
      } else {
        toast({ title: response.error.message, variant: "danger" });
      }
    });
  }

  // --- Table ----------------------------------------------------------------

  const columns: TableColumn<ClientSummary>[] = [
    {
      key: "name",
      header: tc("name"),
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: "code",
      header: tc("code"),
      cell: (row) => <code className="text-xs text-muted-foreground">{row.code}</code>,
    },
    {
      key: "contact",
      header: tc("contact"),
      cell: (row) => (
        <div className="text-sm">
          <div>{row.contactName ?? tc("noContact")}</div>
          {row.contactEmail && (
            <div className="text-xs text-muted-foreground">{row.contactEmail}</div>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: t("filterStatus"),
      cell: (row) => <StatusBadge status={row.status} />,
    },
  ];

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
        title={tc("title")}
        subtitle={tc("subtitle")}
        note={canManage ? undefined : t("readOnly")}
        action={
          canManage ? (
            <Button onClick={openCreate}>
              <Plus className="size-4" aria-hidden />
              {tc("new")}
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
              placeholder={tc("name")}
              maxLength={64}
              type="search"
            />
          </Field>
        </div>
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
              <option value="SUSPENDED">{t("status.SUSPENDED")}</option>
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
            icon={Building2}
            title={tc("empty")}
            description={tc("emptyBody")}
            action={
              canManage ? (
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

      {/* --- Create / edit --- */}
      <Modal
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? tc("editTitle") : tc("newTitle")}
        size="md"
        icon={<Building2 />}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={isSubmitting}>
              {t("cancel")}
            </Button>
            <Button type="submit" form="client-form" isLoading={isSubmitting}>
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
          id="client-form"
          className="grid items-start gap-x-5 gap-y-4 @lg:grid-cols-2"
          onSubmit={handleSubmit}
        >
          <Field label={tc("name")} error={fieldErrors.name} required className="@lg:col-span-2">
            <Input name="name" defaultValue={editing?.name ?? ""} maxLength={160} required />
          </Field>

          {/* Only on create: the code is the client's stable handle and the
              update schema has no field for it. */}
          {!editing && (
            <Field label={tc("code")} hint={tc("codeHint")} error={fieldErrors.code} required>
              <Input name="code" maxLength={32} required />
            </Field>
          )}

          <Field label={t("filterStatus")} error={fieldErrors.status}>
            <Select name="status" defaultValue={editing?.status ?? "ACTIVE"}>
              <option value="ACTIVE">{t("status.ACTIVE")}</option>
              <option value="SUSPENDED">{t("status.SUSPENDED")}</option>
            </Select>
          </Field>

          <fieldset className="grid items-start gap-x-5 gap-y-4 border-t border-border pt-4 @lg:col-span-2 @lg:grid-cols-2">
            <legend className="sr-only">{tc("contact")}</legend>
            <Field label={tc("contactName")} error={fieldErrors["contactInfo.name"]}>
              <Input name="contactName" defaultValue={editing?.contactName ?? ""} maxLength={120} />
            </Field>
            <Field label={tc("contactEmail")} error={fieldErrors["contactInfo.email"]}>
              <Input
                name="contactEmail"
                type="email"
                defaultValue={editing?.contactEmail ?? ""}
                maxLength={254}
              />
            </Field>
            <Field label={tc("contactPhone")} error={fieldErrors["contactInfo.phone"]}>
              <Input
                name="contactPhone"
                type="tel"
                defaultValue={editing?.contactPhone ?? ""}
                maxLength={32}
              />
            </Field>
          </fieldset>
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
