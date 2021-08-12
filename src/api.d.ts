import "obsidian";

import { List, Map, Set } from "immutable";

export interface RelationResolverAPI {
  getParentsOf: (filePath: string) => Set<string> | null;
  getParentsWithTypes: (filePath: string) => File_Types | null;
  getChildrenOf: (filePath: string) => Set<string> | null;
  getChildrenWithTypes: (filePath: string) => File_Types | null;
  getSiblingsOf: (filePath: string) => Set<string> | null;
  /**
   * Get path from given file to top parents/bottom children
   * @param endingPaths get paths ends with given files if given
   * @returns self reference if last filepath ends with ":"
   */
  getPaths: (
    rel: "parents" | "children",
    filePath: string,
    endingPaths?: string[],
  ) => List<List<string>> | null;
  getAllRelNodesFrom: (
    rel: "parents" | "children",
    filePath: string,
    endingPaths?: string[],
  ) => FlatHierarchyMap | null;
}

/**
 * direct: outgoing link, defined within the target file;
 * implied: incoming link to target file, defined in external file
 */
export type RelationType = "direct" | "implied";
export type RelationInField = "parents" | "children" | "siblings";
export type File_Types = Map<string /* parentPath */, Set<RelationType>>;
export type File_Parents = Map<string /*filePath*/, File_Types>;
export type FlatHierarchyMap = Map<string /*filePath*/, File_Types | null>;

export type Operation = "add" | "remove";

export type ChangeInfo = {
  op: Operation;
  relation: RelationInField;
  /** affected target and the list of added/removed relation files(parents/...) */
  affected: Map<string, File_Types>;
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
