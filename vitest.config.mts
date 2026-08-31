import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // argon2 is deliberately slow (19 MiB, 2 passes); a handful of real hashes
    // in the password suite comfortably outruns the 5s default.
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      /**
       * `server-only` throws on import outside a React Server Component, which
       * is the whole point of the package — and would make any suite that pulls
       * in a guarded module fail at import time. Vitest gets the same empty
       * module the `react-server` condition resolves to in a real RSC build.
       */
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
});
