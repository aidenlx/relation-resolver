import "obsidian";

import { Set } from "immutable";

import { Operation, RelationInField } from "./misc";
import RelationResolver from "./rr-main";

declare module "obsidian" {
  interface Vault {
    exists(normalizedPath: string, sensitive?: boolean): Promise<boolean>;
  }

  interface MetadataCache {
    on(name: "initialized", callback: () => any, ctx?: any): EventRef;
    on(name: "finished", callback: () => any, ctx?: any): EventRef;
    initialized: boolean;

    on(
      name: "relation:changed",
      callback: (
        info: {
          op: Operation;
          relation: RelationInField;
          affected: Set<string>;
        },
        ref: RelationResolver,
      ) => any,
      ctx?: any,
    ): EventRef;
    on(
      name: "relation:resolved",
      callback: (ref: RelationResolver) => any,
      ctx?: any,
    ): EventRef;
  }
}
