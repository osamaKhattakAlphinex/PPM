import "server-only";

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { getServerEnv } from "@/lib/env";

/**
 * Object storage, behind one interface and two drivers.
 *
 * The interface is deliberately tiny — put, get, delete, by KEY — because that
 * is all this product needs and because a small surface is one that both
 * drivers can implement identically. There is no `list`, and its absence is a
 * property rather than an omission: nothing in the app enumerates a bucket, so
 * a bug cannot enumerate one either. What exists is what the `Attachment`
 * collection says exists, and that collection is tenant-scoped.
 *
 * Neither driver is a public URL. A tenant's file is served only through
 * `/api/files/[id]`, which authenticates, resolves the row through the SCOPED
 * repository and streams the bytes — so an object with no reachable row is
 * unreadable even by its own tenant. CLAUDE.md is explicit about this: "no
 * public bucket URLs for tenant data".
 */

export interface StoredObject {
  data: Uint8Array;
  contentType: string;
}

export interface StorageDriver {
  readonly name: string;
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  remove(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Local disk
// ---------------------------------------------------------------------------

/**
 * The development driver: files under a directory on the host.
 *
 * Not a production store — a serverless host has no durable disk, and a
 * multi-instance host has a different one per instance — but the right default
 * for `pnpm dev`, because the alternative is that nobody can exercise the
 * upload path without an S3 account.
 *
 * The key is re-checked here even though `storageKeyFor()` generates it. Two
 * layers, because this is the one place a string becomes a filesystem path: a
 * key containing `..` would escape the root, and the fact that nothing
 * currently produces one is a property of today's callers rather than of this
 * function.
 */
function localDriver(root: string): StorageDriver {
  function resolve(key: string): string {
    if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes("..") || key.startsWith("/")) {
      throw new Error("unsafe storage key");
    }

    const full = path.join(root, key);

    // Belt and braces: even a key that passed the pattern must resolve inside
    // the root. `path.resolve` normalises, so this catches anything the regex
    // did not anticipate.
    const resolvedRoot = path.resolve(root);
    if (!path.resolve(full).startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error("storage key escapes the root");
    }

    return full;
  }

  return {
    name: "local",

    async put(key, data) {
      const full = resolve(key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, data);
    },

    async get(key) {
      try {
        const data = await readFile(resolve(key));
        return {
          data: new Uint8Array(data),
          /**
           * The content type is NOT read back from disk: it is stored on the
           * `Attachment` row, which is the record of what the server decided
           * this file was after sniffing it. Trusting an extension here would
           * undo that check.
           */
          contentType: "application/octet-stream",
        };
      } catch {
        // Missing, unreadable, or outside the root. All the same answer: the
        // route turns null into a 404 rather than distinguishing them.
        return null;
      }
    },

    async remove(key) {
      try {
        await unlink(resolve(key));
      } catch {
        // Already gone is the desired end state.
      }
    },
  };
}

// ---------------------------------------------------------------------------
// S3-compatible
// ---------------------------------------------------------------------------

/**
 * The production driver: any S3-compatible endpoint — AWS, Cloudflare R2,
 * MinIO, Backblaze.
 *
 * The client is imported LAZILY, inside the factory, so a deployment running on
 * local disk never loads the AWS SDK at all. That is worth the awkwardness: the
 * SDK is one of the largest dependencies in the tree, and a dev server should
 * not pay for a driver it is not using.
 */
function s3Driver(config: {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
}): StorageDriver {
  const client = import("@aws-sdk/client-s3").then(
    (module) =>
      new module.S3Client({
        region: config.region,
        ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      }),
  );

  return {
    name: "s3",

    async put(key, data, contentType) {
      const [module, s3] = await Promise.all([import("@aws-sdk/client-s3"), client]);

      await s3.send(
        new module.PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: data,
          ContentType: contentType,
          /**
           * Private, explicitly. Most buckets default to private, and the ones
           * that do not are exactly the ones this line exists for — a tenant's
           * file must never be readable by URL.
           */
          ACL: "private",
        }),
      );
    },

    async get(key) {
      const [module, s3] = await Promise.all([import("@aws-sdk/client-s3"), client]);

      try {
        const response = await s3.send(
          new module.GetObjectCommand({ Bucket: config.bucket, Key: key }),
        );

        const bytes = await response.Body?.transformToByteArray();
        if (!bytes) return null;

        return {
          data: bytes,
          // As with the local driver: the authoritative type is the one stored
          // on the row, not the one the bucket reports back.
          contentType: response.ContentType ?? "application/octet-stream",
        };
      } catch {
        return null;
      }
    },

    async remove(key) {
      const [module, s3] = await Promise.all([import("@aws-sdk/client-s3"), client]);

      try {
        await s3.send(new module.DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
      } catch {
        // Already gone is the desired end state.
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

let cached: StorageDriver | undefined;

/**
 * The configured driver.
 *
 * S3 when a bucket and credentials are present, local disk otherwise. The
 * choice is made from the ENVIRONMENT rather than from a flag, so there is no
 * way to be running against local disk in production because somebody forgot to
 * flip something — either the bucket variables are set or they are not.
 *
 * Memoised, because the S3 client holds a connection pool and building one per
 * request would leak sockets under load.
 */
export function getStorage(): StorageDriver {
  if (cached) return cached;

  const env = getServerEnv();

  if (env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) {
    cached = s3Driver({
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    });
  } else {
    cached = localDriver(env.UPLOAD_DIR);
  }

  return cached;
}

/** Test-only: forget the memoised driver so a suite can re-read the env. */
export function resetStorageCache(): void {
  cached = undefined;
}
