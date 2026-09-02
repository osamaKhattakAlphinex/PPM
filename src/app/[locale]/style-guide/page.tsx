"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, ClipboardList, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, type TableColumn } from "@/components/ui/table";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { LocaleToggle } from "@/components/ui/locale-toggle";
import { useLocale } from "next-intl";
import type { Locale } from "@/lib/i18n/config";

type WorkOrder = {
  id: number;
  code: string;
  asset: string;
  priority: "Critical" | "High" | "Medium" | "Low";
  status: "Open" | "In progress" | "Completed" | "Overdue";
  sla: string;
  cost: string;
};

const workOrdersEn: WorkOrder[] = [
  { id: 1, code: "WO-2041", asset: "Chiller Unit 3 — Tower A", priority: "Critical", status: "Overdue", sla: "-2h 14m", cost: "1,204.50" },
  { id: 2, code: "WO-2042", asset: "Fire Panel — Basement", priority: "High", status: "In progress", sla: "3h 40m", cost: "480.00" },
  { id: 3, code: "WO-2043", asset: "AHU-07 — Level 5", priority: "Medium", status: "Open", sla: "1d 2h", cost: "0.00" },
  { id: 4, code: "WO-2044", asset: "Generator — Roof", priority: "Low", status: "Completed", sla: "—", cost: "6,150.00" },
  { id: 5, code: "WO-2045", asset: "Elevator 2 — Lobby", priority: "High", status: "Open", sla: "5h 05m", cost: "0.00" },
];

const workOrdersAr: WorkOrder[] = [
  { id: 1, code: "WO-2041", asset: "وحدة التبريد 3 — البرج أ", priority: "Critical", status: "Overdue", sla: "-2 س 14 د", cost: "1,204.50" },
  { id: 2, code: "WO-2042", asset: "لوحة الحريق — البدروم", priority: "High", status: "In progress", sla: "3 س 40 د", cost: "480.00" },
  { id: 3, code: "WO-2043", asset: "وحدة التكييف 07 — الطابق 5", priority: "Medium", status: "Open", sla: "1 ي 2 س", cost: "0.00" },
  { id: 4, code: "WO-2044", asset: "المولد — السطح", priority: "Low", status: "Completed", sla: "—", cost: "6,150.00" },
  { id: 5, code: "WO-2045", asset: "المصعد 2 — اللوبي", priority: "High", status: "Open", sla: "5 س 05 د", cost: "0.00" },
];

const priorityVariant: Record<WorkOrder["priority"], "danger" | "warning" | "accent" | "neutral"> = {
  Critical: "danger",
  High: "warning",
  Medium: "accent",
  Low: "neutral",
};

const statusVariant: Record<WorkOrder["status"], "primary" | "accent" | "success" | "danger"> = {
  Open: "primary",
  "In progress": "accent",
  Completed: "success",
  Overdue: "danger",
};

