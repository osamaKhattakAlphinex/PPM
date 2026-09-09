"use client";

import { useCallback, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";
import { Clock, LogIn, LogOut, MapPin, TriangleAlert, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { checkInAction, checkOutAction } from "@/lib/technician-view/actions";
import type { MyJob, MyJobsData } from "@/lib/technician-view/queries";
import { PageHeading } from "../_components/page-heading";

/**
 * The technician's screen. A phone screen that happens to work on a desktop,
 * rather than the other way round.
 *
 * Three things follow from that and are visible in the markup:
 *
 *  - The shift card is FIRST and its button is full-width. Checking in is the
 *    first thing anybody does and the one thing they do standing in a car park
 *    with one hand.
 *  - Every target is at least 44px (`touch-target` on the buttons, generous
 *    padding on the rows). A 32px control is a control a person in gloves
 *    misses.
 *  - The list is one list, ordered late-first. Two lists would mean a decision
 *    about which to read first, taken by somebody who has not put their bag
 *    down yet.
 *
 * Everything arrives as one prop, computed on the server against a technician
 * record resolved from the SESSION. There is no id in this component that could
 * be changed to fetch somebody else's day.
 */

export function MyJobsView({ initial }: { initial: MyJobsData }) {
  const t = useTranslations("myJobs");
  const tf = useTranslations("preventive.frequency");
  const tp = useTranslations("corrective.priority");
  const ts = useTranslations("corrective.status");
  const format = useFormatter();
  const { toast } = useToast();

  const [data, setData] = useState(initial);
  const [isPending, startTransition] = useTransition();

  /**
   * Consent, remembered for this page view only.
   *
   * Deliberately NOT persisted anywhere — not to `localStorage`, not to the
   * user record. CLAUDE.md's rule is that GPS is captured with explicit
   * consent; a checkbox that remembers itself across sessions turns a decision
   * somebody made once into a default they never revisit, which is the thing
   * consent is supposed to prevent. It also starts UNCHECKED every time, so
   * doing nothing means sharing nothing.
   */
  const [consent, setConsent] = useState(false);

  /**
   * Ask the browser for a position, but only after consent — and never let a
   * refusal or a timeout block the check-in.
   *
   * The whole function resolves to `undefined` rather than rejecting: a
   * technician in a basement plant room must be able to start their shift, and
   * a location failure is not a reason to refuse that. The eight-second timeout
   * is the practical limit on standing still waiting for a fix.
   */
  const captureLocation = useCallback(async (): Promise<
    { latitude: number; longitude: number; accuracy: number | null } | undefined
  > => {
    if (!consent) return undefined;
    if (typeof navigator === "undefined" || !navigator.geolocation) return undefined;

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) =>
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: Number.isFinite(position.coords.accuracy)
              ? position.coords.accuracy
              : null,
          }),
        // Denied at the OS or browser level, unavailable, or timed out. All
        // three mean the same thing here: carry on without a position.
        () => resolve(undefined),
        { enableHighAccuracy: true, timeout: 8_000, maximumAge: 0 },
      );
    });
  }, [consent]);

  function submit(kind: "in" | "out") {
    startTransition(async () => {
      const coordinates = await captureLocation();

      const payload = {
        consent,
        ...(coordinates ? { coordinates } : {}),
      };

      const response =
        kind === "in" ? await checkInAction(payload) : await checkOutAction(payload);

      if (response.ok) {
        setData(response.data);
        toast({
          title: kind === "in" ? t("checkedIn") : t("checkedOut"),
          variant: "success",
        });
        return;
      }

      toast({
        title: response.error.fields?._ ?? response.error.message,
        variant: "danger",
      });
    });
  }

  const { shift, jobs } = data;
  const onSite = shift.status === "ON_SITE";
  const finished = shift.status === "CHECKED_OUT";

  return (
    <div className="mx-auto w-full max-w-2xl">
      <PageHeading
        title={t("title")}
        subtitle={data.technicianName ? t("greeting", { name: data.technicianName }) : t("subtitle")}
      />

      {!data.hasTechnicianRecord && (
        <EmptyState
          icon={Wrench}
          title={t("noRecord")}
          description={t("noRecordBody")}
          className="mb-6"
        />
      )}

      {data.hasTechnicianRecord && (
        <section className="mb-6 rounded-md border border-border bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-display text-lg font-semibold text-foreground">
              {t("todaysShift")}
            </h3>

            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={shift.status}
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.92 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                className="inline-flex"
              >
                <Badge
                  dot
                  variant={onSite ? "success" : finished ? "neutral" : "warning"}
                >
                  {t(`status.${shift.status}`)}
                </Badge>
              </motion.span>
            </AnimatePresence>
          </div>

          {(shift.checkInAt || shift.checkOutAt) && (
            <dl className="mb-4 grid gap-1 text-sm">
              {shift.checkInAt && (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">{t("checkedInAt")}</dt>
                  <dd className="tabular-nums numeric-isolate text-foreground">
                    {format.dateTime(new Date(shift.checkInAt), { timeStyle: "short" })}
                  </dd>
                </div>
              )}
              {shift.checkOutAt && (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">{t("checkedOutAt")}</dt>
                  <dd className="tabular-nums numeric-isolate text-foreground">
                    {format.dateTime(new Date(shift.checkOutAt), { timeStyle: "short" })}
                  </dd>
                </div>
              )}
              {shift.minutes !== null && (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">{t("hoursWorked")}</dt>
                  <dd className="tabular-nums numeric-isolate text-foreground">
                    {t("hoursValue", {
                      hours: Math.floor(shift.minutes / 60),
                      minutes: shift.minutes % 60,
                    })}
                  </dd>
                </div>
              )}
              {shift.locationCaptured && (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="size-3.5" aria-hidden />
                  {t("locationRecorded")}
                </p>
              )}
            </dl>
          )}

          {!finished && (
            <>
              {/*
                The consent control sits directly above the button it applies
                to, unchecked by default, and says exactly what happens. A
                consent checkbox somewhere else on the page, or pre-ticked, is
                not consent.
              */}
              <div className="mb-3 flex items-start gap-3 rounded-md bg-surface-sunken p-3 text-sm">
                <Checkbox
                  checked={consent}
                  onChange={setConsent}
                  label={t("consentLabel")}
                  className="mt-0.5"
                />
                {/*
                  The text is a <button> of its own rather than a <label>: the
                  control is a `role="checkbox"` button, and an HTML label does
                  not forward a click to one. Wiring it up by hand keeps the
                  whole sentence tappable, which on a phone is the difference
                  between a 20px target and a 300px one.
                */}
                <button
                  type="button"
                  onClick={() => setConsent(!consent)}
                  className="text-start text-muted-foreground"
                  // The Checkbox already carries the accessible name; this is a
                  // second way to reach the same control and must not be
                  // announced as a separate one.
                  aria-hidden
                  tabIndex={-1}
                >
                  {t("consentLabel")}
                </button>
              </div>

              <Button
                size="lg"
                className="w-full"
                variant={onSite ? "outline" : "primary"}
                isLoading={isPending}
                onClick={() => submit(onSite ? "out" : "in")}
              >
                {onSite ? (
                  <LogOut className="size-4" aria-hidden />
                ) : (
                  <LogIn className="size-4" aria-hidden />
                )}
                {onSite ? t("checkOut") : t("checkIn")}
              </Button>
            </>
          )}
        </section>
      )}

      <h3 className="mb-3 font-display text-lg font-semibold text-foreground">
        {t("yourJobs", { count: jobs.length })}
      </h3>

      {jobs.length === 0 ? (
        <EmptyState icon={Clock} title={t("noJobs")} description={t("noJobsBody")} />
      ) : (
        <motion.ul
          className="grid gap-3"
          initial="hidden"
          animate="visible"
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.03 } } }}
        >
          {jobs.map((job) => (
            <JobRow
              key={`${job.kind}-${job.id}`}
              job={job}
              label={
                job.kind === "PPM" ? tf(job.label) : tp(job.label)
              }
              statusLabel={job.kind === "PPM" ? undefined : ts(job.status)}
              dateLabel={format.dateTime(new Date(job.date), { dateStyle: "medium" })}
              kindLabel={t(`kind.${job.kind}`)}
              overdueLabel={t("late")}
            />
          ))}
        </motion.ul>
      )}
    </div>
  );
}

