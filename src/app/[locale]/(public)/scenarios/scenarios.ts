import type { Locale } from "@/lib/i18n/config";

/**
 * What the platform does, written as things a person can go and check.
 *
 * Every line below is one scenario in the language a facility manager uses —
 * "a job whose date has passed shows as overdue", not "the derived status is
 * computed from dueDate". Nothing here mentions a database, a field name, a
 * screen id or a role constant, because the audience is somebody deciding
 * whether the product does their job, or somebody walking through it to check
 * that it does.
 *
 * It is deliberately NOT `docs/TEST-CASES.md`. That document is the internal
 * sign-off sheet: it has steps, expected results, a pass/fail column and a set
 * of technical checks. This is the same ground told as behaviour, with the
 * technical sections dropped entirely.
 *
 * Both languages live side by side rather than in `src/messages/*.json` for one
 * practical reason: the message bundles are loaded for every page in the app,
 * and a hundred marketing sentences would be carried into every screen a
 * technician opens on a phone. This file is imported by one statically
 * rendered page and by nothing else.
 */

export interface Scenario {
  readonly en: string;
  readonly ar: string;
}

export interface ScenarioGroup {
  readonly id: string;
  readonly title: Scenario;
  readonly summary: Scenario;
  readonly scenarios: readonly Scenario[];
}

export function pick(text: Scenario, locale: Locale): string {
  return locale === "ar" ? text.ar : text.en;
}

