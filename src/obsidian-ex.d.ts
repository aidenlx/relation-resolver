import "obsidian";

import { DataviewApi } from "obsidian-dataview";
declare module "obsidian" {
  interface Vault {
    exists(normalizedPath: string, sensitive?: boolean): Promise<boolean>;
  }

  interface MetadataCache {
    on(name: "initialized", callback: () => any, ctx?: any): EventRef;
    on(name: "finished", callback: () => any, ctx?: any): EventRef;
    on(
      name: "dataview:api-ready",
      callback: (api: DataviewApi) => any,
      ctx?: any,
    ): EventRef;
    on(
      name: "dataview:metadata-change",
      callback: (
        ...args:
          | [op: "rename", file: TAbstractFile, oldPath: string]
          | [op: "delete", file: TFile]
          | [op: "update", file: TFile]
      ) => any,
      ctx?: any,
    ): EventRef;
    initialized: boolean;
  }

  interface App {
    plugins: {
      enabledPlugins: Set<string>;
      plugins: {
        [id: string]: any;
        dataview?: {
          api?: DataviewApi;
        };
      };
    };
  }
}
