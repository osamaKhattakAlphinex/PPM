"use client";

import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useFormatter, useTranslations } from "next-intl";
import { Mail, Plus, Trash2, Users, X } from "lucide-react";

import type { TechnicianAccountOption, TechnicianSummary } from "@/lib/technicians/dto";
import {
  createTechnicianAction,
  deleteTechnicianAction,
  listTechniciansAction,
  updateTechnicianAction,
} from "@/lib/technicians/actions";
import type { ActionResult } from "@/lib/security/action";
import type { Page } from "@/lib/db";
import { TECHNICIAN_STATUSES, TRADES } from "@/lib/domain/technicians";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { Pagination } from "../_components/pagination";
import { PageHeading } from "../_components/page-heading";
import { RecordActions } from "../_components/record-actions";
import { StatusBadge } from "../_components/status-badge";
import { SkillsInput } from "./skills-input";
import { Avatar, SkillChip, TradeBadge, TechnicianCard } from "./technician-card";

/**
 * The technician directory.
 *
 * A card grid rather than the table the other master-data screens use, and the
 * reason is what a supervisor is actually doing here. A location list is
 * scanned by name down one column; a technician list is scanned by *capability*
 * — trade, skills, whether they are available today — which is four attributes
 * that read as a shape, not as a row. Cards also survive a phone better, which
 * matters because this is the screen a supervisor opens standing in a plant
 * room.
 *
 * Nothing here is a security boundary. `canManage` decides whether the write
 * affordances are drawn; every action behind them re-checks the role and the
 * tenant scope on the server, so a reader who reconstructs the request gets a
 * FORBIDDEN envelope rather than a write.
 */

/** Stagger the first paint, capped — DESIGN.md §3. */
const STAGGER_LIMIT = 10;

const gridVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.03, delayChildren: 0.02 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.18, ease: "easeOut" as const },
  },
};

