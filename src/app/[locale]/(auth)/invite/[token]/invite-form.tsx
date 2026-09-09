"use client";

import { useActionState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { acceptInviteAction, type PublicFormState } from "@/lib/signup/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";

/**
 * Set a password and activate an invited account.
 *
 * The token rides in a hidden field rather than being read from the URL by the
 * action, because a Server Action has no URL of its own — it is a POST to
 * whatever route rendered it. It is re-validated to shape, hashed, and matched
 * against a digest inside a conditional update, so a tampered value fails the
 * same way an unknown one does.
 *
 * There is no email field, and that absence is the security property: who this
 * invitation is for was decided when it was issued. A form that could name an
 * account would let anybody holding any valid token set anybody's password.
 */
export function InviteForm({ token }: { token: string }) {
  const t = useTranslations("invite");
  const locale = useLocale();

  const [state, formAction, isPending] = useActionState<
    PublicFormState,
    FormData
  >(acceptInviteAction, {});

  const fieldErrors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="grid gap-5" noValidate>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="locale" value={locale} />

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
          autoFocus
          dir="ltr"
        />
      </Field>

      <Field label={t("confirm")} error={fieldErrors.confirmPassword} required>
        <PasswordInput
          name="confirmPassword"
          autoComplete="new-password"
          required
          dir="ltr"
        />
      </Field>

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
