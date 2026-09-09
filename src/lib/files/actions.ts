"use server";

import { z } from "zod";

import { defineAction, type ActionResult } from "@/lib/security/action";
import { objectIdString } from "@/lib/validation/primitives";
import { deleteAttachment, UPLOADERS } from "./service";

/**
 * Removing a file.
 *
 * A server action rather than a route, because unlike the upload it carries no
 * bytes — an id and nothing else. `deleteAttachment` resolves the row through
 * the SCOPED repository first, so an id from another tenant is a 404 and the
 * object store is never asked about it.
 *
 * Uploaders only. A customer may READ files about their own equipment (see
 * `FILE_READERS`) and may not delete the provider's evidence of work done.
 */
const deleteSchema = z.strictObject({ id: objectIdString });

const runDelete = defineAction({
  name: "deleteAttachment",
  roles: UPLOADERS,
  input: deleteSchema,
  async handler({ input, scope }): Promise<{ id: string }> {
    await deleteAttachment(scope, input.id);
    return { id: input.id };
  },
});

export async function deleteAttachmentAction(
  payload: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runDelete(payload);
}
