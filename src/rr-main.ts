import flat from "array.prototype.flat";
import assertNever from "assert-never";
import { isSet, List, Map, Set } from "immutable";
import { App, Plugin, PluginManifest } from "obsidian";
import { debounce, TFile } from "obsidian";
import {
  DEFAULT_SETTINGS,
  RelationResolverSettings,
  RelationResolverSettingTab,
} from "settings";

import {
  ChangeInfo,
  File_Parents,
  File_Types,
  Operation,
  RelationInField,
  RelationResolverAPI,
  RelationType,
} from "./api";
import { getPathsFromField, getPathsFromFm } from "./get-field";
import { AlterOp, getToggle, isRelType, revertRelType } from "./misc";

const SELF_REF_ID = ":";

export default class RelationResolver extends Plugin {
  settings: RelationResolverSettings = DEFAULT_SETTINGS;

  // @ts-ignore
  parentsCache: File_Parents = Map();
  // @ts-ignore
  fmCache: Map<string, Map<RelationInField, Set<string> | null>> = Map();
  get metadataCache() {
    return this.app.metadataCache;
  }
  get vault() {
    return this.app.vault;
  }

  filesToUpdate: TFile[] = [];
  update = debounce(
    () => {
      this.updateCache(this.filesToUpdate);
      this.filesToUpdate.length = 0;
    },
    2e3,
    true,
  );
  trigger(
    name: "relation:changed",
    info: ChangeInfo,
    api: RelationResolver["api"],
  ): void;
  trigger(name: "relation:resolved", api: RelationResolver["api"]): void;
  trigger(name: string, ...data: any[]): void {
    this.metadataCache.trigger(name, ...data);
  }

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
    this.registerEvent(
      this.metadataCache.on("initialized", () => {
        this.updateCache();
      }),
    );
    if (this.metadataCache.initialized) this.updateCache();