export const SCENARIO_GROUPS: readonly ScenarioGroup[] = [
  {
    id: "access",
    title: {
      en: "Signing in and who sees what",
      ar: "تسجيل الدخول ومن يرى ماذا",
    },
    summary: {
      en: "Five kinds of people use the platform, and each one sees only the part of it that belongs to their job.",
      ar: "خمسة أنواع من المستخدمين يستعملون المنصة، ويرى كل واحد منهم الجزء الذي يخص عمله فقط.",
    },
    scenarios: [
      {
        en: "You sign in with your work email and land on the screen that matters to your role — a manager on the dashboard, a technician on their own job list, a client on their portal.",
        ar: "تسجّل الدخول ببريد العمل فتصل إلى الشاشة التي تهم دورك — المدير إلى لوحة المعلومات، والفني إلى قائمة أعماله، والعميل إلى بوابته.",
      },
      {
        en: "A wrong password is refused with the same message as an unknown email, so nobody can use the login page to find out who has an account.",
        ar: "تُرفض كلمة المرور الخاطئة بالرسالة نفسها التي يُرفض بها بريد غير معروف، فلا يستطيع أحد استخدام صفحة الدخول لمعرفة من يملك حسابًا.",
      },
      {
        en: "Repeated wrong passwords lock the attempt for a while, so nobody can sit and guess.",
        ar: "تؤدي المحاولات الخاطئة المتكررة إلى إيقاف المحاولة لفترة، فلا يستطيع أحد الجلوس والتخمين.",
      },
      {
        en: "Typing the address of a screen your role does not have does not open it — the menu and the actual permission always agree.",
        ar: "كتابة عنوان شاشة لا يملكها دورك لا يفتحها — القائمة والصلاحية الفعلية متطابقتان دائمًا.",
      },
      {
        en: "Signing out ends the session; pressing Back afterwards does not show the app again.",
        ar: "تسجيل الخروج ينهي الجلسة، والضغط على زر الرجوع بعدها لا يعيد عرض التطبيق.",
      },
      {
        en: "A supervisor can run the day's work but never sees contract values or invoices.",
        ar: "يستطيع المشرف إدارة عمل اليوم لكنه لا يرى قيم العقود ولا الفواتير إطلاقًا.",
      },
    ],
  },
  {
    id: "accounts",
    title: { en: "Your company and your colleagues", ar: "شركتك وزملاؤك" },
    summary: {
      en: "You create the company, then add the people in it. Nobody is created with more authority than the person creating them.",
      ar: "تُنشئ الشركة ثم تضيف العاملين فيها. ولا يُنشأ أحد بصلاحية أعلى من صلاحية من أنشأه.",
    },
    scenarios: [
      {
        en: "You register your company from the public site and become its first administrator, with an empty workspace of your own.",
        ar: "تسجّل شركتك من الموقع العام فتصبح أول مسؤول فيها، بمساحة عمل فارغة خاصة بك.",
      },
      {
        en: "An administrator adds a colleague, then sends them a link that lets them choose their own password — so no password is ever known to two people.",
        ar: "يضيف المسؤول زميلاً ثم يرسل له رابطًا يختار به كلمة مروره بنفسه — فلا يعرف كلمةَ مرور أحدٍ شخصان أبدًا.",
      },
      {
        en: "That link works once and stops working after seven days. Issuing a new one cancels the old.",
        ar: "يعمل هذا الرابط مرة واحدة ويتوقف بعد سبعة أيام. وإصدار رابط جديد يُلغي القديم.",
      },
      {
        en: "A new account cannot sign in until an administrator activates it, so somebody always decides.",
        ar: "لا يستطيع الحساب الجديد تسجيل الدخول حتى يفعّله المسؤول، فيبقى القرار بيد شخص دائمًا.",
      },
      {
        en: "Suspending somebody who has left keeps their history — the jobs they closed still carry their name.",
        ar: "إيقاف من غادر الشركة يحفظ سجلّه — فالأعمال التي أغلقها تبقى تحمل اسمه.",
      },
      {
        en: "A manager cannot suspend an administrator, and nobody can suspend themselves.",
        ar: "لا يستطيع المدير إيقاف مسؤول، ولا يستطيع أحد إيقاف نفسه.",
      },
      {
        en: "Anybody can change their own name and password, and changing a password requires knowing the current one.",
        ar: "يستطيع كل شخص تغيير اسمه وكلمة مروره، ويتطلب تغيير كلمة المرور معرفة الحالية.",
      },
    ],
  },
  {
    id: "clients",
    title: { en: "Clients and sites", ar: "العملاء والمواقع" },
    summary: {
      en: "The customers you serve, and the buildings you serve them in.",
      ar: "العملاء الذين تخدمهم، والمباني التي تخدمهم فيها.",
    },
    scenarios: [
      {
        en: "You add a client with their contact details, and they appear in the list straight away.",
        ar: "تضيف عميلاً ببيانات التواصل الخاصة به، فيظهر في القائمة مباشرة.",
      },
      {
        en: "You add the buildings you look after and attach each one to the client who owns it.",
        ar: "تضيف المباني التي تتولاها وتربط كل واحد منها بالعميل الذي يملكه.",
      },
      {
        en: "A site can belong to your own company rather than to a client — a store or a workshop, for instance.",
        ar: "يمكن أن يعود الموقع إلى شركتك نفسها بدلاً من عميل — مستودع أو ورشة مثلاً.",
      },
      {
        en: "Searching by name narrows the list as you type, and the filter survives a page refresh.",
        ar: "البحث بالاسم يضيّق القائمة أثناء الكتابة، ويبقى المرشِّح بعد تحديث الصفحة.",
      },
      {
        en: "An email that is not an email is refused before anything is saved.",
        ar: "يُرفض البريد الإلكتروني غير الصحيح قبل حفظ أي شيء.",
      },
    ],
  },
  {
    id: "assets",
    title: { en: "The asset register", ar: "سجل الأصول" },
    summary: {
      en: "Every chiller, panel, pump and lift you are responsible for, with its condition.",
      ar: "كل مبرّد ولوحة ومضخة ومصعد تتحمّل مسؤوليته، مع حالته.",
    },
    scenarios: [
      {
        en: "You add an asset, give it a category and a site, and it joins the register.",
        ar: "تضيف أصلاً وتمنحه فئة وموقعًا، فينضم إلى السجل.",
      },
      {
        en: "You filter the register by category or by condition, and you can see the worst-condition assets first.",
        ar: "تُرشِّح السجل حسب الفئة أو الحالة، ويمكنك رؤية الأصول الأسوأ حالة أولاً.",
      },
      {
        en: "An asset in maintenance is marked as such, so nobody schedules a visit against equipment that is already down.",
        ar: "يُعلَّم الأصل الذي تحت الصيانة بذلك، فلا يجدول أحد زيارة على معدة متوقفة أصلاً.",
      },
      {
        en: "You attach photos, manuals and certificates to an asset, and they open only for people in your company.",
        ar: "تُرفق الصور والأدلة والشهادات بالأصل، ولا تُفتح إلا لمن في شركتك.",
      },
      {
        en: "A client opening the platform sees only the assets in their own buildings.",
        ar: "العميل الذي يفتح المنصة لا يرى إلا الأصول الموجودة في مبانيه.",
      },
      {
        en: "You can see every fault ever raised against one asset, which is what tells you when to replace it rather than repair it again.",
        ar: "يمكنك رؤية كل عطل سُجِّل على أصل واحد، وهو ما يدلّك على موعد استبداله بدل إصلاحه مجددًا.",
      },
    ],
  },
  {
    id: "preventive",
    title: { en: "Planned maintenance", ar: "الصيانة الوقائية" },
    summary: {
      en: "The visits you promised to make, and whether you made them.",
      ar: "الزيارات التي وعدت بها، وهل نفّذتها فعلاً.",
    },
    scenarios: [
      {
        en: "You schedule a visit against an asset — daily, weekly, monthly, quarterly or yearly — and assign it to a technician.",
        ar: "تجدول زيارة على أصل — يومية أو أسبوعية أو شهرية أو ربع سنوية أو سنوية — وتُسندها إلى فني.",
      },
      {
        en: "A visit due in the next few days is marked as coming up, so it is visible before it is late.",
        ar: "تُعلَّم الزيارة المستحقة خلال الأيام القادمة بأنها قادمة، فتظهر قبل أن تتأخر.",
      },
      {
        en: "A visit whose date has passed shows as overdue on its own — nobody has to mark it.",
        ar: "الزيارة التي مضى موعدها تظهر متأخرة من تلقاء نفسها — لا يحتاج أحد إلى تعليمها.",
      },
      {
        en: "A technician starts the job, works through its checklist, and completes it; the completion date is recorded.",
        ar: "يبدأ الفني العمل، ويمرّ على قائمة التحقق، ثم يُنهيه؛ ويُسجَّل تاريخ الإنجاز.",
      },
      {
        en: "A completed visit stops being overdue, even if it was finished late.",
        ar: "الزيارة المنجزة تتوقف عن كونها متأخرة، حتى لو أُنجزت متأخرة.",
      },
      {
        en: "The compliance figure tells you what share of the visits that fell due were actually done.",
        ar: "يخبرك مؤشر الالتزام بنسبة الزيارات المستحقة التي أُنجزت فعلاً.",
      },
    ],
  },
  {
    id: "corrective",
    title: { en: "Faults and work orders", ar: "الأعطال وأوامر العمل" },
    summary: {
      en: "Something broke. This is the queue that gets it fixed and proves it was.",
      ar: "حدث عطل. هذه هي القائمة التي تُصلحه وتُثبت أنه أُصلح.",
    },
    scenarios: [
      {
        en: "You raise a fault against an asset, set how urgent it is, and it enters the queue unassigned.",
        ar: "تسجّل عطلاً على أصل، وتحدّد درجة إلحاحه، فيدخل القائمة دون إسناد.",
      },
      {
        en: "A critical fault is visibly different from a low one, at a glance, without reading.",
        ar: "العطل الحرج يختلف بصريًا عن العطل المنخفض الأهمية بنظرة واحدة دون قراءة.",
      },
      {
        en: "A job cannot be closed until somebody owns it, so every closed job can answer the question 'who did this work'.",
        ar: "لا يمكن إغلاق أي عمل قبل أن يتولاه شخص، فيستطيع كل عمل مغلق الإجابة عن سؤال «من نفّذ هذا العمل».",
      },
      {
        en: "A job waiting on a part or on access is put on hold with a reason, rather than sitting silently open.",
        ar: "العمل الذي ينتظر قطعة غيار أو تصريح دخول يوضع قيد الانتظار مع ذكر السبب، بدل بقائه مفتوحًا بلا تفسير.",
      },
      {
        en: "A closed job stays closed. Work that turns out to be unfinished is raised again as a new job, so the record of what happened stays readable.",
        ar: "العمل المغلق يبقى مغلقًا. وأي عمل يتبيّن أنه لم يكتمل يُسجَّل من جديد كعمل جديد، فيبقى سجل ما حدث واضحًا.",
      },
      {
        en: "A client can see the faults in their own buildings and how far along each one is.",
        ar: "يستطيع العميل رؤية الأعطال في مبانيه ومدى تقدّم كل واحد منها.",
      },
    ],
  },
  {
    id: "checklists",
    title: { en: "Checklists", ar: "قوائم التحقق" },
    summary: {
      en: "What a technician actually has to do on site, and proof that they did it.",
      ar: "ما يجب على الفني فعله في الموقع فعلاً، والإثبات على أنه فعله.",
    },
    scenarios: [
      {
        en: "You build a checklist once — the steps for an AHU service, say — and use it on every job of that kind.",
        ar: "تبني قائمة تحقق مرة واحدة — خطوات صيانة وحدة مناولة هواء مثلاً — وتستخدمها في كل عمل من هذا النوع.",
      },
      {
        en: "Some steps are required and some are not, and the required ones must be done before the job can be finished.",
        ar: "بعض الخطوات إلزامية وبعضها لا، ويجب إنجاز الإلزامية قبل إنهاء العمل.",
      },
      {
        en: "A technician ticks items as they go and can add a note against any one of them.",
        ar: "يؤشّر الفني على البنود أثناء العمل، ويستطيع إضافة ملاحظة على أي بند منها.",
      },
      {
        en: "A half-finished run shows how much is left, so a supervisor can see progress without phoning.",
        ar: "الجولة نصف المنجزة تُظهر ما تبقّى، فيرى المشرف التقدّم دون اتصال هاتفي.",
      },
      {
        en: "Changing a checklist later does not disturb the runs already completed against the old one.",
        ar: "تعديل قائمة التحقق لاحقًا لا يمسّ الجولات المنجزة سابقًا على النسخة القديمة.",
      },
    ],
  },
  {
    id: "approvals",
    title: { en: "Approvals", ar: "الاعتمادات" },
    summary: {
      en: "Work goes from the person who did it, up to the client, and only then becomes an invoice.",
      ar: "ينتقل العمل من الشخص الذي نفّذه صعودًا إلى العميل، وعندها فقط يصبح فاتورة.",
    },
    scenarios: [
      {
        en: "Finished work enters a chain: the technician confirms it, the supervisor checks it, the manager approves it, the client accepts it, and then it can be billed.",
        ar: "يدخل العمل المنجز سلسلة: يؤكّده الفني، ويراجعه المشرف، ويعتمده المدير، ويقبله العميل، ثم يمكن إصدار فاتورته.",
      },
      {
        en: "Each step is taken by the person it belongs to. Nobody can approve on somebody else's behalf.",
        ar: "تُتَّخذ كل خطوة من الشخص الذي تخصّه. ولا يستطيع أحد الاعتماد نيابة عن غيره.",
      },
      {
        en: "Not even an administrator can approve in place of the client. That signature is the customer's alone.",
        ar: "حتى المسؤول لا يستطيع الاعتماد بدلاً من العميل. فذلك التوقيع للعميل وحده.",
      },
      {
        en: "Steps cannot be skipped. Work moves forward one stage at a time.",
        ar: "لا يمكن تخطي الخطوات. يتقدّم العمل مرحلة واحدة في كل مرة.",
      },
      {
        en: "Anything rejected stops there with the reason attached, and the reason is required.",
        ar: "كل ما يُرفض يتوقف عند تلك المرحلة مع ذكر السبب، والسبب إلزامي.",
      },
      {
        en: "The full history stays readable — who approved what and when — and nothing in it can be overwritten.",
        ar: "يبقى السجل الكامل واضحًا — من اعتمد ماذا ومتى — ولا يمكن تعديل أي شيء فيه.",
      },
    ],
  },
  {
    id: "contracts",
    title: { en: "Maintenance contracts", ar: "عقود الصيانة" },
    summary: {
      en: "The annual agreements behind the work, and enough warning before they run out.",
      ar: "الاتفاقيات السنوية التي يقوم عليها العمل، وتنبيه كافٍ قبل انتهائها.",
    },
    scenarios: [
      {
        en: "You record a contract for a client with its value, its type and its dates.",
        ar: "تسجّل عقدًا لعميل بقيمته ونوعه وتواريخه.",
      },
      {
        en: "A contract that has not started yet shows as upcoming, not as active.",
        ar: "العقد الذي لم يبدأ بعد يظهر كعقد قادم، لا كعقد نشط.",
      },
      {
        en: "A contract ending within two months is flagged as expiring, with time left to renew it.",
        ar: "يُعلَّم العقد المنتهي خلال شهرين بأنه قارب على الانتهاء، مع وقت كافٍ لتجديده.",
      },
      {
        en: "Values are shown in riyals with proper separators, so a six-figure contract cannot be misread.",
        ar: "تُعرض القيم بالريال بفواصل صحيحة، فلا يُقرأ عقد بستة أرقام قراءة خاطئة.",
      },
      {
        en: "A contract can be suspended or cancelled, and the record of it stays.",
        ar: "يمكن تعليق العقد أو إلغاؤه، ويبقى سجلّه محفوظًا.",
      },
      {
        en: "A client sees their own contracts and cannot change them.",
        ar: "يرى العميل عقوده الخاصة ولا يستطيع تعديلها.",
      },
    ],
  },
  {
    id: "invoicing",
    title: { en: "Invoicing and VAT", ar: "الفوترة وضريبة القيمة المضافة" },
    summary: {
      en: "Bills that come out of approved work, with the tax worked out for you.",
      ar: "فواتير تنشأ من عمل معتمد، مع احتساب الضريبة نيابةً عنك.",
    },
    scenarios: [
      {
        en: "You enter an amount and the platform works out 15% VAT and the total. You are never asked to type either.",
        ar: "تُدخل المبلغ فتحتسب المنصة ضريبة ١٥٪ والإجمالي. ولا يُطلب منك إدخال أي منهما.",
      },
      {
        en: "Because nobody types the tax, no invoice in the system can carry the wrong one.",
        ar: "ولأن أحدًا لا يُدخل الضريبة يدويًا، لا يمكن لأي فاتورة أن تحمل ضريبة خاطئة.",
      },
      {
        en: "Amounts are rounded to the halala, never to a fraction of one.",
        ar: "تُقرَّب المبالغ إلى الهللة، ولا تُترك كسورًا منها أبدًا.",
      },
      {
        en: "You raise an invoice directly from work the client has already approved, and it cannot be billed twice.",
        ar: "تُصدر الفاتورة مباشرة من عمل اعتمده العميل، ولا يمكن فوترته مرتين.",
      },
      {
        en: "An invoice past its due date shows as overdue on its own, and stops as soon as it is settled.",
        ar: "الفاتورة التي تجاوزت تاريخ استحقاقها تظهر متأخرة تلقائيًا، وتتوقف عن ذلك بمجرد سدادها.",
      },
      {
        en: "Every invoice downloads as a PDF that reads correctly in Arabic and in English.",
        ar: "تُحمَّل كل فاتورة بصيغة PDF تُقرأ بشكل صحيح بالعربية والإنجليزية.",
      },
      {
        en: "One client can never open another client's invoice, even with the exact link.",
        ar: "لا يستطيع عميل فتح فاتورة عميل آخر أبدًا، حتى بالرابط المباشر.",
      },
    ],
  },
  {
    id: "field",
    title: { en: "The technician on site", ar: "الفني في الموقع" },
    summary: {
      en: "A phone screen for somebody standing in a plant room, not a desktop squeezed small.",
      ar: "شاشة هاتف لمن يقف في غرفة معدات، لا شاشة مكتب مضغوطة.",
    },
    scenarios: [
      {
        en: "A technician opens the app and sees their own jobs for today — nobody else's.",
        ar: "يفتح الفني التطبيق فيرى أعماله لهذا اليوم — لا أعمال غيره.",
      },
      {
        en: "They check in at the start of the shift and out at the end, and the times are recorded.",
        ar: "يسجّل الحضور في بداية الوردية والانصراف في نهايتها، وتُسجَّل الأوقات.",
      },
      {
        en: "Location is only ever recorded if they agree to it. Refusing still lets them check in.",
        ar: "لا يُسجَّل الموقع إلا بموافقته. ورفضه لا يمنعه من تسجيل الحضور.",
      },
      {
        en: "One check-in per person per day, so attendance cannot be recorded twice.",
        ar: "تسجيل حضور واحد لكل شخص في اليوم، فلا يُسجَّل الحضور مرتين.",
      },
      {
        en: "Buttons are big enough to press with gloves on, and everything is readable in daylight.",
        ar: "الأزرار كبيرة بما يكفي للضغط عليها بالقفازات، وكل شيء مقروء تحت ضوء النهار.",
      },
      {
        en: "A technician cannot record attendance or work in anybody else's name.",
        ar: "لا يستطيع الفني تسجيل حضور أو عمل باسم شخص آخر.",
      },
    ],
  },
  {
    id: "insight",
    title: { en: "Dashboard and reports", ar: "لوحة المعلومات والتقارير" },
    summary: {
      en: "The numbers a manager is asked about, taken from the work itself.",
      ar: "الأرقام التي يُسأل عنها المدير، مأخوذة من العمل نفسه.",
    },
    scenarios: [
      {
        en: "The figures on the dashboard match what you count on the screens beneath them.",
        ar: "الأرقام في لوحة المعلومات تطابق ما تعدّه في الشاشات التي تحتها.",
      },
      {
        en: "Raise a job and the dashboard reflects it — nothing on it is an example figure.",
        ar: "سجّل عملاً جديدًا فتعكسه لوحة المعلومات — ولا يوجد فيها أي رقم توضيحي.",
      },
      {
        en: "A brand-new company sees zeroes and empty states rather than sample data.",
        ar: "الشركة الجديدة تمامًا ترى أصفارًا وحالات فارغة بدلاً من بيانات تجريبية.",
      },
      {
        en: "The planned-maintenance report shows what was due, what was done, and the gap.",
        ar: "يعرض تقرير الصيانة الوقائية ما كان مستحقًا وما أُنجز والفارق بينهما.",
      },
      {
        en: "The asset report ranks equipment by condition, so the replacement conversation starts from evidence.",
        ar: "يرتّب تقرير الأصول المعدات حسب حالتها، فيبدأ نقاش الاستبدال من دليل.",
      },
      {
        en: "The financial report is for management only; a supervisor cannot reach it by any route.",
        ar: "التقرير المالي للإدارة فقط؛ ولا يستطيع المشرف الوصول إليه بأي طريقة.",
      },
      {
        en: "Every report downloads as a PDF that matches what is on screen.",
        ar: "يُحمَّل كل تقرير بصيغة PDF مطابقة لما يظهر على الشاشة.",
      },
    ],
  },
  {
    id: "ai",
    title: { en: "Written insights", ar: "الملاحظات المكتوبة" },
    summary: {
      en: "A short written read of your own maintenance data, for managers only.",
      ar: "قراءة مكتوبة موجزة لبيانات صيانتك، للإدارة فقط.",
    },
    scenarios: [
      {
        en: "A manager asks for an analysis and gets a few paragraphs about their actual assets and jobs.",
        ar: "يطلب المدير تحليلاً فيحصل على فقرات قليلة عن أصوله وأعماله الفعلية.",
      },
      {
        en: "It is written from counts and dates only — no client names, no staff names, no money leaves your company.",
        ar: "يُكتب من الأعداد والتواريخ فقط — فلا تغادر شركتك أسماء عملاء ولا أسماء موظفين ولا مبالغ.",
      },
      {
        en: "A supervisor, a technician and a client cannot reach it at all.",
        ar: "لا يستطيع المشرف ولا الفني ولا العميل الوصول إليه إطلاقًا.",
      },
      {
        en: "If the feature is not switched on for your deployment, the screen says so plainly instead of failing.",
        ar: "إذا لم تكن الميزة مفعّلة في تثبيتك، تقول الشاشة ذلك بوضوح بدلاً من أن تتعطل.",
      },
    ],
  },
  {
    id: "notifications",
    title: {
      en: "Being told before it is late",
      ar: "التنبيه قبل فوات الأوان",
    },
    summary: {
      en: "The two things that quietly go wrong are a missed visit and a contract nobody renewed.",
      ar: "الأمران اللذان يسوءان بصمت هما زيارة فائتة وعقد لم يجدّده أحد.",
    },
    scenarios: [
      {
        en: "An overdue planned visit raises a notice, and it appears on the bell in the top bar.",
        ar: "تُنشئ الزيارة الوقائية المتأخرة تنبيهًا، ويظهر على الجرس في الشريط العلوي.",
      },
      {
        en: "A contract approaching its end raises one too, with time left to act.",
        ar: "والعقد الذي يقارب نهايته يُنشئ تنبيهًا كذلك، مع وقت كافٍ للتصرف.",
      },
      {
        en: "The same problem never raises the same notice twice, however often the check runs.",
        ar: "لا تُنشئ المشكلة نفسها التنبيه نفسه مرتين، مهما تكرر الفحص.",
      },
      {
        en: "Marking a notice read affects only you; your colleague still sees it as unread.",
        ar: "تعليم التنبيه كمقروء يخصّك وحدك؛ ويبقى زميلك يراه غير مقروء.",
      },
    ],
  },
  {
    id: "files",
    title: { en: "Photos and documents", ar: "الصور والمستندات" },
    summary: {
      en: "Evidence attached to the work, and kept to the people entitled to see it.",
      ar: "أدلة مرفقة بالعمل، ومحفوظة لمن يحق لهم الاطلاع عليها.",
    },
    scenarios: [
      {
        en: "You attach photos and PDFs to an asset, and they appear as thumbnails you can open.",
        ar: "تُرفق الصور وملفات PDF بالأصل، فتظهر كصور مصغّرة يمكنك فتحها.",
      },
      {
        en: "File types that could carry something harmful are refused, and renaming one does not get it past.",
        ar: "تُرفض أنواع الملفات التي قد تحمل شيئًا ضارًا، وإعادة تسميتها لا تُمرّرها.",
      },
      {
        en: "Photographs are stripped of hidden data such as the location they were taken.",
        ar: "تُنزع من الصور البيانات المخفية مثل موقع التقاطها.",
      },
      {
        en: "An attachment opens only for someone signed in to the company it belongs to — the link alone is not enough.",
        ar: "لا يُفتح المرفق إلا لمن سجّل الدخول إلى الشركة التي يخصّها — والرابط وحده لا يكفي.",
      },
    ],
  },
  {
    id: "language",
    title: { en: "English and Arabic", ar: "الإنجليزية والعربية" },
    summary: {
      en: "The whole product in both languages, not a translated shell over an English app.",
      ar: "المنتج كاملاً بلغتين، لا واجهة مترجمة فوق تطبيق إنجليزي.",
    },
    scenarios: [
      {
        en: "You switch language on any screen and stay on the same screen, in the other language.",
        ar: "تبدّل اللغة في أي شاشة فتبقى في الشاشة نفسها باللغة الأخرى.",
      },
      {
        en: "In Arabic the entire layout mirrors — navigation, tables, arrows, the lot.",
        ar: "في العربية تنعكس الواجهة بالكامل — التنقل والجداول والأسهم وكل شيء.",
      },
      {
        en: "Error messages, buttons and empty screens are translated too, not only the headings.",
        ar: "رسائل الخطأ والأزرار والشاشات الفارغة مترجمة أيضًا، لا العناوين فقط.",
      },
      {
        en: "Dates and riyal amounts read correctly in both, and PDFs render Arabic properly.",
        ar: "التواريخ والمبالغ بالريال تُقرأ بشكل صحيح في اللغتين، وملفات PDF تعرض العربية بشكل سليم.",
      },
    ],
  },
  {
    id: "separation",
    title: { en: "Your data stays yours", ar: "بياناتك تبقى لك" },
    summary: {
      en: "The promise underneath everything else. It is checked the same way on every screen in the product.",
      ar: "الوعد الذي يقوم عليه كل ما سبق. ويُتحقَّق منه بالطريقة نفسها في كل شاشة في المنتج.",
    },
    scenarios: [
      {
        en: "Two companies using the platform never see each other's assets, jobs, contracts or invoices — not greyed out, not there at all.",
        ar: "الشركتان اللتان تستخدمان المنصة لا ترى أي منهما أصول الأخرى ولا أعمالها ولا عقودها ولا فواتيرها — ليست باهتة، بل غير موجودة.",
      },
      {
        en: "Holding the exact address of another company's record does not open it. It reads as not found.",
        ar: "امتلاك العنوان المباشر لسجلّ شركة أخرى لا يفتحه. بل يظهر كأنه غير موجود.",
      },
      {
        en: "Searching never returns a result from another company, and no total on any screen counts one.",
        ar: "لا يُرجع البحث نتيجة من شركة أخرى أبدًا، ولا يحتسبها أي إجمالي في أي شاشة.",
      },
      {
        en: "Within one company, a client contact sees only their own buildings — the same rule, one level down.",
        ar: "وداخل الشركة الواحدة، لا يرى ممثّل العميل إلا مبانيه — القاعدة نفسها على مستوى أدنى.",
      },
      {
        en: "The rule is enforced in one place that every screen goes through, so a screen added next year is covered by the same check.",
        ar: "تُطبَّق القاعدة في مكان واحد تمرّ به كل الشاشات، فتشمل الشاشةَ التي تُضاف العام القادم بالفحص نفسه.",
      },
    ],
  },
];

/** Every scenario in the document, for the count in the page heading. */
export const TOTAL_SCENARIOS = SCENARIO_GROUPS.reduce(
  (total, group) => total + group.scenarios.length,
  0,
);
