import assertNever from "assert-never";
import { isSet, Map, Set } from "immutable";
import { App, Plugin, PluginManifest } from "obsidian";
import { debounce, EventRef, Events, TFile } from "obsidian";
import {
  DEFAULT_SETTINGS,
  RelationResolverSettings,
  RelationResolverSettingTab,
} from "settings";

import { getPathsFromField, getPathsFromFm } from "./get-field";
import {
  AlterOp,
  File_Parents,
  File_Types,
  getToggle,
  LinkType,
  Operation,
  RelationInField,
  SoftLink,
} from "./misc";

export default class RelationResolver extends Plugin {
  settings: RelationResolverSettings = DEFAULT_SETTINGS;

  // @ts-ignore
  parentsCache: File_Parents = Map();
  // @ts-ignore
  fmCache: Map<string, Map<RelationInField, Set<string> | null>> = Map();
  get metadataCache() {
    return this.app.metadataCache;
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
    info: { op: Operation; relation: RelationInField; affected: Set<string> },
    ref: RelationResolver,
  ): void;
  trigger(name: "relation:resolved", ref: RelationResolver): void;
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
    // this.metadataCache.on("relation:resolved", (ref) => {
    //   console.log("relation:resolved", ref);
    // });
    // this.metadataCache.on(
    //   "relation:changed",
    //   ({ relation, op, affected }, ref) => {
    //     console.log(relation + op, affected.toJS(), ref);
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

  getParentsOf(filePath: string): Set<string> | null {
    return this.parentsCache.get(filePath)?.keySeq().toSet() ?? null;
  }
  getParentsWithTypes(filePath: string): File_Types | null {
    return this.parentsCache.get(filePath, null);
  }
  getChildrenOf(filePath: string): Set<string> | null {
    const result = this.parentsCache
      .toSeq()
      .filter((ft) => ft.has(filePath))
      .keySeq();
    return result.isEmpty() ? null : result.toSet();
  }
  getChildrenWithTypes(filePath: string): File_Types | null {
    const revert = (type: SoftLink) =>
      type === LinkType.in ? LinkType.out : LinkType.in;
    const result = this.parentsCache
      .toSeq()
      .filter((ft) => ft.has(filePath))
      .map((ft) => (ft.get(filePath) as Set<SoftLink>).map((t) => revert(t)));
    return result.isEmpty() ? null : result.toMap();
  }
  getSiblingsOf(filePath: string): Set<string> | null {
    const set = this.getParentsOf(filePath);
    if (!set) return null;

    const result = set
      .reduce((newSet, path) => {
        let children = this.getChildrenOf(path);
        if (children) return newSet.union(children);
        else return newSet;
      }, Set<string>())
      .delete(filePath);
    return result.isEmpty() ? null : result;
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
    if (updateAll) this.trigger("relation:resolved", this);
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
          if (typeof newVal === "number" && newVal in LinkType && isSet(oldVal))
            return oldVal.delete(newVal);
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
                if ((m.getIn([key, targetPath]) as Set<SoftLink>).isEmpty())
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
      const trigger = (
        op: Operation,
        fromC: Set<string> | null,
        fromP: Set<string> | null,
      ) => {
        const notEmpty = (set: typeof fromC): set is Set<string> =>
          !!set && !set.isEmpty();
        if (notEmpty(fromC) || notEmpty(fromP)) {
          const parentAffected = Set<string>().withMutations((m) => {
            if (fromP && !fromP.isEmpty()) m.add(file.path);
            if (fromC) m.merge(fromC);
          });
          if (notEmpty(parentAffected))
            this.trigger(
              "relation:changed",
              { op, relation: "parents", affected: parentAffected },
              this,
            );
          const childrenAffected = Set<string>().withMutations((m) => {
            if (fromC && !fromC.isEmpty()) m.add(file.path);
            if (fromP) m.merge(fromP);
          });
          if (notEmpty(childrenAffected))
            this.trigger(
              "relation:changed",
              { op, relation: "children", affected: childrenAffected },
              this,
            );
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
