import { z } from "zod";

import { coordinatesSchema } from "@/lib/domain/attendance";

/**
 * The two attendance payloads.
 *
 * A module of their own rather than living beside the actions, because
 * `actions.ts` is `"use server"` and pulls the data-access layer and next-auth
 * — a unit test cannot import it, and the rules below are exactly the part
 * worth testing.
 *
 * Two properties are asserted directly in `__tests__/attendance.test.ts`, and
 * both are product promises rather than implementation details:
 *
 *  1. **Location is never recorded without consent.** The refinement refuses
 *     coordinates that arrive without `consent: true`, so the refusal happens
 *     during parsing rather than inside a handler somebody might edit.
 *  2. **A phone cannot choose a timestamp.** There is no field for one, on
 *     either payload. The server stamps the time from the request it just
 *     authorised — a timestamp a device could choose is not evidence that
 *     anybody was anywhere.
 *
 * Likewise there is no `technicianId`: the technician is resolved from the
 * SESSION, and resolving one from the session only means anything if a caller
 * cannot name a different one.
 */
const attendancePayload = z
  .strictObject({
    consent: z.coerce.boolean().default(false),
    coordinates: coordinatesSchema.optional(),
    note: z.string().trim().max(280).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.coordinates && !input.consent) {
      ctx.addIssue({
        code: "custom",
        // Keyed to the field so the form can highlight the checkbox rather than
        // showing a general error next to a map.
        path: ["consent"],
        message: "Location cannot be recorded without consent.",
      });
    }
  });

export const checkInSchema = attendancePayload;
export const checkOutSchema = attendancePayload;

export type AttendancePayload = z.infer<typeof attendancePayload>;