const copy = {
  en: {
    heading: "PPM Design System",
    sub: "Steel & Brass — live component review, both themes, both directions.",
    palette: "Palette",
    paletteBody:
      "Semantic tokens read live from the active theme below. Toggle theme/direction in the header.",
    type: "Typography",
    typeBody:
      "Inter throughout — 600/700 for display, 400/500 for body. Arabic swaps to IBM Plex Sans Arabic.",
    buttons: "Buttons",
    badges: "Badges",
    cards: "Cards",
    cardTitle: "Chiller Unit 3",
    cardDesc: "Tower A — Level 12 plant room",
    cardBody: "Preventive maintenance due in 4 days. Last service logged by S. Al-Harbi.",
    form: "Form fields",
    table: "Table — collapses to cards below md",
    tableToggle: "Simulate loading",
    modal: "Modal / Sheet",
    modalBody: "One component: a centered dialog on desktop, a draggable bottom sheet on mobile. Resize the window to see it switch.",
    openModal: "Open modal",
    modalTitle: "Close work order WO-2041?",
    modalDesc: "This marks the chiller repair as complete and notifies the requester.",
    cancel: "Cancel",
    confirm: "Confirm",
    toasts: "Toasts",
    skeleton: "Skeletons",
    empty: "Empty state",
    emptyTitle: "No work orders yet",
    emptyDesc: "Work orders assigned to you will show up here once created.",
    emptyAction: "Create work order",
  },
  ar: {
    heading: "نظام التصميم — PPM",
    sub: "الفولاذ والنحاس — مراجعة حيّة للمكوّنات، بالسمتين والاتجاهين.",
    palette: "لوحة الألوان",
    paletteBody: "الرموز الدلالية تُقرأ مباشرة من السمة الحالية. بدّل السمة/الاتجاه من الأعلى.",
    type: "الطباعة",
    typeBody:
      "خط Inter للعناوين والنصوص معًا، ويتحول إلى IBM Plex Sans Arabic بالعربية.",
    buttons: "الأزرار",
    badges: "الشارات",
    cards: "البطاقات",
    cardTitle: "وحدة التبريد 3",
    cardDesc: "البرج أ — غرفة المعدات، الطابق 12",
    cardBody: "الصيانة الوقائية مستحقة خلال 4 أيام. آخر صيانة سجّلها س. الحربي.",
    form: "حقول النموذج",
    table: "جدول — يتحول إلى بطاقات على الجوال",
    tableToggle: "محاكاة التحميل",
    modal: "نافذة / لوحة سفلية",
    modalBody: "مكوّن واحد: نافذة حوار في المنتصف على الحاسوب، ولوحة سفلية قابلة للسحب على الجوال. غيّر حجم النافذة لترى الفرق.",
    openModal: "فتح النافذة",
    modalTitle: "إغلاق أمر الشغل WO-2041؟",
    modalDesc: "سيؤدي هذا إلى تعليم إصلاح المبرّد كمكتمل وإخطار مقدّم الطلب.",
    cancel: "إلغاء",
    confirm: "تأكيد",
    toasts: "الإشعارات",
    skeleton: "الهياكل العظمية",
    empty: "حالة فارغة",
    emptyTitle: "لا توجد أوامر شغل بعد",
    emptyDesc: "ستظهر هنا أوامر الشغل المسندة إليك عند إنشائها.",
    emptyAction: "إنشاء أمر شغل",
  },
} as const;

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-border py-10 first:border-t-0 first:pt-0">
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Swatch({ name, varName }: { name: string; varName: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="h-16" style={{ backgroundColor: `var(${varName})` }} />
      <div className="p-3">
        <p className="text-sm font-medium text-foreground">{name}</p>
        <p className="bidi-isolate text-xs text-muted-foreground">{varName}</p>
      </div>
    </div>
  );
}

// Tailwind v4 only keeps @theme color variables it can statically detect as
// used by a class name in scanned source. These swatches are the one place
// that reads a ramp step dynamically (`petrol-${step}`), which Tailwind's
// scanner can't see — so the values are mirrored here rather than read back
// out of the (possibly tree-shaken) CSS variable. The source of truth for
// the actual design tokens remains src/app/globals.css.
const RAMPS: Record<string, Record<number, string>> = {
  petrol: { 50: "#f1f8f8", 100: "#e0f0ef", 200: "#beeae7", 300: "#93dcd8", 400: "#58dad2", 500: "#2dccc3", 600: "#25a79f", 700: "#1e8680", 800: "#145a56", 900: "#0f4d49" },
  brass: { 50: "#f8f6f2", 100: "#efeae1", 200: "#e8d9bf", 300: "#d9c096", 400: "#d4a95e", 500: "#bd8a32", 600: "#a1762b", 700: "#815e22", 800: "#654a1b", 900: "#4a3512" },
  rust: { 50: "#f8f3f2", 100: "#efe3e1", 200: "#e7c7c0", 300: "#d8a297", 400: "#d3725f", 500: "#c44e36", 600: "#ae4530", 700: "#803323", 800: "#64281c", 900: "#491c13" },
  moss: { 50: "#f3f6f5", 100: "#e5ebe8", 200: "#caddd2", 300: "#a8c7b5", 400: "#7db595", 500: "#5b9f78", 600: "#45785b", 700: "#3c684f", 800: "#2f513d", 900: "#213b2c" },
  stone: { 50: "#f6f5f4", 100: "#e7e2d9", 200: "#dbd6cc", 300: "#c4bbab", 400: "#b0a082", 500: "#998561", 600: "#7d6d4f", 700: "#64573f", 800: "#4e4431", 900: "#393123" },
  mist: { 50: "#f5f5f5", 100: "#e8e9e8", 200: "#d2d5d4", 300: "#b5bab9", 400: "#959d9b", 500: "#7c8683", 600: "#626a68", 700: "#4e5553", 800: "#3d4241", 900: "#2c302f" },
};

