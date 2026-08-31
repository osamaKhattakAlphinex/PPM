import { ESLint, Linter } from "eslint";
import { describe, expect, it } from "vitest";

import {
  restrictedDatabaseImports,
  restrictedModelCallSyntax,
} from "../../../../eslint-rules/dal-boundary.mjs";

/**
 * The lint boundary is a security control, so it gets tested like one: these
 * cases fail if the selector stops matching a bypass, and equally if it starts
 * matching ordinary code (a rule everyone disables protects nothing).
 */

const linter = new Linter();

function lint(code: string): Linter.LintMessage[] {
  return linter.verify(code, {
    languageOptions: { ecmaVersion: 2022, sourceType: "module" },
    rules: {
      "no-restricted-syntax": ["error", ...restrictedModelCallSyntax],
      "no-restricted-imports": ["error", restrictedDatabaseImports],
    },
  });
}

describe("the DAL boundary rule catches direct model access", () => {
  const bypasses = [
    ["find", "const rows = await WorkOrder.find({ status: 'OPEN' });"],
    ["findOne", "const row = await WorkOrder.findOne({ _id: id });"],
    ["findById", "const row = await WorkOrder.findById(id);"],
    ["findByIdAndUpdate", "await WorkOrder.findByIdAndUpdate(id, patch);"],
    ["findOneAndUpdate", "await WorkOrder.findOneAndUpdate({ _id: id }, patch);"],
    ["updateOne", "await WorkOrder.updateOne({ _id: id }, patch);"],
    ["updateMany", "await WorkOrder.updateMany({}, patch);"],
    ["deleteOne", "await WorkOrder.deleteOne({ _id: id });"],
    ["deleteMany", "await WorkOrder.deleteMany({});"],
    ["insertMany", "await WorkOrder.insertMany(rows);"],
    ["countDocuments", "await WorkOrder.countDocuments({});"],
    ["distinct", "await WorkOrder.distinct('status');"],
    ["aggregate", "await WorkOrder.aggregate([{ $match: {} }]);"],
    ["bulkWrite", "await WorkOrder.bulkWrite(ops);"],
    ["watch", "WorkOrder.watch();"],
    ["mongoose.model", "const M = mongoose.model('WorkOrder');"],
    ["mongoose.connection", "await mongoose.connection.db.collection('x').find({});"],
  ] as const;

  for (const [label, code] of bypasses) {
    it(`flags ${label}`, () => {
      const messages = lint(code);

      expect(messages).toHaveLength(1);
      expect(messages[0]?.ruleId).toBe("no-restricted-syntax");
      expect(messages[0]?.message).toMatch(/createRepository/);
    });
  }

  it("flags importing mongoose", () => {
    const messages = lint("import mongoose from 'mongoose';");

    expect(messages[0]?.ruleId).toBe("no-restricted-imports");
    expect(messages[0]?.message).toMatch(/@\/lib\/db/);
  });

  it("flags importing a model module, aliased or not", () => {
    expect(lint("import { WorkOrder } from '@/lib/db/models/work-order';")).toHaveLength(1);
    expect(lint("import { WorkOrder as W } from '../../lib/db/models/work-order';")).toHaveLength(1);
  });
});

describe("the DAL boundary rule leaves ordinary code alone", () => {
  const allowed = [
    ["Array.prototype.find on a lowercase receiver", "const row = rows.find((r) => r.id === id);"],
    ["a repository call", "const rows = await repo.find({ status: 'OPEN' });"],
    ["a map lookup", "const value = cache.get(key);"],
    ["React component usage", "const el = Button.displayName;"],
    ["importing the DAL itself", "import { createRepository } from '@/lib/db';"],
    ["importing a repository module", "import { workOrders } from '@/lib/repositories/work-order';"],
  ] as const;

  for (const [label, code] of allowed) {
    it(`allows ${label}`, () => {
      expect(lint(code)).toEqual([]);
    });
  }
});

describe("the project's real eslint config enforces the boundary", () => {
  it("errors on direct model access in feature code but not inside src/lib/db", async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    const code = "export async function load(id) { return WorkOrder.findById(id); }\n";

    const [featureFile] = await eslint.lintText(code, {
      filePath: "src/app/work-orders/actions.js",
    });
    const [dalFile] = await eslint.lintText(code, {
      filePath: "src/lib/db/repository-internal.js",
    });

    expect(
      featureFile?.messages.filter((message) => message.ruleId === "no-restricted-syntax"),
    ).toHaveLength(1);
    expect(
      dalFile?.messages.filter((message) => message.ruleId === "no-restricted-syntax"),
    ).toHaveLength(0);
  }, 60_000);
});