export function TechniciansManager({
  initialPage,
  canManage,
  accountOptions,
}: {
  initialPage: Page<TechnicianSummary>;
  canManage: boolean;
  /** Empty for a session that may not manage — it never opens the form. */
  accountOptions: TechnicianAccountOption[];
}) {
  const t = useTranslations("masterData");
  const tt = useTranslations("technicians");
  const format = useFormatter();
  const router = useRouter();
  const { toast } = useToast();

  const [result, setResult] = useState(initialPage);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [trade, setTrade] = useState("");
  const [skill, setSkill] = useState("");
  const [isPending, startTransition] = useTransition();

  const [editing, setEditing] = useState<TechnicianSummary | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [skills, setSkills] = useState<string[]>([]);
  const [viewing, setViewing] = useState<TechnicianSummary | null>(null);
  const [deleting, setDeleting] = useState<TechnicianSummary | null>(null);
  const [isDeleting, startDeleting] = useTransition();

  const load = useCallback(
    (
      page: number,
      overrides?: {
        q?: string;
        status?: string;
        trade?: string;
        skill?: string;
      },
    ) => {
      const nextQuery = overrides?.q ?? query;
      const nextStatus = overrides?.status ?? status;
      const nextTrade = overrides?.trade ?? trade;
      const nextSkill = overrides?.skill ?? skill;

      startTransition(async () => {
        const response = await listTechniciansAction({
          page,
          pageSize: result.pageSize,
          ...(nextQuery ? { q: nextQuery } : {}),
          ...(nextStatus ? { status: nextStatus } : {}),
          ...(nextTrade ? { trade: nextTrade } : {}),
          ...(nextSkill ? { skill: nextSkill } : {}),
        });

        if (response.ok) setResult(response.data);
        else toast({ title: response.error.message, variant: "danger" });
      });
    },
    [query, status, trade, skill, result.pageSize, toast],
  );

  function filterBySkill(next: string) {
    setSkill(next);
    load(1, { skill: next });
  }

  // --- The form -------------------------------------------------------------

  const [formState, submitForm, isSubmitting] = useActionState(
    async (previous: ActionResult<TechnicianSummary> | undefined, payload: unknown) => {
      const hasId = typeof (payload as { id?: unknown }).id === "string";
      return hasId
        ? updateTechnicianAction(previous, payload)
        : createTechnicianAction(previous, payload);
    },
    undefined,
  );

  const handled = useRef<ActionResult<TechnicianSummary> | undefined>(undefined);

  useEffect(() => {
    if (!formState || formState === handled.current) return;
    handled.current = formState;

    if (formState.ok) {
      setFormOpen(false);
      setEditing(null);
      setViewing(null);
      toast({ title: t("saved"), variant: "success" });
      load(result.page);
      /**
       * The list refreshes itself from the action's response, but the account
       * picker does not: `accountOptions` is an RSC prop, so a link made here
       * would leave the next form offering an account that is now taken. The
       * server would still refuse it — the check in the action and the partial
       * unique index both stand — but the user would meet an error instead of a
       * disabled option, which is a worse way to learn the same thing.
       */
      router.refresh();
      return;
    }

    if (formState.error.code !== "VALIDATION_FAILED") {
      toast({ title: formState.error.message, variant: "danger" });
    }
  }, [formState, load, result.page, router, t, toast]);

  const fieldErrors = formState && !formState.ok ? (formState.error.fields ?? {}) : {};

  function openCreate() {
    setEditing(null);
    setSkills([]);
    handled.current = formState;
    setFormOpen(true);
  }

  function openEdit(technician: TechnicianSummary) {
    setEditing(technician);
    setSkills(technician.skills);
    handled.current = formState;
    setViewing(null);
    setFormOpen(true);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => {
      const value = form.get(key);
      return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
    };

    submitForm({
      ...(editing ? { id: editing.id } : {}),
      name: text("name") ?? "",
      trade: form.get("trade"),
      status: form.get("status"),
      skills,
      // "" from the picker means "no account". Sent as null rather than
      // omitted, so an edit that clears the link actually unlinks — an absent
      // key would leave it untouched. See the three-state note in actions.ts.
      userId: text("userId"),
    });
  }

  // --- Delete ---------------------------------------------------------------

  function confirmDelete() {
    if (!deleting) return;

    startDeleting(async () => {
      const response = await deleteTechnicianAction({ id: deleting.id });

      if (response.ok) {
        toast({ title: t("deleted"), variant: "success" });
        setDeleting(null);
        setViewing(null);
        load(result.items.length === 1 && result.page > 1 ? result.page - 1 : result.page);
        // A deleted technician releases their account back to the picker.
        router.refresh();
      } else {
        toast({ title: response.error.message, variant: "danger" });
      }
    });
  }

  // --- Account picker -------------------------------------------------------

  /**
   * An account already held by ANOTHER technician is shown disabled rather than
   * hidden, so an admin can see why it is unavailable. The one held by the
   * technician being edited stays selectable — it is their own link.
   */
  function accountIsTaken(option: TechnicianAccountOption): boolean {
    return option.linkedTechnicianId !== null && option.linkedTechnicianId !== editing?.id;
  }

  const hasFilters = Boolean(query || status || trade || skill);

  function clearFilters() {
    setQuery("");
    setStatus("");
    setTrade("");
    setSkill("");
    load(1, { q: "", status: "", trade: "", skill: "" });
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeading
        title={tt("title")}
        subtitle={tt("subtitle")}
        note={canManage ? undefined : t("readOnly")}
        action={
          canManage ? (
            <Button onClick={openCreate}>
              <Plus className="size-4" aria-hidden />
              {tt("new")}
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
              placeholder={tt("name")}
              maxLength={64}
              type="search"
            />
          </Field>
        </div>

        <div className="w-44">
          <Field label={tt("trade")}>
            <Select
              value={trade}
              onChange={(event) => {
                setTrade(event.target.value);
                load(1, { trade: event.target.value });
              }}
            >
              <option value="">{tt("allTrades")}</option>
              {TRADES.map((value) => (
                <option key={value} value={value}>
                  {tt(`trades.${value}`)}
                </option>
              ))}
            </Select>
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
              {TECHNICIAN_STATUSES.map((value) => (
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

      {/* The skill filter has no control of its own — it is set by clicking a
          chip on a card. This is where it becomes visible and removable, so a
          filtered list can never look like an empty directory. */}
      {hasFilters && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {skill && (
            <Badge variant="accent">
              {tt("skillFilter", { skill })}
              <button
                type="button"
                onClick={() => filterBySkill("")}
                aria-label={tt("clearSkillFilter", { skill })}
                className="ms-0.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3" aria-hidden />
              </button>
            </Badge>
          )}
          <Button variant="ghost" size="sm" onClick={clearFilters} disabled={isPending}>
            {t("clear")}
          </Button>
        </div>
      )}

      {result.items.length === 0 ? (
        <EmptyState
          icon={Users}
          title={hasFilters ? tt("noMatches") : tt("empty")}
          description={hasFilters ? tt("noMatchesBody") : tt("emptyBody")}
          action={
            hasFilters ? (
              <Button variant="outline" onClick={clearFilters}>
                {t("clear")}
              </Button>
            ) : canManage ? (
              <Button onClick={openCreate}>
                <Plus className="size-4" aria-hidden />
                {tt("new")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <motion.ul
          className="grid list-none grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
          initial="hidden"
          animate="visible"
          variants={gridVariants}
        >
          {result.items.map((technician, index) => (
            <motion.li
              key={technician.id}
              className="flex"
              // Beyond the stagger limit the card renders immediately: a full
              // page of 20 must not make the last one wait out the cascade.
              variants={index < STAGGER_LIMIT ? cardVariants : undefined}
            >
              <TechnicianCard
                technician={technician}
                activeSkill={skill || undefined}
                onOpenProfile={() => setViewing(technician)}
                onSelectSkill={filterBySkill}
                actions={
                  canManage ? (
                    <RecordActions
                      name={technician.name}
                      onEdit={() => openEdit(technician)}
                      onDelete={() => setDeleting(technician)}
                      disabled={isPending || isDeleting}
                    />
                  ) : undefined
                }
              />
            </motion.li>
          ))}
        </motion.ul>
      )}

      <Pagination
        page={result.page}
        totalPages={result.totalPages}
        total={result.total}
        isPending={isPending}
        onChange={load}
      />

      {/* --- Profile --- */}
      <Modal
        open={viewing !== null}
        onOpenChange={(open) => !open && setViewing(null)}
        title={viewing?.name ?? ""}
        size="md"
        icon={<Users />}
        footer={
          canManage && viewing ? (
            <Button onClick={() => openEdit(viewing)}>{t("edit")}</Button>
          ) : undefined
        }
      >
        {viewing && (
          <div className="grid gap-5">
            <div className="flex items-center gap-4">
              <Avatar name={viewing.name} trade={viewing.trade} size="lg" />
              <div className="flex flex-wrap items-center gap-2">
                <TradeBadge trade={viewing.trade} />
                <StatusBadge status={viewing.status} />
              </div>
            </div>

            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {tt("skills")}
              </h4>
              {viewing.skills.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {viewing.skills.map((item) => (
                    <SkillChip key={item} skill={item} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{tt("noSkills")}</p>
              )}
            </section>

            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {tt("account")}
              </h4>
              {viewing.userId ? (
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 truncate">
                    {viewing.userName ?? tt("accountLinked")}
                    {viewing.userEmail && (
                      <span className="bidi-isolate text-muted-foreground">
                        {" "}
                        · {viewing.userEmail}
                      </span>
                    )}
                  </span>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{tt("accountNoneLong")}</p>
              )}
            </section>

            <p className="border-t border-border pt-3 text-xs text-muted-foreground">
              {tt("addedOn", {
                date: format.dateTime(new Date(viewing.createdAt), {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                }),
              })}
            </p>
          </div>
        )}
      </Modal>

      {/* --- Create / edit --- */}
      <Modal
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? tt("editTitle") : tt("newTitle")}
        size="lg"
        icon={<Users />}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={isSubmitting}>
              {t("cancel")}
            </Button>
            <Button type="submit" form="technician-form" isLoading={isSubmitting}>
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
          id="technician-form"
          className="grid items-start gap-x-5 gap-y-4 @lg:grid-cols-2"
          onSubmit={handleSubmit}
        >
          <Field label={tt("name")} error={fieldErrors.name} required className="@lg:col-span-2">
            <Input name="name" defaultValue={editing?.name ?? ""} maxLength={120} required />
          </Field>

          <Field label={tt("trade")} error={fieldErrors.trade} required>
            <Select name="trade" defaultValue={editing?.trade ?? "HVAC"}>
              {TRADES.map((value) => (
                <option key={value} value={value}>
                  {tt(`trades.${value}`)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t("filterStatus")} error={fieldErrors.status}>
            <Select name="status" defaultValue={editing?.status ?? "ACTIVE"}>
              {TECHNICIAN_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`status.${value}`)}
                </option>
              ))}
            </Select>
          </Field>

          {/* Not wrapped in <Field>: the control is a composite, not a single
              input, so the label is wired to the text box inside it by id. */}
          <div className="grid gap-1.5 @lg:col-span-2">
            <label htmlFor="technician-skills" className="text-sm font-medium text-foreground">
              {tt("skills")}
            </label>
            <SkillsInput name="technician-skills" value={skills} onChange={setSkills} />
            {fieldErrors.skills && (
              <p role="alert" className="text-sm text-danger">
                {fieldErrors.skills}
              </p>
            )}
          </div>

          <Field
            label={tt("account")}
            hint={tt("accountHint")}
            error={fieldErrors.userId}
            className="@lg:col-span-2"
          >
            <Select name="userId" defaultValue={editing?.userId ?? ""}>
              <option value="">{tt("accountNone")}</option>
              {accountOptions.map((option) => (
                <option key={option.id} value={option.id} disabled={accountIsTaken(option)}>
                  {option.name} · {option.email}
                  {accountIsTaken(option) ? ` (${tt("accountTaken")})` : ""}
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
        title={t("deleteTitle", { name: deleting?.name ?? "" })}
        description={tt("deleteBody")}
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
