"use client";

import { useCallback, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, CircleStop, PackageSearch, Repeat2, Sparkles, CalendarCog } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { AI_ANALYSES, type AiAnalysis } from "@/lib/ai/analyses";
import { PageHeading } from "../_components/page-heading";

/**
 * The four analysis cards.
 *
 * Everything about this component is shaped by one rule: the browser talks to
 * OUR server and nothing else. It POSTs an analysis name and a locale to
 * `/api/ai/insights` and reads a text stream back. It never holds an API key,
 * never sees a prompt, and never learns which model answered — all three live
 * on the server, and a network inspector on this page shows exactly one
 * same-origin request with a two-field body.
 *
 * The answer is rendered as it arrives rather than after it completes. A
 * three-hundred-word analysis behind a real model takes ten to twenty seconds,
 * and a spinner for twenty seconds is indistinguishable from a broken page.
 */

const ICON: Record<AiAnalysis, LucideIcon> = {
  FAILURE_RISK: Activity,
  BREAKDOWN_PATTERNS: Repeat2,
  PM_OPTIMIZATION: CalendarCog,
  SPARE_PARTS: PackageSearch,
};

interface AnalysisState {
  /** What has streamed so far. Rendered live. */
  text: string;
  isRunning: boolean;
  /** Set when the request failed before any text arrived. */
  error?: string;
}

const EMPTY: AnalysisState = { text: "", isRunning: false };

export function InsightsPanel({ isConfigured }: { isConfigured: boolean }) {
  const t = useTranslations("aiInsights");
  const locale = useLocale();
  const { toast } = useToast();

  const [states, setStates] = useState<Record<string, AnalysisState>>({});

  /**
   * One abort controller per analysis, so stopping one card does not cancel
   * another that is still streaming — the four are independent requests and a
   * manager will run two at once.
   */
  const controllers = useRef(new Map<AiAnalysis, AbortController>());

  const patch = useCallback((analysis: AiAnalysis, next: Partial<AnalysisState>) => {
    setStates((current) => ({
      ...current,
      [analysis]: { ...(current[analysis] ?? EMPTY), ...next },
    }));
  }, []);

  const run = useCallback(
    async (analysis: AiAnalysis) => {
      controllers.current.get(analysis)?.abort();

      const controller = new AbortController();
      controllers.current.set(analysis, controller);

      patch(analysis, { text: "", isRunning: true, error: undefined });

      try {
        const response = await fetch("/api/ai/insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The entire request body: which of four analyses, and which of two
          // languages. There is no prompt here to tamper with.
          body: JSON.stringify({ analysis, locale }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          /**
           * The route answers a JSON envelope on failure and a text stream on
           * success. Parsed defensively: a 503 from a deployment with no key is
           * a legitimate state that should read as a sentence, not as a crash.
           */
          const body: unknown = await response.json().catch(() => null);
          const message =
            typeof body === "object" &&
            body !== null &&
            "error" in body &&
            typeof (body as { error?: { message?: unknown } }).error?.message === "string"
              ? (body as { error: { message: string } }).error.message
              : t("failed");

          patch(analysis, { isRunning: false, error: message });
          toast({ title: message, variant: "danger" });
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let text = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          patch(analysis, { text });
        }

        patch(analysis, { isRunning: false });
      } catch (error) {
        // An abort is a person pressing stop, not a failure. Everything else is.
        if (error instanceof DOMException && error.name === "AbortError") {
          patch(analysis, { isRunning: false });
          return;
        }
        patch(analysis, { isRunning: false, error: t("failed") });
        toast({ title: t("failed"), variant: "danger" });
      } finally {
        controllers.current.delete(analysis);
      }
    },
    [locale, patch, t, toast],
  );

  function stop(analysis: AiAnalysis) {
    controllers.current.get(analysis)?.abort();
  }

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeading
        title={t("title")}
        subtitle={t("subtitle")}
        note={isConfigured ? undefined : t("notConfiguredNote")}
      />

      {/*
        The standing note about what leaves the building. Permanent rather than
        dismissible: a person pressing a button that sends their maintenance
        data to a third party should be able to see that fact every time.
      */}
      <p className="mb-6 flex items-start gap-2 rounded-md border border-border bg-surface-sunken px-4 py-3 text-sm text-muted-foreground">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-accent-text" aria-hidden />
        <span>{t("privacyNote")}</span>
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        {AI_ANALYSES.map((analysis) => {
          const state = states[analysis] ?? EMPTY;
          const Icon = ICON[analysis];

          return (
            <Card key={analysis} className="flex flex-col">
              <CardHeader className="mb-3 flex-row items-start justify-between gap-4">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2">
                    <Icon className="size-4 shrink-0 text-accent-text" aria-hidden />
                    {t(`analysis.${analysis}.title`)}
                  </CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t(`analysis.${analysis}.body`)}
                  </p>
                </div>
              </CardHeader>

              <CardContent className="flex flex-1 flex-col gap-3">
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => run(analysis)}
                    disabled={!isConfigured || state.isRunning}
                    isLoading={state.isRunning && state.text.length === 0}
                  >
                    {state.text ? t("rerun") : t("run")}
                  </Button>

                  {state.isRunning && (
                    <Button size="sm" variant="outline" onClick={() => stop(analysis)}>
                      <CircleStop className="size-4" aria-hidden />
                      {t("stop")}
                    </Button>
                  )}
                </div>

                <AnimatePresence initial={false} mode="wait">
                  {state.isRunning && state.text.length === 0 && (
                    <motion.div
                      key="loading"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="grid gap-2"
                      // The card is filling in, and a screen reader should say
                      // so once rather than announce every streamed token.
                      aria-live="polite"
                      aria-label={t("thinking")}
                    >
                      <Skeleton className="h-4 w-4/5" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-3/5" />
                    </motion.div>
                  )}

                  {state.error && !state.text && (
                    <motion.p
                      key="error"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="text-sm text-danger"
                      role="alert"
                    >
                      {state.error}
                    </motion.p>
                  )}

                  {state.text && (
                    <motion.div
                      key="text"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className={cn(
                        // `whitespace-pre-wrap` rather than a markdown renderer:
                        // the system prompt asks for plain prose and short
                        // headed sections, and rendering arbitrary model output
                        // as HTML is a class of bug this screen does not need.
                        "whitespace-pre-wrap text-sm leading-relaxed text-foreground",
                        state.isRunning && "after:ms-0.5 after:animate-pulse after:content-['▍']",
                      )}
                    >
                      {state.text}
                    </motion.div>
                  )}
                </AnimatePresence>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
