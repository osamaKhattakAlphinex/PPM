"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn";
import { Skeleton } from "./skeleton";

export type TableColumn<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
};

export interface TableProps<T extends { id: string | number }> {
  columns: TableColumn<T>[];
  data: T[];
  isLoading?: boolean;
  skeletonRows?: number;
  emptyState?: ReactNode;
  className?: string;
}

const STAGGER_LIMIT = 10;

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.03, delayChildren: 0.02 } },
};

const rowVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.16, ease: "easeOut" as const } },
};

export function Table<T extends { id: string | number }>({
  columns,
  data,
  isLoading,
  skeletonRows = 5,
  emptyState,
  className,
}: TableProps<T>) {
  if (isLoading) {
    return <TableSkeleton columns={columns} rows={skeletonRows} />;
  }

  if (data.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div className={className}>
      {/* Tablet and up: real table */}
      <div className="hidden overflow-x-auto rounded-md border border-border md:block">
        <table className="w-full text-start text-sm">
          <thead className="bg-surface-sunken">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    "px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                    column.className
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <motion.tbody initial="hidden" animate="visible" variants={containerVariants}>
            {data.map((row, index) => (
              <motion.tr
                key={row.id}
                variants={index < STAGGER_LIMIT ? rowVariants : undefined}
                className="border-t border-border transition-colors hover:bg-surface-sunken/60"
              >
                {columns.map((column) => (
                  <td key={column.key} className={cn("px-4 py-3 text-foreground", column.className)}>
                    {column.cell(row)}
                  </td>
                ))}
              </motion.tr>
            ))}
          </motion.tbody>
        </table>
      </div>

      {/* Mobile: stacked cards */}
      <motion.div
        className="grid gap-3 md:hidden"
        initial="hidden"
        animate="visible"
        variants={containerVariants}
      >
        {data.map((row, index) => (
          <motion.div
            key={row.id}
            variants={index < STAGGER_LIMIT ? rowVariants : undefined}
            className="rounded-md border border-border bg-surface p-4"
          >
            {columns.map((column) => (
              <div
                key={column.key}
                className="flex items-center justify-between gap-4 border-b border-border py-2 text-sm last:border-b-0 last:pb-0 first:pt-0"
              >
                <span className="text-muted-foreground">{column.header}</span>
                <span className="text-end text-foreground">{column.cell(row)}</span>
              </div>
            ))}
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}

function TableSkeleton<T>({ columns, rows }: { columns: TableColumn<T>[]; rows: number }) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="grid gap-3 p-4">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className="grid grid-cols-4 gap-4">
            {columns.slice(0, 4).map((column, colIndex) => (
              <Skeleton key={column.key} className={cn("h-5", colIndex === 0 && "w-3/4")} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
