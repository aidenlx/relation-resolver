import assertNever from "assert-never";
import { List, Map, Set } from "immutable";
import { Notice } from "obsidian";

import {
  File_Parents,
  File_Types,
  RelationResolverAPI,
  RelationType,
} from "./api";
import { revertRelType } from "./misc";
import RelationResolver from "./rr-main";

const CIRCULAR_REF_ID = ":";

export default function getApi(this: RelationResolver): RelationResolverAPI {
  const warnCircularRef = (CirRefFile: string, childPath: List<string>) => {
    const loop = childPath
      .skipUntil((path) => path === CirRefFile)
      .push(CirRefFile);
    for (const suspect of [loop.get(-2), loop.get(1)]) {
      let types;
      if (
        suspect &&
        (types = this.parentsCache.get(suspect)?.get(CirRefFile))
      ) {
        let whereDefined = "";
        if (types.has("direct"))
          whereDefined = `${suspect} - Field "${this.settings.fieldNames["parents"]}": ${CirRefFile}`;
        if (types.has("implied"))
          whereDefined = `${CirRefFile} - Field "${this.settings.fieldNames["children"]}": ${suspect}`;
        if (whereDefined)
          new Notice(
            `Circular reference defined in: \n${whereDefined}\n\n` +
              `Loop: ${loop.join("->")}`,
          );
        else
          console.error(
            "File_Types with empty types: parentsCache-%s-%s, %o",
            suspect,
            CirRefFile,
            this.parentsCache,
          );
      }
    }
  };
  const getMapI = getMap.bind(this);
  const forEachImpliedSib = (
    filePath: string,
    callback: (path: string) => any,
  ) =>
    this.parentsCache.get(filePath)?.forEach((_types, path) =>
      this.parentsCache
        .toSeq()
        .filter((ft) => ft.has(path))
        .forEach((_types, key) => callback(key)),
    );

  return {
    get initialized(): boolean {
      return this.initialized;
    },
    hasRel: (rel, filePath) => {
      switch (rel) {
        case "parents":
          return this.parentsCache.has(filePath);
        case "children":
          return this.parentsCache.some((ft) => ft.has(filePath));
        case "siblings": {
          return Boolean(
            this.parentsCache
              .get(filePath)
              ?.some((_types, path) =>
                this.parentsCache.some(
                  (ft) => path !== filePath && ft.has(path),
                ),
              ),
          );
        }
        default:
          assertNever(rel);
      }
    },
    getRelsOf: (rel, filePath) => {
      switch (rel) {
        case "parents":
          return this.parentsCache.get(filePath)?.keySeq().toSet() ?? null;
        case "children": {
          let result = this.parentsCache.filter((ft) => ft.has(filePath));
          return result.isEmpty() ? null : result.keySeq().toSet();
        }
        case "siblings": {
          let result = Set<string>().asMutable();
          forEachImpliedSib(filePath, (path) => result.add(path));
          result.union(this.sibCache.get(filePath) ?? []);
          result.delete(filePath);
          return !result || result.isEmpty() ? null : result.asImmutable();
        }
        default:
          assertNever(rel);
      }
    },
    getRelsWithTypes: (rel, filePath) => {
      switch (rel) {
        case "parents":
          return this.parentsCache.get(filePath, null);
        case "children": {
          let result = this.parentsCache
            .toSeq()
            .filter((ft) => ft.has(filePath))
            .map((ft) =>
              (ft.get(filePath) as Set<RelationType>).map((t) =>
                revertRelType(t),
              ),
            );
          return result.isEmpty() ? null : result.toMap();
        }
        case "siblings": {
          let result = Map().asMutable() as File_Types;
          const typesI = Set<RelationType>(["implied"]);
          const typesD = Set<RelationType>(["direct"]);
          forEachImpliedSib(filePath, (path) => result.set(path, typesI));
          result.mergeDeep(
            this.sibCache
              .get(filePath)
              ?.toKeyedSeq()
              .map(() => typesD) ?? [],
          );
          result.delete(filePath);
          return result.isEmpty() ? null : result.asImmutable();
        }
        default:
          assertNever(rel);
      }
    },
    getPaths: (rel, filePath, endingPaths) => {
      let allPaths = List<List<string>>().asMutable();
      const getMap = (target: string): Map<string, any> | null =>
        // @ts-ignore
        getMapI(target, rel) as Map<string, any> | null;

      const iter = (target: string, childPath: List<string>) => {
        const children = getMap(target);
        if (children)
          for (const filePath of children.keys()) {
            if (childPath.includes(filePath)) {
              // prevent circular reference
              allPaths.push(childPath.push(filePath + CIRCULAR_REF_ID));
              warnCircularRef(filePath, childPath);
            } else if (endingPaths?.includes(filePath))
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
            .filterNot((v) => v.endsWith(CIRCULAR_REF_ID))
            .toSet(),
          excludes = paths
            .toSeq()
            .filter((path) => path.last()?.endsWith(CIRCULAR_REF_ID))
            .map((path) => {
              const tuple = path // circularRefPaths tuple
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
}

function getMap(
  this: RelationResolver,
  target: string,
  rel: "parents",
): File_Types | null;
function getMap(
  this: RelationResolver,
  target: string,
  rel: "children",
): File_Parents | null;
function getMap(
  this: RelationResolver,
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
