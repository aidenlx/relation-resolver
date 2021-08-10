import assertNever from "assert-never";
import { isSet, Map, Set } from "immutable";
import { App, Plugin, PluginManifest } from "obsidian";
import { debounce, TFile } from "obsidian";
import {
  DEFAULT_SETTINGS,
  RelationResolverSettings,
  RelationResolverSettingTab,
} from "settings";

import {
  ChangeInfo,
  Operation,
  RelationInField,
  RelationResolverAPI,
} from "./api";
import { getPathsFromField, getPathsFromFm } from "./get-field";
import { AlterOp, File_Parents, getToggle, isLinkType, LinkType } from "./misc";

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
        .toSeq()
        .filter((ft) => ft.has(filePath))
        .keySeq();
      return result.isEmpty() ? null : result.toSet();
    },
    getChildrenWithTypes: (filePath) => {
      const revert = (type: LinkType) =>
        type === LinkType.in ? LinkType.out : LinkType.in;
      const result = this.parentsCache
        .toSeq()
        .filter((ft) => ft.has(filePath))
        .map((ft) => (ft.get(filePath) as Set<LinkType>).map((t) => revert(t)));
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
  };

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
   * @param getValFunc function to get vaild filepaths from file
   * @returns affected files
   */
  private updateParent(
    key: "parents" | "children",
    file: TFile,
    getValFunc: getPathsFromField,
  ): [added: Set<string> | null, removed: Set<string> | null] {
    const targetPath = file.path;

    let added: Set<string> | null, removed: Set<string> | null;
    // get from children field
    const fmPaths = getValFunc.call(this, key, file);
    if (fmPaths !== false) {
      type mergeMap = Map<string, Map<string, AlterOp>>;
      /** get all cached relation for given file and marked them remove */
      const fetchFromCache = (): mergeMap => {
        let tree: mergeMap;
        if (key === "parents") {
          const type = LinkType.out,
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
          const type = LinkType.in,
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
            const type = LinkType.out,
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
            const type = LinkType.in,
              fillWith = getToggle("add", type, targetPath);
            addFromPaths = fmPaths.toMap().map(() => fillWith);
            added = fmPaths.subtract(tree.keySeq());
          } else assertNever(key);
          return [tree.merge(addFromPaths), added];
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
          if (isLinkType(newVal) && isSet(oldVal)) return oldVal.delete(newVal);
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
                if ((m.getIn([key, targetPath]) as Set<LinkType>).isEmpty())
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
  private setCacheFromFile(file: TFile, triggerEvt = true) {
    const [addedP, removedP] = this.updateParent(
      "parents",
      file,
      getPathsFromFm,
    );
    const [addedC, removedC] = this.updateParent(
      "children",
      file,
      getPathsFromFm,
    );
    if (triggerEvt) {
      type from = Set<string> | null;
      const notEmpty = (set: from): set is Set<string> =>
        !!set && !set.isEmpty();
      const fillWith = Set([file.path]);
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
          const affected = Map<string, Set<string>>().withMutations((m) => {
            if (notEmpty(direct)) m.set(file.path, direct);
            if (implied) m.merge(implied.toMap().map(() => fillWith));
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
