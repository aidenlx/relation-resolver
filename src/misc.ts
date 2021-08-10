import assertNever from "assert-never";
import { Map, Set } from "immutable";

import { File_Types, Operation } from "./api";

// types
export const enum LinkType {
  /** outgoing, defined within the target file */
  out = "out",
  /** incoming link to target file, defined in external file */
  in = "in",
}

export const isLinkType = (val: unknown): val is LinkType =>
  ["in", "out"].includes(val as string);

export type AlterOp = Set<LinkType> | LinkType;
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
export type File_Parents = Map<string /*filePath*/, File_Types>;

// tools
export function getToggle(op: Operation, type: LinkType.out): AlterOp;
export function getToggle(
  op: Operation,
  type: LinkType.in,
  targetPath: string,
): Map<string, AlterOp>;
// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
export function getToggle(
  op: Operation,
  type: LinkType,
  targetPath?: string,
): AlterOp | Map<string, AlterOp> {
  let types: AlterOp;
  if (op === "add") {
    types = Set<LinkType>([type]);
  } else if (op === "remove") {
    types = type;
  } else assertNever(op);

  if (type === LinkType.in) {
    if (!targetPath) throw new Error("No targetPath given when setting toggle");
    return Map({ [targetPath]: types });
  } else if (type === LinkType.out) {
    return types;
  } else assertNever(type);
}
