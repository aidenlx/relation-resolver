import "obsidian";

import { Map, Set } from "immutable";

export interface RelationResolverAPI {
  getParentsOf: (filePath: string) => Set<string> | null;
  getParentsWithTypes: (filePath: string) => File_Types | null;
  getChildrenOf: (filePath: string) => Set<string> | null;
  getChildrenWithTypes: (filePath: string) => File_Types | null;
  getSiblingsOf: (filePath: string) => Set<string> | null;
}

/**
 * out: outgoing link, defined within the target file;
 * in: incoming link to target file, defined in external file
 */
export type RelationType = "in" | "out";
export type RelationInField = "parents" | "children" | "siblings";
export type File_Types = Map<string /* parentPath */, Set<RelationType>>;
export type Operation = "add" | "remove";

export type ChangeInfo = {
  op: Operation;
  relation: RelationInField;
  affected: Set<string>;
};

declare module "obsidian" {
  interface MetadataCache {
    on(
      name: "relation:changed",
      callback: (info: ChangeInfo, api: RelationResolverAPI) => any,
      ctx?: any,
    ): EventRef;
    on(
      name: "relation:resolved",
      callback: (api: RelationResolverAPI) => any,
      ctx?: any,
    ): EventRef;
  }
}
