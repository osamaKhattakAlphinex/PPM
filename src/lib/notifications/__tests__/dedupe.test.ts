import { describe, expect, it } from "vitest";

import { EXPIRING_WINDOW_DAYS } from "@/lib/domain/amc";
import {
  CONTRACT_NOTICE_DAYS,
  dedupeKeyFor,
  MAX_UNREAD_COUNT,
  NOTIFICATION_KINDS,
  NOTIFICATION_REF_TYPES,
  REF_HREF,
} from "@/lib/domain/notifications";
import { MODULES } from "@/lib/nav/modules";

/**
 * What makes the nightly job safe to run twice.
 *
 * The job's idempotency is enforced by a partial unique index on
 * `{ organizationId, dedupeKey }`, so the property worth testing without a
 * database is the KEY: two runs on the same day must produce the same key for
 * the same fact, and a genuinely new fact must produce a different one.
 *
 * Pure: no database, no session.
 */

const VISIT = "0123456789abcdef01234567";
const CONTRACT = "0123456789abcdef0123456a";

describe("dedupeKeyFor", () => {
  it("is stable for the same fact, however often the job runs", () => {
    const due = new Date("2026-03-01T00:00:00.000Z");

    expect(dedupeKeyFor("PPM_OVERDUE", VISIT, due)).toBe(
      dedupeKeyFor("PPM_OVERDUE", VISIT, due),
    );
  });

  /**
   * The bucket is a DAY, so the same fact read at any hour produces one key —
   * which matters because a job that runs at 02:00 and is re-run at 02:40 after
   * a timeout must not notify twice.
   */
  it("ignores the time of day within the bucket", () => {
    expect(
      dedupeKeyFor("PPM_OVERDUE", VISIT, new Date("2026-03-01T00:00:00.000Z")),
    ).toBe(dedupeKeyFor("PPM_OVERDUE", VISIT, new Date("2026-03-01T23:59:00.000Z")));
  });

  it("separates two visits that are late on the same day", () => {
    const due = new Date("2026-03-01T00:00:00.000Z");
    const other = "0123456789abcdef0123456b";

    expect(dedupeKeyFor("PPM_OVERDUE", VISIT, due)).not.toBe(
      dedupeKeyFor("PPM_OVERDUE", other, due),
    );
  });

  it("separates two kinds of notification about the same row", () => {
    const day = new Date("2026-03-01T00:00:00.000Z");

    expect(dedupeKeyFor("PPM_OVERDUE", CONTRACT, day)).not.toBe(
      dedupeKeyFor("CONTRACT_EXPIRING", CONTRACT, day),
    );
  });

  /**
   * The renewal case, which is the reason the contract bucket is the END DATE
   * rather than today: a contract renewed for another year is a NEW fact and
   * should notify again when the new term approaches.
   */
  it("treats a renewed contract as a new fact", () => {
    const thisYear = new Date("2026-06-30T00:00:00.000Z");
    const nextYear = new Date("2027-06-30T00:00:00.000Z");

    expect(dedupeKeyFor("CONTRACT_EXPIRING", CONTRACT, thisYear)).not.toBe(
      dedupeKeyFor("CONTRACT_EXPIRING", CONTRACT, nextYear),
    );
  });

  it("fits the field the model bounds", () => {
    const key = dedupeKeyFor("CONTRACT_EXPIRING", CONTRACT, new Date());
    expect(key.length).toBeLessThanOrEqual(160);
    expect(key.length).toBeGreaterThanOrEqual(3);
  });
});

describe("the notice window", () => {
  /**
   * The bell and the AMC screen must agree about which contracts are expiring:
   * a notification for a contract the screen still calls healthy would be a
   * false alarm, and silence about one the screen has flagged would be worse.
   */
  it("is the same window the AMC screen calls EXPIRING", () => {
    expect(CONTRACT_NOTICE_DAYS).toBe(EXPIRING_WINDOW_DAYS);
  });
});

describe("where a notification links to", () => {
  it("covers every reference type", () => {
    expect(Object.keys(REF_HREF).sort()).toEqual([...NOTIFICATION_REF_TYPES].sort());
  });

  /**
   * A link the reader cannot open is worse than no link. Every destination must
   * be a real module route — asserted against the nav table rather than against
   * a list of strings restated here.
   */
  it("points at a real module route", () => {
    const modules = MODULES;
    const hrefs = new Set(modules.map((entry) => entry.href));

    for (const href of Object.values(REF_HREF)) {
      expect(hrefs.has(href), `${href} is not a module route`).toBe(true);
    }
  });
});

describe("the vocabulary", () => {
  it("stays short enough that the bell is worth reading", () => {
    // The argument in the domain module: a bell that fires for everything is a
    // bell nobody reads. If a third kind is added, this is the reminder to
    // justify it.
    expect(NOTIFICATION_KINDS).toHaveLength(2);
  });

  it("caps the badge where the display does", () => {
    expect(MAX_UNREAD_COUNT).toBe(100);
  });
});
