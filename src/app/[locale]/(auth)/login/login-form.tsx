"use client";

import { useActionState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { useLocale } from "next-intl";

import { loginAction, type LoginState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * The sign-in form.
 *
 * A real `<form action={...}>` bound to a Server Action, so it works before
 * hydration and needs no client-side fetch. The action never tells the caller
 * which half of the pair was wrong — one message covers unknown address, wrong
 * password, suspended account and suspended tenant alike.
 *
 * `initialError` covers the other way in: a POST straight to the Auth.js
 * credentials endpoint bounces back here with `?error=`, and that visitor
 * should get the same sentence rather than a silent, blank form.
 */
export function LoginForm({
  callbackUrl,
  initialError,
}: {
  callbackUrl?: string;
  initialError?: string;
}) {
  const locale = useLocale();
  const [state, formAction, isPending] = useActionState<LoginState, FormData>(loginAction, {
    error: initialError,
  });

  return (
    <form action={formAction} className="grid gap-5" noValidate>
      {callbackUrl ? <input type="hidden" name="callbackUrl" value={callbackUrl} /> : null}
      {/*
        Carries the language into the post-login redirect. The action re-parses
        it against the locale enum before interpolating it into a path — a
        hidden field is a field like any other.
      */}
      <input type="hidden" name="locale" value={locale} />

      {state.error ? (
        <motion.p
          role="alert"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className="flex items-start gap-2 rounded-sm border border-danger/40 bg-danger/10 px-3 py-2.5 text-sm text-foreground"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          <span>{state.error}</span>
        </motion.p>
      ) : null}

      <Field label="Work email" error={state.fieldErrors?.email} required>
        <Input
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          placeholder="you@company.com"
          required
          autoFocus
          dir="ltr"
          className="text-start"
        />
      </Field>

      <Field label="Password" error={state.fieldErrors?.password} required>
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          dir="ltr"
          className="text-start"
        />
      </Field>

      <Button type="submit" size="lg" isLoading={isPending} className="mt-1 w-full">
        {isPending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
