"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";
import { FileText, Paperclip, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { deleteAttachmentAction } from "@/lib/files/actions";
import type { AttachmentView } from "@/lib/files/service";
import {
  ALLOWED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  type AttachmentRefType,
} from "@/lib/domain/files";

/**
 * Photographs and documents attached to one thing.
 *
 * The upload goes to `/api/files` as multipart rather than through a server
 * action, because it is a FILE: the route can refuse an oversized body from its
 * `Content-Length` before reading it, which an action cannot.
 *
 * Every thumbnail's `src` is `/api/files/<id>` — the authenticated, scoped
 * route — and never a storage URL. There is no storage URL: the object store is
 * private and the app never mints a link to it, so an image that renders here
 * is one this session was entitled to fetch.
 */

/** The accept attribute, built from the same allow-list the server enforces. */
const ACCEPT = Object.keys(ALLOWED_UPLOAD_TYPES).join(",");

export function AttachmentsPanel({
  refType,
  refId,
  initial,
  canUpload,
}: {
  refType: AttachmentRefType;
  refId: string;
  initial: AttachmentView[];
  /** Decided on the server from the session's role. An affordance, not the control. */
  canUpload: boolean;
}) {
  const t = useTranslations("files");
  const format = useFormatter();
  const { toast } = useToast();

  const [items, setItems] = useState(initial);
  const [isUploading, setUploading] = useState(false);
  const [isDeleting, startDeleting] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    /**
     * Checked here as well as on the server, and the server's check is the one
     * that counts. This exists so somebody who picks a 40MB video is told
     * immediately rather than after uploading it over a site connection.
     */
    if (file.size > MAX_UPLOAD_BYTES) {
      toast({ title: t("tooLarge"), variant: "danger" });
      return;
    }

    const body = new FormData();
    body.set("file", file);
    body.set("refType", refType);
    body.set("refId", refId);

    setUploading(true);
    try {
      const response = await fetch("/api/files", { method: "POST", body });
      const payload: unknown = await response.json().catch(() => null);

      if (
        response.ok &&
        typeof payload === "object" &&
        payload !== null &&
        "data" in payload
      ) {
        setItems((current) => [(payload as { data: AttachmentView }).data, ...current]);
        toast({ title: t("uploaded"), variant: "success" });
        return;
      }

      const message =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof (payload as { error?: { fields?: Record<string, string>; message?: string } })
          .error === "object"
          ? ((payload as { error: { fields?: Record<string, string>; message?: string } }).error
              .fields?.file ??
            (payload as { error: { message?: string } }).error.message ??
            t("failed"))
          : t("failed");

      toast({ title: message, variant: "danger" });
    } catch {
      toast({ title: t("failed"), variant: "danger" });
    } finally {
      setUploading(false);
      // Cleared so the same file can be chosen twice — a browser fires no
      // change event for an identical selection otherwise.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function remove(id: string) {
    startDeleting(async () => {
      const response = await deleteAttachmentAction({ id });

      if (response.ok) {
        setItems((current) => current.filter((item) => item.id !== id));
        toast({ title: t("deleted"), variant: "success" });
        return;
      }

      toast({ title: response.error.message, variant: "danger" });
    });
  }

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
          <Paperclip className="size-4 text-accent-text" aria-hidden />
          {t("title")}
        </h3>

        {canUpload && (
          <>
            {/*
              A hidden input driven by a real Button, rather than a styled
              `<label>`: the app's Button is a motion.button with the focus ring
              and the 44px touch target already correct, and a label styled to
              look like it would have neither.
            */}
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <Button
              size="sm"
              isLoading={isUploading}
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="size-4" aria-hidden />
              {t("upload")}
            </Button>
          </>
        )}
      </div>

      <p className="mb-4 text-xs text-muted-foreground">{t("hint")}</p>

      {items.length === 0 ? (
        <EmptyState icon={Paperclip} title={t("empty")} description={t("emptyBody")} />
      ) : (
        <motion.ul
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
          initial="hidden"
          animate="visible"
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.03 } } }}
        >
          <AnimatePresence initial={false}>
            {items.map((item) => (
              <motion.li
                key={item.id}
                layout
                variants={{
                  hidden: { opacity: 0, y: 6 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.18 } },
                }}
                exit={{ opacity: 0, scale: 0.96 }}
                className="group relative overflow-hidden rounded-md border border-border bg-surface"
              >
                <a
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  {item.isImage ? (
                    /**
                     * `next/image` with `unoptimized`, deliberately.
                     *
                     * The optimiser would fetch this URL from the server's own
                     * runtime, which carries no session cookie — so every
                     * thumbnail would 401. The component is still worth using
                     * for the layout and lazy-loading behaviour; the
                     * optimisation is what has to go.
                     */
                    <Image
                      src={item.href}
                      alt={item.filename}
                      width={320}
                      height={240}
                      unoptimized
                      className="aspect-4/3 w-full object-cover"
                    />
                  ) : (
                    <span className="flex aspect-4/3 w-full items-center justify-center bg-surface-sunken">
                      <FileText className="size-8 text-muted-foreground" aria-hidden />
                    </span>
                  )}

                  <span className="block truncate px-2 py-1.5 text-xs text-foreground" title={item.filename}>
                    {item.filename}
                  </span>
                  <span className="block px-2 pb-2 text-[11px] tabular-nums numeric-isolate text-muted-foreground">
                    {format.number(Math.max(1, Math.round(item.size / 1024)))} KB
                  </span>
                </a>

                {canUpload && (
                  <button
                    type="button"
                    onClick={() => remove(item.id)}
                    disabled={isDeleting}
                    aria-label={`${t("delete")} — ${item.filename}`}
                    className="absolute end-1 top-1 grid size-8 place-items-center rounded-md bg-background/80 text-danger opacity-0 backdrop-blur-sm transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      )}
    </section>
  );
}