/**
 * One job.
 *
 * A generous, tappable card rather than a table row: the whole point of this
 * screen is that it is used one-handed, and a 44px target is the floor rather
 * than the aspiration. Late work is marked with an icon AND a word, never with
 * colour alone.
 */
function JobRow({
  job,
  label,
  statusLabel,
  dateLabel,
  kindLabel,
  overdueLabel,
}: {
  job: MyJob;
  label: string;
  statusLabel?: string;
  dateLabel: string;
  kindLabel: string;
  overdueLabel: string;
}) {
  return (
    <motion.li
      variants={{
        hidden: { opacity: 0, y: 6 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.18, ease: "easeOut" } },
      }}
      className={cn(
        "rounded-md border bg-surface p-4",
        job.isOverdue ? "border-danger/40" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-foreground">{job.assetName ?? kindLabel}</p>
          <p className="text-sm text-muted-foreground">
            {kindLabel} · {label}
            {statusLabel ? ` · ${statusLabel}` : ""}
          </p>
        </div>

        {job.isOverdue && (
          <Badge variant="danger" className="shrink-0">
            <TriangleAlert className="size-3.5" aria-hidden />
            {overdueLabel}
          </Badge>
        )}
      </div>

      {job.issue && (
        <p className="mt-2 line-clamp-2 text-sm text-foreground">{job.issue}</p>
      )}

      <p className="mt-2 text-xs tabular-nums numeric-isolate text-muted-foreground">
        {dateLabel}
      </p>
    </motion.li>
  );
}
