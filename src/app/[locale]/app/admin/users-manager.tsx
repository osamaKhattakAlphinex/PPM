"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Plus, ShieldCheck, ShieldOff, UserPlus } from "lucide-react";

import { registerAction, type RegisteredUser } from "@/lib/auth/actions";
import { setUserStatusAction, listUsersAction } from "@/lib/admin/actions";
import type { ClientOption } from "@/lib/admin/queries";
import type { UserSummary } from "@/lib/admin/dto";
import type { ActionResult } from "@/lib/security/action";
import type { Page } from "@/lib/db";
import type { Role } from "@/lib/auth/roles";
import { USER_STATUS_OPTIONS } from "@/lib/domain/users";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { PasswordInput } from "@/components/ui/password-input";
import { Select } from "@/components/ui/select";
import { Table, type TableColumn } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { Pagination } from "../_components/pagination";
import { PageHeading } from "../_components/page-heading";

/**
 * The account directory.
 *
 * The two halves of a user's life that a person has to perform: creating the
 * account, and deciding whether it may sign in. Everything else about a user —
 * what their role lets them do, which tenant they belong to — is decided
 * elsewhere and is not editable here on purpose. A screen that could change a
 * role would be a screen that could promote somebody, and that authority is
 * `ASSIGNABLE_ROLES`, checked at creation, not a dropdown on a list.
 *
 * Nothing on this screen is a security boundary. `assignableRoles` decides
 * which options are drawn; the actions behind them re-check the role, the
 * tenant scope and the transition on the server, so a forged option produces a
 * FORBIDDEN envelope rather than a write.
 */

const STATUS_TONE: Record<
  UserSummary["status"],
  "success" | "warning" | "danger"
> = {
  ACTIVE: "success",
  INVITED: "warning",
  SUSPENDED: "danger",
};

