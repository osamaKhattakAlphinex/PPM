import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/guard";
import { assetsRepository, connectToDatabase } from "@/lib/db";
import { ASSET_READERS } from "@/lib/assets/queries";
import { listAttachmentViews, UPLOADERS } from "@/lib/files/service";
import { AttachmentsPanel } from "../../../_components/attachments-panel";
import { PageHeading } from "../../../_components/page-heading";

/**
 * The photographs and documents attached to one asset.
 *
 * A route under `/app/assets`, so it inherits that module's access rule from
 * `ROUTE_ACCESS` without a new entry — the rule matches on prefix. The guard
 * here is the one that matters, and it is the ASSET module's reader list rather
 * than the file module's: somebody who cannot see the asset has no business
 * seeing what is attached to it, whatever their file permissions say.
 *
 * The asset itself is then re-read through the SCOPED repository, so an id
 * belonging to another tenant is a 404 rather than an empty gallery — the page
 * never renders a heading for equipment the caller cannot see.
 */
export default async function AssetFilesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user, scope } = await requireRole(...ASSET_READERS);

  const { id } = await params;

  await connectToDatabase();

  const asset = await assetsRepository
    .forScope(scope)
    .findById(id, { select: ["_id", "name", "category"] });

  // Out of scope, soft-deleted, or a malformed id. All the same answer.
  if (!asset) notFound();

  const attachments = await listAttachmentViews(scope, "ASSET", asset._id.toHexString());

  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeading title={asset.name} subtitle={asset.category} />

      <AttachmentsPanel
        refType="ASSET"
        refId={asset._id.toHexString()}
        initial={attachments}
        /**
         * Uploading is narrower than reading: a customer may look at the
         * photograph of their chiller's nameplate and may not add to, or
         * remove from, the provider's record of the work.
         */
        canUpload={(UPLOADERS as readonly string[]).includes(user.role)}
      />
    </div>
  );
}
