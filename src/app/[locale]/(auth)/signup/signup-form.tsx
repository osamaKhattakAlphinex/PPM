"use client";

import { useActionState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { signupAction, type PublicFormState } from "@/lib/signup/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";

/**
 * Register a company.
 *
 * Two fields on this form are not what they look like.
 *
 * `companyReference` is a honeypot: rendered, positioned off-screen rather than
 * `display: none` (which some bots skip), hidden from assistive technology with
 * `aria-hidden` and taken out of the tab order. A person never sees it and
 * never fills it; a form-filling bot fills everything. The server answers a
 * filled one as though it succeeded, so the bot learns nothing.
 *
 * It is deliberately NOT called `website` or `url`. Browser profile autofill
 * targets those names, and a visitor whose browser helpfully filled the trap
 * would have their registration silently discarded.
 *
 * `locale` is a hidden field rather than a question: somebody registering on
 * the Arabic site wants an Arabic workspace, and one fewer question is worth
 * more than the setting being explicit. The server re-parses it against the
 * locale enum, so a tampered value degrades to the default rather than failing
 * the registration.
 */
export function SignupForm() {
  const t = useTranslations("signup");
  const locale = useLocale();

  const [state, formAction, isPending] = useActionState<
    PublicFormState,
    FormData
  >(signupAction, {});

  const fieldErrors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="relative grid gap-5" noValidate>
      <input type="hidden" name="locale" value={locale} />

      {/*
        The honeypot. The label stays — a bot that finds an unlabelled input is
        more suspicious of it, and no screen reader reaches this because of
        `aria-hidden` and the negative tab index.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-[9999px] h-px w-px overflow-hidden"
      >
        <label htmlFor="companyReference">Company reference</label>
        <input
          id="companyReference"
          name="companyReference"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      {state.error ? (
        <motion.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          role="alert"
          className="flex items-start gap-2 rounded-md border border-danger/25 bg-danger/10 px-3 py-2.5 text-sm text-danger"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{state.error}</span>
        </motion.p>
      ) : null}

      <Field label={t("company")} error={fieldErrors.organizationName} required>
        <Input
          name="organizationName"
          required
          autoFocus
          maxLength={120}
          placeholder={t("companyPlaceholder")}
        />
      </Field>

      <Field label={t("name")} error={fieldErrors.name} required>
        <Input name="name" required maxLength={120} autoComplete="name" />
      </Field>

      <Field label={t("email")} error={fieldErrors.email} required>
        <Input
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          required
          dir="ltr"
          className="text-start"
        />
      </Field>

      <Field
        label={t("password")}
        error={fieldErrors.password}
        hint={t("passwordHint")}
        required
      >
        <PasswordInput
          name="password"
          autoComplete="new-password"
          required
          dir="ltr"
        />
      </Field>

      <label className="flex items-start gap-2.5 text-sm text-muted-foreground">
        <input
          type="checkbox"
          name="acceptTerms"
          required
          className="mt-0.5 size-4 shrink-0 rounded border-border-strong accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span>{t("terms")}</span>
      </label>
      {fieldErrors.acceptTerms ? (
        <p className="-mt-3 text-sm text-danger" role="alert">
          {fieldErrors.acceptTerms}
        </p>
      ) : null}

      <Button
        type="submit"
        size="lg"
        isLoading={isPending}
        className="mt-1 w-full"
      >
        {isPending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
