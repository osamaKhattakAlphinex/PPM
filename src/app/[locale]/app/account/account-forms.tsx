"use client";

import { useActionState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { KeyRound, UserCog } from "lucide-react";

import {
  changePasswordAction,
  updateProfileAction,
} from "@/lib/account/actions";
import type { AccountProfile } from "@/lib/account/dto";
import type { ActionResult } from "@/lib/security/action";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { useToast } from "@/components/ui/toast";

/**
 * The two things a person may change about their own account.
 *
 * Neither form carries a user id, and that is the security property rather
 * than a convenience: both actions act on the signed-in user and accept no
 * user parameter at all, so there is no field here that could be edited into
 * somebody else's account.
 */

export function ProfileForm({ profile }: { profile: AccountProfile }) {
  const t = useTranslations("account");
  const { toast } = useToast();

  const [state, submit, isPending] = useActionState(
    updateProfileAction,
    undefined,
  );
  const handled = useRef<ActionResult<{ name: string }> | undefined>(undefined);

  useEffect(() => {
    if (!state || state === handled.current) return;
    handled.current = state;

    if (state.ok) {
      toast({ title: t("profile.saved"), variant: "success" });
      return;
    }
    if (state.error.code !== "VALIDATION_FAILED") {
      toast({ title: state.error.message, variant: "danger" });
    }
  }, [state, t, toast]);

  const fieldErrors = state && !state.ok ? (state.error.fields ?? {}) : {};
  // After a save the server's copy is the truth; before one, the page's is.
  const name = state?.ok ? state.data.name : profile.name;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserCog className="size-4 text-muted-foreground" aria-hidden />
          {t("profile.title")}
        </CardTitle>
        <CardDescription>{t("profile.description")}</CardDescription>
      </CardHeader>

      <CardContent>
        <form action={submit} className="grid gap-5" noValidate>
          <Field label={t("profile.name")} error={fieldErrors.name} required>
            <Input name="name" defaultValue={name} required maxLength={120} />
          </Field>

          {/*
            Read-only, and rendered rather than omitted so it is clear the value
            is deliberately fixed rather than missing. Email is the sign-in
            identity: changing it needs a verification round trip to the new
            address, or a typo locks the account out and a hijacked session can
            move the account somewhere the owner does not read.
          */}
          <Field label={t("profile.email")} hint={t("profile.emailFixed")}>
            <Input value={profile.email} readOnly disabled dir="ltr" />
          </Field>

          <div className="flex justify-end">
            <Button type="submit" isLoading={isPending}>
              {t("profile.submit")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function PasswordForm() {
  const t = useTranslations("account");
  const { toast } = useToast();

  const [state, submit, isPending] = useActionState(
    changePasswordAction,
    undefined,
  );
  const handled = useRef<ActionResult<{ changed: true }> | undefined>(
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state || state === handled.current) return;
    handled.current = state;

    if (state.ok) {
      // Clear all three boxes: leaving a password sitting in a form after a
      // successful change is the one field that should never persist.
      formRef.current?.reset();
      toast({ title: t("password.saved"), variant: "success" });
      return;
    }
    if (state.error.code !== "VALIDATION_FAILED") {
      toast({ title: state.error.message, variant: "danger" });
    }
  }, [state, t, toast]);

  const fieldErrors = state && !state.ok ? (state.error.fields ?? {}) : {};

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4 text-muted-foreground" aria-hidden />
          {t("password.title")}
        </CardTitle>
        <CardDescription>{t("password.description")}</CardDescription>
      </CardHeader>

      <CardContent>
        <form ref={formRef} action={submit} className="grid gap-5" noValidate>
          <Field
            label={t("password.current")}
            error={fieldErrors.currentPassword}
            required
          >
            <PasswordInput
              name="currentPassword"
              autoComplete="current-password"
              required
              dir="ltr"
            />
          </Field>

          <Field
            label={t("password.next")}
            error={fieldErrors.newPassword}
            hint={t("password.hint")}
            required
          >
            <PasswordInput
              name="newPassword"
              autoComplete="new-password"
              required
              dir="ltr"
            />
          </Field>

          <Field
            label={t("password.confirm")}
            error={fieldErrors.confirmPassword}
            required
          >
            <PasswordInput
              name="confirmPassword"
              autoComplete="new-password"
              required
              dir="ltr"
            />
          </Field>

          <p className="text-xs text-muted-foreground">
            {t("password.sessionsNote")}
          </p>

          <div className="flex justify-end">
            <Button type="submit" isLoading={isPending}>
              {t("password.submit")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
