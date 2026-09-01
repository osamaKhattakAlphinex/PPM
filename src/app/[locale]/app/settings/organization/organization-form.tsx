"use client";

import { useActionState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

import { CURRENCIES } from "@/lib/domain/currency";
import { updateOrganizationAction } from "@/lib/master-data/actions";
import type { OrganizationSummary } from "@/lib/master-data/dto";
import type { ActionResult } from "@/lib/security/action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";

/**
 * The tenant's own profile.
 *
 * There is no id anywhere in this form, and that is the security property: the
 * action updates `scope.organizationId` and takes no organization parameter, so
 * the worst a compromised ADMIN session can do here is rename its own tenant.
 *
 * `slug` is rendered disabled rather than omitted. It is what sign-in links are
 * keyed on, so an administrator needs to be able to read it — and needs to see
 * that it is deliberately not editable rather than wonder where it went.
 */
export function OrganizationForm({ organization }: { organization: OrganizationSummary }) {
  const t = useTranslations("masterData");
  const to = useTranslations("masterData.organization");
  const { toast } = useToast();

  const [state, submit, isPending] = useActionState(updateOrganizationAction, undefined);
  const handled = useRef<ActionResult<OrganizationSummary> | undefined>(undefined);

  useEffect(() => {
    if (!state || state === handled.current) return;
    handled.current = state;

    if (state.ok) {
      toast({ title: t("saved"), variant: "success" });
      return;
    }
    if (state.error.code !== "VALIDATION_FAILED") {
      toast({ title: state.error.message, variant: "danger" });
    }
  }, [state, t, toast]);

  const fieldErrors = state && !state.ok ? (state.error.fields ?? {}) : {};
  // After a successful save the server's copy is the truth; before one, the
  // values that came from the page are.
  const current = state?.ok ? state.data : organization;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => {
      const value = form.get(key);
      return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
    };

    submit({
      name: text("name") ?? "",
      defaultLocale: form.get("defaultLocale"),
      timezone: text("timezone") ?? "",
      // Null is meaningful here: "registered, no number yet" rather than
      // "unchanged". An empty input clears the field.
      vatNumber: text("vatNumber"),
      defaultCurrency: form.get("defaultCurrency"),
      // Sent whole. A partial subdocument in a `$set` replaces the whole
      // subdocument in MongoDB, so a half-filled one would silently drop the
      // fields the form did not send.
      settings: {
        vatRate: form.get("vatRate"),
        workWeekStartsOn: form.get("workWeekStartsOn"),
        contactEmail: text("contactEmail"),
        contactPhone: text("contactPhone"),
      },
    });
  }

  return (
    <form className="grid gap-6" onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>{to("profile")}</CardTitle>
          <CardDescription>{to("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field label={to("name")} error={fieldErrors.name} required>
            <Input name="name" defaultValue={current.name} maxLength={120} required />
          </Field>

          <Field label={to("slug")} hint={to("slugHint")}>
            <Input value={current.slug} disabled readOnly />
          </Field>

          <Field label={to("vatNumber")} hint={to("vatNumberHint")} error={fieldErrors.vatNumber}>
            <Input
              name="vatNumber"
              defaultValue={current.vatNumber ?? ""}
              inputMode="numeric"
              maxLength={15}
              placeholder="300000000000003"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={to("defaultCurrency")} error={fieldErrors.defaultCurrency}>
              <Select name="defaultCurrency" defaultValue={current.defaultCurrency}>
                {CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={to("defaultLocale")} error={fieldErrors.defaultLocale}>
              <Select name="defaultLocale" defaultValue={current.defaultLocale}>
                <option value="en">English</option>
                <option value="ar">العربية</option>
              </Select>
            </Field>
          </div>

          <Field label={to("timezone")} error={fieldErrors.timezone} required>
            <Input name="timezone" defaultValue={current.timezone} maxLength={64} required />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{to("preferences")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={to("vatRate")} error={fieldErrors["settings.vatRate"]}>
              <Input
                name="vatRate"
                type="number"
                min={0}
                max={100}
                step={0.5}
                defaultValue={current.settings.vatRate}
              />
            </Field>

            <Field
              label={to("workWeekStartsOn")}
              error={fieldErrors["settings.workWeekStartsOn"]}
            >
              <Select name="workWeekStartsOn" defaultValue={current.settings.workWeekStartsOn}>
                <option value="SUN">{to("SUN")}</option>
                <option value="MON">{to("MON")}</option>
              </Select>
            </Field>
          </div>

          <Field label={to("contactEmail")} error={fieldErrors["settings.contactEmail"]}>
            <Input
              name="contactEmail"
              type="email"
              defaultValue={current.settings.contactEmail ?? ""}
              maxLength={254}
            />
          </Field>

          <Field label={to("contactPhone")} error={fieldErrors["settings.contactPhone"]}>
            <Input
              name="contactPhone"
              type="tel"
              defaultValue={current.settings.contactPhone ?? ""}
              maxLength={32}
            />
          </Field>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" isLoading={isPending}>
          {to("save")}
        </Button>
      </div>
    </form>
  );
}