export function UsersManager({
  initialPage,
  assignableRoles,
  clientOptions,
  currentUserId,
}: {
  initialPage: Page<UserSummary>;
  /** What this administrator may create. An FM_MANAGER is not offered ADMIN. */
  assignableRoles: readonly Role[];
  clientOptions: ClientOption[];
  /** So the screen can decline to draw controls that act on the viewer. */
  currentUserId: string;
}) {
  const t = useTranslations("admin");
  // Role labels live in their own namespace, shared with the user menu and the
  // session summary. Restating them under `admin` would be a second place for
  // "FM manager" to be spelled differently.
  const tr = useTranslations("roles");
  const format = useFormatter();
  const { toast } = useToast();

  const [result, setResult] = useState(initialPage);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  const [formRole, setFormRole] = useState<string>(assignableRoles[0] ?? "");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startStatusChange] = useTransition();

  const load = useCallback(
    (
      page: number,
      overrides?: { search?: string; role?: string; status?: string },
    ) => {
      const nextSearch = overrides?.search ?? search;
      const nextRole = overrides?.role ?? role;
      const nextStatus = overrides?.status ?? status;

      startTransition(async () => {
        const response = await listUsersAction({
          page,
          pageSize: result.pageSize,
          ...(nextSearch ? { search: nextSearch } : {}),
          ...(nextRole ? { role: nextRole } : {}),
          ...(nextStatus ? { status: nextStatus } : {}),
        });

        if (response.ok) setResult(response.data);
        else toast({ title: response.error.message, variant: "danger" });
      });
    },
    [search, role, status, result.pageSize, toast],
  );

  // --- Create ---------------------------------------------------------------

  const [formState, submitForm, isSubmitting] = useActionState(
    registerAction,
    undefined,
  );
  const handled = useRef<ActionResult<RegisteredUser> | undefined>(undefined);

  useEffect(() => {
    if (!formState || formState === handled.current) return;
    handled.current = formState;

    if (formState.ok) {
      setFormOpen(false);
      toast({ title: t("created"), variant: "success" });
      load(1);
      return;
    }

    if (formState.error.code !== "VALIDATION_FAILED") {
      toast({ title: formState.error.message, variant: "danger" });
    }
  }, [formState, load, t, toast]);

  const fieldErrors =
    formState && !formState.ok ? (formState.error.fields ?? {}) : {};

  function openCreate() {
    handled.current = formState;
    setFormRole(assignableRoles[0] ?? "");
    setFormOpen(true);
  }

  // --- Activate / suspend ---------------------------------------------------

  function changeStatus(user: UserSummary, next: "ACTIVE" | "SUSPENDED") {
    setBusyId(user.id);
    startStatusChange(async () => {
      const response = await setUserStatusAction({ id: user.id, status: next });
      setBusyId(null);

      if (!response.ok) {
        toast({ title: response.error.message, variant: "danger" });
        return;
      }

      toast({
        title: next === "ACTIVE" ? t("activated") : t("suspended"),
        variant: "success",
      });
      load(result.page);
    });
  }

  const columns: TableColumn<UserSummary>[] = [
    {
      key: "name",
      header: t("columns.name"),
      cell: (user) => (
        <div className="grid">
          <span className="font-medium text-foreground">{user.name}</span>
          <span className="text-xs text-muted-foreground" dir="ltr">
            {user.email}
          </span>
        </div>
      ),
    },
    {
      key: "role",
      header: t("columns.role"),
      cell: (user) => <Badge variant="neutral">{tr(user.role)}</Badge>,
    },
    {
      key: "client",
      header: t("columns.client"),
      cell: (user) => (
        <span className="text-muted-foreground">{user.clientName ?? "—"}</span>
      ),
    },
    {
      key: "status",
      header: t("columns.status"),
      cell: (user) => (
        <Badge variant={STATUS_TONE[user.status]} dot>
          {t(`statuses.${user.status}`)}
        </Badge>
      ),
    },
    {
      key: "created",
      header: t("columns.created"),
      cell: (user) => (
        <span className="text-muted-foreground">
          {format.dateTime(new Date(user.createdAt), { dateStyle: "medium" })}
        </span>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      className: "text-end",
      cell: (user) => {
        /**
         * The viewer's own row carries no controls. The action refuses a
         * self-change regardless — this only spares them finding that out by
         * pressing a button that was never going to work.
         */
        if (user.id === currentUserId) {
          return (
            <span className="text-xs text-muted-foreground">{t("you")}</span>
          );
        }

        const busy = busyId === user.id;

        return user.status === "SUSPENDED" || user.status === "INVITED" ? (
          <Button
            size="sm"
            variant="outline"
            isLoading={busy}
            onClick={() => changeStatus(user, "ACTIVE")}
          >
            <ShieldCheck className="size-4" aria-hidden />
            {t("activate")}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            isLoading={busy}
            onClick={() => changeStatus(user, "SUSPENDED")}
          >
            <ShieldOff className="size-4" aria-hidden />
            {t("suspend")}
          </Button>
        );
      },
    },
  ];

  return (
    <div className="grid gap-6">
      <PageHeading
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <Button onClick={openCreate}>
            <Plus className="size-4" aria-hidden />
            {t("new")}
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("filters.search")} className="min-w-56 flex-1">
          <Input
            value={search}
            placeholder={t("filters.searchPlaceholder")}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") load(1);
            }}
          />
        </Field>

        <Field label={t("filters.role")}>
          <Select
            value={role}
            onChange={(event) => {
              setRole(event.target.value);
              load(1, { role: event.target.value });
            }}
          >
            <option value="">{t("filters.allRoles")}</option>
            {(
              [
                "ADMIN",
                "FM_MANAGER",
                "SUPERVISOR",
                "TECHNICIAN",
                "CLIENT",
              ] as const
            ).map((value) => (
              <option key={value} value={value}>
                {tr(value)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t("filters.status")}>
          <Select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              load(1, { status: event.target.value });
            }}
          >
            <option value="">{t("filters.allStatuses")}</option>
            {USER_STATUS_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {t(`statuses.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Table
        columns={columns}
        data={result.items}
        isLoading={isPending}
        emptyState={
          <EmptyState
            icon={UserPlus}
            title={t("empty.title")}
            description={t("empty.description")}
            action={<Button onClick={openCreate}>{t("new")}</Button>}
          />
        }
      />

      <Pagination
        page={result.page}
        totalPages={result.totalPages}
        total={result.total}
        isPending={isPending}
        onChange={(page) => load(page)}
      />

      <Modal
        open={formOpen}
        onOpenChange={setFormOpen}
        title={t("form.title")}
        size="md"
        icon={<UserPlus className="size-4" aria-hidden />}
      >
        <form action={submitForm} className="grid gap-5" noValidate>
          <Field label={t("form.name")} error={fieldErrors.name} required>
            <Input name="name" required autoFocus />
          </Field>

          <Field label={t("form.email")} error={fieldErrors.email} required>
            <Input
              name="email"
              type="email"
              inputMode="email"
              required
              dir="ltr"
            />
          </Field>

          {/*
            A password is set here because there is no email delivery in the
            product yet, so there is nowhere to send an invitation link. The
            account is created INVITED and cannot sign in until it is activated
            on this screen, which is the second pair of eyes that a mailed
            link would otherwise have been.
          */}
          <Field
            label={t("form.password")}
            error={fieldErrors.password}
            hint={t("form.passwordHint")}
            required
          >
            <PasswordInput
              name="password"
              autoComplete="new-password"
              required
              dir="ltr"
            />
          </Field>

          <Field label={t("form.role")} error={fieldErrors.role} required>
            <Select
              name="role"
              value={formRole}
              onChange={(event) => setFormRole(event.target.value)}
              required
            >
              {assignableRoles.map((value) => (
                <option key={value} value={value}>
                  {tr(value)}
                </option>
              ))}
            </Select>
          </Field>

          {/*
            Only a CLIENT user carries a client, and the schema refuses the
            combination either way round — a staff user WITH one is rejected
            just as a client user without one is. Unmounting the field rather
            than hiding it means the browser does not submit a stale value when
            the role is switched back.
          */}
          {formRole === "CLIENT" ? (
            <Field
              label={t("form.client")}
              error={fieldErrors.clientId}
              required
            >
              <Select name="clientId" required defaultValue="">
                <option value="" disabled>
                  {t("form.clientPlaceholder")}
                </option>
                {clientOptions.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setFormOpen(false)}
            >
              {t("form.cancel")}
            </Button>
            <Button type="submit" isLoading={isSubmitting}>
              {t("form.submit")}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
