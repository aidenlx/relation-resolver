import "obsidian";

declare module "obsidian" {
  interface Vault {
    exists(normalizedPath: string, sensitive?: boolean): Promise<boolean>;
  }

  interface MetadataCache {
    on(name: "initialized", callback: () => any, ctx?: any): EventRef;
    on(name: "finished", callback: () => any, ctx?: any): EventRef;
    initialized: boolean;
  }
}
