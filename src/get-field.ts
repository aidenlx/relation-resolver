import flat from "array.prototype.flat";
import { is, Set } from "immutable";
import { TFile } from "obsidian";

import RelationResolver from "./rr-main";

export type getPathsFromField = (
  this: RelationResolver,
  key: "parents" | "children",
  file: TFile,
  forceFetch: boolean,
) => Set<string> | null | false;

/**
 * Get vaild paths from given key of file's frontmatter
 * @param forceFetch true to fetch files even if fm are the same
 * @returns false if no changes in frontmatter; null if given key not exists
 */
export function getPathsFromFm(
  this: RelationResolver,
  key: "parents" | "children",
  file: TFile,
  forceFetch: boolean,
): Set<string> | null | false {
  const getLinktext = (): Set<string> | null => {
      const fm = this.metadataCache.getFileCache(file)?.frontmatter;
      if (fm) {
        const val = fm[this.settings.fieldNames[key]];
        if (typeof val === "string") return Set([val]);
        if (Array.isArray(val)) return Set(flat(val, Infinity));
      }
      return null;
    },
    val = getLinktext(),
    targetPath = file.path;

  let cachedFm = this.fmCache.getIn([targetPath, key]) as
    | Set<string>
    | null
    | undefined;
  if (!forceFetch && cachedFm !== undefined && is(val, cachedFm)) {
    return false;
  } else {
    this.fmCache = this.fmCache.setIn([targetPath, key], val);
  }

  if (!val) return null;
  else {
    const toVaildPath = (val: string) => {
      if (!val) return null;
      const vaildPath = this.metadataCache.getFirstLinkpathDest(
        val,
        targetPath,
      );
      if (!vaildPath)
        console.warn(
          `Fail to get file from linktext ${val}, skipping... location: file ${targetPath} field ${this.settings.fieldNames[key]}`,
        );
      return vaildPath?.path ?? null;
    };
    return val.map(toVaildPath).filter<string>((v): v is string => v !== null);
  }
}
