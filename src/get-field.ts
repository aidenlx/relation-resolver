/* eslint-disable prefer-arrow/prefer-arrow-functions */
import flat from "array.prototype.flat";
import assertNever from "assert-never";
import { is, Seq, Set } from "immutable";
import { Notice, TFile } from "obsidian";
import { DataviewApi, Link } from "obsidian-dataview";

import RelationResolver from "./rr-main";

export type getPathsFromField = (
  this: RelationResolver,
  key: "parents" | "children",
  file: TFile,
  forceFetch: boolean,
) => Set<string> | null | false;

type getLinktext = (
  key: "parents" | "children",
  file: TFile,
  plugin: RelationResolver,
) => Set<string> | null;

/** Get getPathsFromField function with given method to get linktext */
export const getGPFF = (getLinktext: getLinktext): getPathsFromField =>
  /**
   * Get vaild paths from given key with given method
   * @param forceFetch true to fetch files even if fm are the same
   * @returns false if no changes in frontmatter; null if given key not exists
   */
  function (key, file, forceFetch) {
    const val = getLinktext(key, file, this),
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
      return val
        .map(toVaildPath)
        .filter<string>((v): v is string => v !== null);
    }
  };

export const getLTFromFm: getLinktext = (key, file, plugin) => {
  const fm = plugin.metadataCache.getFileCache(file)?.frontmatter;
  if (fm) {
    const val = fm[plugin.settings.fieldNames[key]];
    if (typeof val === "string") return Set([val]);
    if (Array.isArray(val)) return Set(flat(val, Infinity));
  }
  return null;
};

export const registerFmEvents = (plugin: RelationResolver) => {
  plugin.registerEvent(
    plugin.metadataCache.on("initialized", () => {
      plugin.updateCache();
    }),
  );
  if (plugin.metadataCache.initialized) plugin.updateCache();

  plugin.registerEvent(
    plugin.metadataCache.on("changed", (file) => {
      if (file.extension === "md") {
        if (plugin.filesToUpdate.every((f) => f.path !== file.path))
          plugin.filesToUpdate.push(file);
        plugin.update();
      }
    }),
  );
  plugin.registerEvent(
    plugin.vault.on("delete", (file) => {
      if (file instanceof TFile && file.extension === "md")
        plugin.deleteFromCache(file.path);
    }),
  );
  plugin.registerEvent(
    plugin.vault.on("rename", (file, oldPath) => {
      if (file instanceof TFile && file.extension === "md") {
        plugin.deleteFromCache(oldPath);
        // set delay for renamed file to load cache
        setTimeout(() => {
          plugin.updateCacheForFilenames(file.basename);
          plugin.setCacheFromFile(file, true, true);
        }, 1e3);
      }
    }),
  );
};

interface util {
  isString(val: any): val is string;
  isLink(val: any): val is Link;
}

export const getLTFromDv: getLinktext = (key, file, plugin) => {
  const api = plugin.DvApi;
  if (!api) throw new Error("call getPathsFromDv when api not available");
  const fm = api.page(file.path);
  if (fm) {
    const val = fm[plugin.settings.fieldNames[key]];

    let util: util;
    if (!api.valueUtil) {
      util = {
        isString: (val: any): val is string => typeof val === "string",
        isLink: (val: any): val is Link =>
          Boolean(
            val.path &&
              typeof val.path === "string" &&
              val.type &&
              ["file", "header", "block"].includes(val.type),
          ),
      };
    } else util = api.valueUtil;

    const isAcceptable = (val: any): val is Link | string =>
      util.isString(val) || (util.isLink(val) && val.type === "file");
    const mapToPath = (val: Link | string): string =>
      util.isLink(val) ? val.path : val;
    if (isAcceptable(val)) return Set([mapToPath(val)]);
    if (Array.isArray(val))
      return Seq(flat(val, Infinity))
        .filter<Link | string>(isAcceptable)
        .map(mapToPath)
        .toSet();
  }
  return null;
};

export const registerDvEvents = (plugin: RelationResolver) => {
  const init = (api: DataviewApi) => {
    plugin.updateCache();
    if (!api.valueUtil)
      new Notice(
        `Please upgrade to Dataview v0.4.5+, using fallback method for now`,
      );
  };
  plugin.registerEvent(plugin.metadataCache.on("dataview:api-ready", init));
  if (plugin.DvApi) init(plugin.DvApi);

  plugin.registerEvent(
    plugin.metadataCache.on("dataview:metadata-change", (...args) => {
      switch (args[0]) {
        case "rename": {
          const [, file, oldPath] = args;
          if (file instanceof TFile && file.extension === "md") {
            plugin.deleteFromCache(oldPath);
            // set delay for renamed file to load cache
            setTimeout(() => {
              plugin.updateCacheForFilenames(file.basename);
              plugin.setCacheFromFile(file, true, true);
            }, 1e3);
          }
          break;
        }
        case "delete": {
          const [, file] = args;
          if (file instanceof TFile && file.extension === "md")
            plugin.deleteFromCache(file.path);
          break;
        }
        case "update": {
          const [, file] = args;
          if (file.extension === "md") {
            if (plugin.filesToUpdate.every((f) => f.path !== file.path))
              plugin.filesToUpdate.push(file);
            plugin.update();
          }
          break;
        }
        default:
          assertNever(args);
      }
    }),
  );
};