function RampSwatch({ name, steps }: { name: string; steps: number[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex">
        {steps.map((step) => (
          <div key={step} className="h-12 flex-1" style={{ backgroundColor: RAMPS[name][step] }} />
        ))}
      </div>
      <p className="p-2 text-xs font-medium text-muted-foreground">{name}</p>
    </div>
  );
}

export default function StyleGuidePage() {
  const locale = useLocale() as Locale;
  const t = copy[locale];
  const workOrders = locale === "ar" ? workOrdersAr : workOrdersEn;
  const { toast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [tableLoading, setTableLoading] = useState(false);

  const columns: TableColumn<WorkOrder>[] = [
    { key: "code", header: locale === "ar" ? "الرقم" : "Work order", cell: (row) => <span className="font-medium">{row.code}</span> },
    { key: "asset", header: locale === "ar" ? "الأصل" : "Asset", cell: (row) => row.asset },
    {
      key: "priority",
      header: locale === "ar" ? "الأولوية" : "Priority",
      cell: (row) => <Badge variant={priorityVariant[row.priority]}>{row.priority}</Badge>,
    },
    {
      key: "status",
      header: locale === "ar" ? "الحالة" : "Status",
      cell: (row) => <Badge variant={statusVariant[row.status]}>{row.status}</Badge>,
    },
    {
      // Arabic SLA values mix Arabic unit letters with digits (e.g. "-2 س 14 د") —
      // that's ordinary embedded-number text, not a foreign LTR chunk, so it's
      // left to flow naturally rather than force-isolated. See DESIGN.md §5.
      key: "sla",
      header: "SLA",
      cell: (row) => row.sla,
    },
    {
      key: "cost",
      header: locale === "ar" ? "التكلفة (ر.س)" : "Cost (SAR)",
      cell: (row) => <span className="numeric-isolate">{row.cost}</span>,
    },
  ];

  function simulateLoading() {
    setTableLoading(true);
    window.setTimeout(() => setTableLoading(false), 1500);
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div>
            <p className="font-display text-lg font-semibold text-foreground">{t.heading}</p>
            <p className="text-sm text-muted-foreground">{t.sub}</p>
          </div>
          <div className="flex items-center gap-2">
            <LocaleToggle />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-24">
        <Section id="palette" title={t.palette} description={t.paletteBody}>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <Swatch name="Background" varName="--background" />
            <Swatch name="Surface" varName="--surface" />
            <Swatch name="Surface sunken" varName="--surface-sunken" />
            <Swatch name="Border strong" varName="--border-strong" />
            <Swatch name="Primary (petrol)" varName="--primary" />
            <Swatch name="Accent (brass)" varName="--accent" />
            <Swatch name="Danger (rust)" varName="--danger" />
            <Swatch name="Success (moss)" varName="--success" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <RampSwatch name="petrol" steps={[100, 300, 500, 700, 900]} />
            <RampSwatch name="brass" steps={[100, 300, 500, 700, 900]} />
            <RampSwatch name="rust" steps={[100, 300, 500, 700, 900]} />
            <RampSwatch name="moss" steps={[100, 300, 500, 700, 900]} />
            <RampSwatch name="stone" steps={[100, 300, 500, 700, 900]} />
            <RampSwatch name="mist" steps={[100, 300, 500, 700, 900]} />
          </div>
        </Section>

        <Section id="type" title={t.type} description={t.typeBody}>
          <div className="space-y-4 rounded-md border border-border p-6">
            <p className="font-display text-5xl font-semibold text-foreground">{locale === "ar" ? "الصيانة" : "Maintenance"}</p>
            <p className="font-display text-3xl font-semibold text-foreground">{locale === "ar" ? "أوامر الشغل" : "Work order queue"}</p>
            <p className="font-display text-xl font-semibold text-foreground">{locale === "ar" ? "تفاصيل الأصل" : "Asset details"}</p>
            <p className="text-lg text-foreground">
              {locale === "ar" ? "إدارة الصيانة الوقائية للمرافق في الخليج." : "Preventive maintenance management for Gulf facilities."}
            </p>
            <p className="text-base text-foreground">
              {locale === "ar"
                ? "يبلغ إجمالي التكلفة المقدّرة "
                : "The estimated total cost is "}
              <span className="numeric-isolate font-medium">1,204.50</span> {locale === "ar" ? "ر.س" : "SAR"}.
            </p>
            <p className="text-sm text-muted-foreground">
              {locale === "ar" ? "آخر تحديث قبل 4 دقائق." : "Last updated 4 minutes ago."}
            </p>
          </div>
        </Section>

        <Section id="buttons" title={t.buttons}>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">{t.confirm}</Button>
            <Button variant="accent">{locale === "ar" ? "إجراء رئيسي" : "Key action"}</Button>
            <Button variant="outline">{locale === "ar" ? "إجراء ثانوي" : "Secondary"}</Button>
            <Button variant="ghost">{locale === "ar" ? "شفاف" : "Ghost"}</Button>
            <Button variant="danger">{locale === "ar" ? "حذف" : "Delete"}</Button>
            <Button isLoading>{locale === "ar" ? "جارٍ الحفظ" : "Saving"}</Button>
            <Button disabled>{locale === "ar" ? "معطل" : "Disabled"}</Button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
          </div>
        </Section>

        <Section id="badges" title={t.badges}>
          <div className="flex flex-wrap gap-2">
            <Badge variant="neutral">Neutral</Badge>
            <Badge variant="primary">Primary</Badge>
            <Badge variant="accent">Accent</Badge>
            <Badge variant="success" dot>
              Completed
            </Badge>
            <Badge variant="danger" dot>
              Overdue
            </Badge>
            <Badge variant="warning" dot>
              High priority
            </Badge>
          </div>
        </Section>

        <Section id="cards" title={t.cards}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t.cardTitle}</CardTitle>
                <CardDescription>{t.cardDesc}</CardDescription>
              </CardHeader>
              <CardContent>{t.cardBody}</CardContent>
              <CardFooter>
                <Button variant="outline" size="sm">
                  {t.cancel}
                </Button>
                <Button size="sm">{t.confirm}</Button>
              </CardFooter>
            </Card>
            <Card interactive onClick={() => toast({ title: t.cardTitle, variant: "default" })}>
              <CardHeader>
                <CardTitle>{locale === "ar" ? "بطاقة تفاعلية" : "Interactive card"}</CardTitle>
                <CardDescription>
                  {locale === "ar" ? "انقر للتجربة — بطاقة قابلة للنقر بأكملها" : "Click anywhere — the whole card is a target"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {locale === "ar"
                  ? "ترتفع البطاقة قليلاً وتزداد الظلال عند التمرير، وتنكمش قليلاً عند الضغط."
                  : "Lifts and gains shadow on hover, compresses slightly on press."}
              </CardContent>
            </Card>
          </div>
        </Section>

        <Section id="form" title={t.form}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={locale === "ar" ? "عنوان أمر الشغل" : "Work order title"} required>
              <Input placeholder={locale === "ar" ? "مثال: إصلاح المبرّد" : "e.g. Chiller repair"} />
            </Field>
            <Field
              label={locale === "ar" ? "البريد الإلكتروني" : "Email"}
              error={locale === "ar" ? "أدخل بريدًا إلكترونيًا صالحًا" : "Enter a valid email address"}
            >
              <Input type="email" defaultValue="not-an-email" />
            </Field>
            <Field label={locale === "ar" ? "الأولوية" : "Priority"} hint={locale === "ar" ? "يحدد وقت الاستجابة" : "Determines response SLA"}>
              <Select defaultValue="High">
                <option>Critical</option>
                <option>High</option>
                <option>Medium</option>
                <option>Low</option>
              </Select>
            </Field>
            <Field label={locale === "ar" ? "الفني المسؤول" : "Assigned technician"}>
              <Select defaultValue="">
                <option value="" disabled>
                  {locale === "ar" ? "اختر فنيًا" : "Select a technician"}
                </option>
                <option>Ahmed Al-Otaibi</option>
                <option>Sara Al-Harbi</option>
              </Select>
            </Field>
          </div>
        </Section>

        <Section id="table" title={t.table}>
          <div className="mb-4">
            <Button variant="outline" size="sm" onClick={simulateLoading}>
              {t.tableToggle}
            </Button>
          </div>
          <Table columns={columns} data={workOrders} isLoading={tableLoading} />
        </Section>

        <Section id="modal" title={t.modal} description={t.modalBody}>
          <Button onClick={() => setModalOpen(true)}>{t.openModal}</Button>
          <Modal
            open={modalOpen}
            onOpenChange={setModalOpen}
            title={t.modalTitle}
            description={t.modalDesc}
            footer={
              <>
                <Button variant="outline" onClick={() => setModalOpen(false)}>
                  {t.cancel}
                </Button>
                <Button
                  onClick={() => {
                    setModalOpen(false);
                    toast({ title: t.confirm, variant: "success" });
                  }}
                >
                  {t.confirm}
                </Button>
              </>
            }
          >
            <p className="text-sm text-muted-foreground">
              {locale === "ar"
                ? "لا يمكن التراجع عن هذا الإجراء بعد الإرسال."
                : "This action cannot be undone once submitted."}
            </p>
          </Modal>
        </Section>

        <Section id="toasts" title={t.toasts}>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={() =>
                toast({ title: locale === "ar" ? "تم الحفظ" : "Saved", description: locale === "ar" ? "تم حفظ التغييرات" : "Your changes were saved." })
              }
            >
              Default
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                toast({
                  title: locale === "ar" ? "اكتمل أمر الشغل" : "Work order completed",
                  variant: "success",
                })
              }
            >
              Success
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                toast({
                  title: locale === "ar" ? "اقتراب انتهاء SLA" : "SLA approaching breach",
                  variant: "warning",
                })
              }
            >
              Warning
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                toast({
                  title: locale === "ar" ? "فشل الحفظ" : "Failed to save",
                  description: locale === "ar" ? "حاول مرة أخرى" : "Please try again.",
                  variant: "danger",
                })
              }
            >
              Danger
            </Button>
          </div>
        </Section>

        <Section id="skeleton" title={t.skeleton}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 rounded-md border border-border p-4">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
            <div className="flex items-center gap-3 rounded-md border border-border p-4">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          </div>
        </Section>

        <Section id="empty" title={t.empty}>
          <EmptyState
            icon={ClipboardList}
            title={t.emptyTitle}
            description={t.emptyDesc}
            action={
              <Button size="sm">
                <Wrench className="size-4" aria-hidden />
                {t.emptyAction}
              </Button>
            }
          />
        </Section>

        <div className="flex items-center gap-2 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <p>
            {locale === "ar"
              ? "جميع الحركات هنا تحترم إعداد تقليل الحركة في نظام التشغيل تلقائيًا."
              : "Every animation on this page automatically respects your OS's reduced-motion setting."}
          </p>
        </div>
      </main>
    </div>
  );
}