    this.registerEvent(
      this.metadataCache.on("changed", (file) => {
        if (file.extension === "md") {
          if (this.filesToUpdate.every((f) => f.path !== file.path))
            this.filesToUpdate.push(file);
          this.update();
        }
      }),
    );
    this.registerEvent(
      this.vault.on("delete", (file) => {
        if (file instanceof TFile && file.extension === "md")
          this.deleteFromCache(file.path);
      }),
    );
    this.registerEvent(
      this.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile && file.extension === "md") {
          this.deleteFromCache(oldPath);
          // set delay for renamed file to load cache
          setTimeout(() => {
            this.updateCacheForFilenames(file.basename);
            this.setCacheFromFile(file, true, true);
          }, 1e3);
        }
      }),
    );
    // this.metadataCache.on("relation:resolved", (api) => {
    //   console.log("relation:resolved", api);
    // });
    // this.metadataCache.on(
    //   "relation:changed",
    //   ({ relation, op, affected }, api) => {
    //     console.log(relation + op, affected.toJS(), api);
    //   },
    // );
  }
  deleteFromCache(filePath: string) {
    const parents = this.parentsCache.get(filePath) ?? null;
    let children: File_Types | null = Map().asMutable() as File_Types;
    this.parentsCache = this.parentsCache
      .delete(filePath)
      .withMutations((m) => {
        let parents, types;
        for (const key of m.keys()) {
          if ((parents = m.get(key)) && (types = parents.get(filePath))) {
            const deleted = parents.delete(filePath);
            if (deleted.isEmpty()) m.delete(key);
            else m.set(key, deleted);
            children?.set(key, types);
          }
        }
      });
    children = children.isEmpty() ? null : children.asImmutable();
    const affectedP = Map<string, File_Types>().withMutations((m) => {
      if (parents) m.set(filePath, parents);
      if (children)
        m.merge(children.map((types) => Map({ [filePath]: types })));
    });
    const affectedC = Map<string, File_Types>().withMutations((m) => {
      if (children)
        m.set(
          filePath,
          children.map((types) => types.map((t) => revertRelType(t))),
        );
      if (parents)
        m.merge(
          parents.map((types) =>
            Map({ [filePath]: types.map((t) => revertRelType(t)) }),
          ),
        );
    });
    const op = "remove";
    this.trigger(
      "relation:changed",
      { op, relation: "parents", affected: affectedP },
      this.api,
    );
    this.trigger(
      "relation:changed",
      { op, relation: "children", affected: affectedC },
      this.api,
    );
  }
  /**
   * Update cache with files that includes given paths in fields
   * @param findFor filename to match (no extension)
   */
  updateCacheForFilenames(...findFor: string[]): void {
    const matched = (field: unknown) =>
      !!(
        field &&
        Array.isArray(field) &&
        flat(field, Infinity).some(
          (val) =>
            typeof val === "string" &&
            findFor.some((name) => val.includes(name)),
        )
      );
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm) continue;
      const { fieldNames } = this.settings;
      if (
        matched(fm[fieldNames["parents"]]) ||
        matched(fm[fieldNames["children"]])
      )
        this.setCacheFromFile(file, true, true);
    }
  }

  async onload() {
    console.log("loading relation-resolver");
    await this.loadSettings();
    this.addSettingTab(new RelationResolverSettingTab(this.app, this));
  }
  onunload() {
    console.log("unloading relation-resolver");
  }
  async loadSettings() {
    this.settings = { ...this.settings, ...(await this.loadData()) };
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }

  api: RelationResolverAPI = {
    getParentsOf: (filePath) => {
      return this.parentsCache.get(filePath)?.keySeq().toSet() ?? null;
    },
    getParentsWithTypes: (filePath) => {
      return this.parentsCache.get(filePath, null);
    },
    getChildrenOf: (filePath) => {
      const result = this.parentsCache
        .filter((ft) => ft.has(filePath))
        .keySeq();
      return result.isEmpty() ? null : result.toSet();
    },
    getChildrenWithTypes: (filePath) => {
      const result = this.parentsCache
        .toSeq()
        .filter((ft) => ft.has(filePath))
        .map((ft) =>
          (ft.get(filePath) as Set<RelationType>).map((t) => revertRelType(t)),
        );
      return result.isEmpty() ? null : result.toMap();
    },
    getSiblingsOf: (filePath) => {
      const set = this.api.getParentsOf(filePath);
      if (!set) return null;

      const result = set
        .reduce((newSet, path) => {
          let children = this.api.getChildrenOf(path);
          if (children) return newSet.union(children);
          else return newSet;
        }, Set<string>())
        .delete(filePath);
      return result.isEmpty() ? null : result;
    },
    getPaths: (rel, filePath, endingPaths) => {
      let allPaths = List<List<string>>().asMutable();
      const getMap = (target: string): Map<string, any> | null =>
        // @ts-ignore
        this.getMap(target, rel) as Map<string, any> | null;

      const iter = (target: string, childPath: List<string>) => {
        const children = getMap(target);
        if (children)
          for (const filePath of children.keys()) {
            if (childPath.includes(filePath))
              // prevent self reference
              allPaths.push(childPath.push(filePath + SELF_REF_ID));
            else if (endingPaths?.includes(filePath))
              allPaths.push(childPath.push(filePath));
            else iter(filePath, childPath.push(filePath));
          }
        else if (
          childPath.size > 1 &&
          (!endingPaths || endingPaths.includes(childPath.last()))
        )
          allPaths.push(childPath);
      };

      iter(filePath, List<string>([filePath]));
      return allPaths.isEmpty() ? null : allPaths.asImmutable();
    },
    getAllRelNodesFrom: (rel, filePath, endingPaths) => {
      const paths = this.api.getPaths(rel, filePath, endingPaths);
      if (paths) {
        const nodeIds = (paths.flatten() as List<string>)
            .toSeq()
            .filterNot((v) => v.endsWith(SELF_REF_ID))
            .toSet(),
          excludes = paths
            .toSeq()
            .filter((path) => path.last()?.endsWith(SELF_REF_ID))
            .map((path) => {
              const tuple = path // selfRefPaths tuple
                .takeLast(2)
                .update(-1, (v) => (v as string).slice(0, -1));
              return rel === "parents"
                ? tuple
                : rel === "children"
                ? tuple.reverse()
                : assertNever(rel);
            })
            .reduce(
              (map, [key, exclude]) =>
                map.update(key, (set) =>
                  set ? set.add(exclude) : Set([exclude]),
                ),
              Map<string, Set<string>>(),
            );
        let parents;
        return nodeIds.toMap().map(
          (filePath): File_Types | null =>
            (parents = this.parentsCache
              .get(filePath)
              ?.deleteAll(excludes.get(filePath) ?? [])) && !parents.isEmpty()
              ? parents
              : null, // top nodes
        );
      } else return null;
    },
  };

  private getMap(target: string, rel: "parents"): File_Types | null;
  private getMap(target: string, rel: "children"): File_Parents | null;
  private getMap(
    target: string,
    rel: "parents" | "children",
  ): File_Parents | File_Types | null {
    const parents =
      rel === "parents"
        ? this.parentsCache.get(target)
        : rel === "children"
        ? this.parentsCache.filter((ft) => ft.has(target))
        : assertNever(rel);
    if (parents && !parents.isEmpty()) return parents;
    else return null;
  }

  /**
   * @param files force update entire cache when not given
   */
  updateCache(files?: TFile | TFile[]) {
    const updateAll = files === undefined;
    files = files
      ? Array.isArray(files)
        ? files
        : [files]
      : this.app.vault.getMarkdownFiles();
    if (updateAll) this.parentsCache = this.parentsCache.clear();
    for (const file of files) {
      this.setCacheFromFile(file, !updateAll);
    }
    if (updateAll) this.trigger("relation:resolved", this.api);
  }

  /**
   * Update parent/children from file with given function to get raw fields
   * @param file file to get fields
   * @param forceFetch true to fetch files even if fm are the same
   * @param getValFunc function to get vaild filepaths from file
   * @returns affected files
   */
  private updateParent(
    key: "parents" | "children",
    file: TFile,
    getValFunc: getPathsFromField,
    forceFetch: boolean,
  ): [added: Set<string> | null, removed: Set<string> | null] {
    const targetPath = file.path;

    let added: Set<string> | null, removed: Set<string> | null;
    // get from children field
    const fmPaths = getValFunc.call(this, key, file, forceFetch);
    if (fmPaths !== false) {
      type mergeMap = Map<string, Map<string, AlterOp>>;
      /** get all cached relation for given file and marked them remove */
      const fetchFromCache = (): mergeMap => {
        let tree: mergeMap;
        if (key === "parents") {
          const type = "direct",
            fillWith = getToggle("remove", type);
          const srcParents = this.parentsCache.get(targetPath);
          tree = Map<string, Map<string, AlterOp>>();
          if (srcParents)
            tree = tree.set(
              targetPath,
              srcParents.filter((types) => types.has(type)).map(() => fillWith),
            );
          return tree;
        } else if (key === "children") {
          const type = "implied",
            fillWith = getToggle("remove", type, targetPath);
          return this.parentsCache
            .filter((parents) => !!parents.get(targetPath)?.has(type))
            .map(() => fillWith);
        } else assertNever(key);
      };
      /** fetch relation from file's fm and mark them add */
      const fetchFromFile = (
        tree: mergeMap,
      ): [fetched: mergeMap, added: Set<string>] => {
        if (fmPaths !== null) {
          let addFromPaths: mergeMap, added: Set<string>;
          if (key === "parents") {
            const type = "direct",
              fillWith = getToggle("add", type);
            addFromPaths = Map<string, Map<string, AlterOp>>().withMutations(
              (m) =>
                fmPaths.isEmpty() ||
                m.set(
                  targetPath,
                  fmPaths.toMap().map(() => fillWith),
                ),
            );
            added = fmPaths.subtract(tree.get(targetPath)?.keySeq() ?? []);
          } else if (key === "children") {
            const type = "implied",
              fillWith = getToggle("add", type, targetPath);
            addFromPaths = fmPaths.toMap().map(() => fillWith);
            added = fmPaths.subtract(tree.keySeq());
          } else assertNever(key);
          return [tree.mergeDeep(addFromPaths), added];
        } else return [tree, Set()];
      };
      const [newTree, a] = fetchFromFile(fetchFromCache());

      added = a;
      // get removed
      if (key === "parents") {
        const entry = newTree.get(targetPath);
        if (entry) {
          removed = entry
            .filter((v) => !isSet(v))
            .keySeq()
            .toSet();
        } else if (newTree.isEmpty()) removed = Set();
        else
          throw new Error(
            "No entry for targetPath & not empty when setiing up parent",
          );
      } else if (key === "children") {
        removed = newTree
          .filter((v) => v.has(targetPath) && !isSet(v.get(targetPath)))
          .keySeq()
          .toSet();
      } else assertNever(key);

      // merge into parentCache
      if (!newTree.isEmpty()) {
        const merge = (oldVal: unknown, newVal: unknown, key: unknown) => {
          if (isRelType(newVal) && isSet(oldVal)) return oldVal.delete(newVal);
          else {
            console.warn(`unexpected merge: @${key}, %o -> %o`, oldVal, newVal);
            return newVal;
          }
        };
        // @ts-ignore
        this.parentsCache = this.parentsCache.mergeDeepWith(merge, newTree);

        // delete key with empty types
        if (removed && !removed.isEmpty()) {
          const keys = removed;
          if (key === "parents")
            this.parentsCache = this.parentsCache.update(
              targetPath,
              // @ts-ignore
              (entry) => {
                return entry?.withMutations((m) =>
                  keys.forEach((key) => m.get(key)?.isEmpty() && m.delete(key)),
                );
              },
            );
          else if (key === "children")
            this.parentsCache = this.parentsCache.withMutations((m) =>
              keys.forEach((key) => {
                if ((m.getIn([key, targetPath]) as Set<RelationType>).isEmpty())
                  m.deleteIn([key, targetPath]);
              }),
            );
          else assertNever(key);
        }
      }
    } else {
      added = null;
      removed = null;
    }

    return [added, removed];
  }

  /** Read relation defined in given file and update relationCache */
  private setCacheFromFile(file: TFile, triggerEvt = true, forceFetch = false) {
    const [addedP, removedP] = this.updateParent(
      "parents",
      file,
      getPathsFromFm,
      forceFetch,
    );
    const [addedC, removedC] = this.updateParent(
      "children",
      file,
      getPathsFromFm,
      forceFetch,
    );
    if (triggerEvt) {
      type from = Set<string> | null;
      const notEmpty = (set: from): set is Set<string> =>
        !!set && !set.isEmpty();
      const fillWithI = Map({ [file.path]: Set(["implied"]) }),
        fillWithD = Set<RelationType>(["direct"]);
      const trigger = (op: Operation, fromC: from, fromP: from) => {
        const getAffectednSend = (relation: "parents" | "children") => {
          let direct: from, implied: from;
          if (relation === "parents") {
            direct = fromP;
            implied = fromC;
          } else if (relation === "children") {
            direct = fromC;
            implied = fromP;
          } else assertNever(relation);
          const affected = Map<string, File_Types>().withMutations((m) => {
            if (notEmpty(direct))
              m.set(
                file.path,
                direct.toMap().map(() => fillWithD),
              );
            if (implied) m.merge(implied.toMap().map(() => fillWithI));
          });
          if (!affected.isEmpty())
            this.trigger(
              "relation:changed",
              { op, relation, affected },
              this.api,
            );
        };
        if (notEmpty(fromC) || notEmpty(fromP)) {
          getAffectednSend("parents");
          getAffectednSend("children");
        }
      };
      trigger("add", addedC, addedP);
      trigger("remove", removedC, removedP);
    }
    // console.log(
    //   `parents of ${targetPath} added: %o, parents of ${targetPath} removed: %o`,
    //   addedC?.toJS(),
    //   removedC?.toJS(),
    // );
    // console.log(
    //   `added parent ${targetPath} to %o, removed parent ${targetPath} from %o`,
    //   addedP?.toJS(),
    //   removedP?.toJS(),
    // );
  }
}
