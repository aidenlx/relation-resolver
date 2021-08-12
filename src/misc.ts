import assertNever from "assert-never";
import { Map, Set } from "immutable";

import { File_Types, Operation, RelationType } from "./api";

export const isRelType = (val: unknown): val is RelationType =>
  val === "direct" || val === "implied";
export const revertRelType = (type: RelationType): RelationType =>
  type === "direct" ? "implied" : "direct";

export type AlterOp = Set<RelationType> | RelationType;
// parentsCache: {
//   // File_Parents
//   file1: {
//     // File_Types
//     parent1: [out, in],
//     parent2: [out],
//   },
//   file2: {
//     parent1: [in],
//   }
// }

// tools
export function getToggle(op: Operation, type: "direct"): AlterOp;
export function getToggle(
  op: Operation,
  type: "implied",
  targetPath: string,
): Map<string, AlterOp>;
// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
export function getToggle(
  op: Operation,
  type: RelationType,
  targetPath?: string,
): AlterOp | Map<string, AlterOp> {
  let types: AlterOp;
  if (op === "add") {
    types = Set<RelationType>([type]);
  } else if (op === "remove") {
    types = type;
  } else assertNever(op);

  if (type === "implied") {
    if (!targetPath) throw new Error("No targetPath given when setting toggle");
    return Map({ [targetPath]: types });
  } else if (type === "direct") {
    return types;
  } else assertNever(type);
}
