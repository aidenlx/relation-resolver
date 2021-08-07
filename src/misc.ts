import assertNever from "assert-never";
import { Map, Set } from "immutable";

// types
export enum LinkType {
  /** outgoing, defined within the target file */
  out,
  /** incoming link to target file, defined in external file */
  in,
}
/** Defined in front-matter/ Dataview inline fields*/
export type SoftLink = LinkType.in | LinkType.out;
export type RelationInField = "parents" | "children" | "siblings";
export type Operation = "add" | "remove";
export type AlterOp = Set<SoftLink> | SoftLink;
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
export type File_Types = Map<string /* parentPath */, Set<SoftLink>>;

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
  type: SoftLink,
  targetPath?: string,
): AlterOp | Map<string, AlterOp> {
  let types: AlterOp;
  if (op === "add") {
    types = Set<SoftLink>([type]);
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
