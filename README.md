# Relation Resolver

Provide API to resolve relations defined in obsidian notes

## How to use

1. run `npm i -D @aidenlx/relation-resolver` in your plugin dir
2. create a new file named `types.d.ts` under the same dir as `main.ts`
3. copy the following code into new file, then you can 
   1. check if enabled: `plugin.app.enabledPlugins.has("dataview")`
   2. access api: `plugin.app.plugins.dataview.api`
      1. use `api.initialized` to check if api is ready
   3. bind to dataview events: `plugin.registerEvent(plugin.app.metadataCache.on("relation:...",(...)=>{...}))`


```ts
import { ChangeInfo, RelationResolverAPI } from "relation-resolver";

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
  interface App {
    plugins: {
      plugins: {
        [id: string]: any;
        ["relation-resolver"]?: {
          api: RelationResolverAPI;
        };
      };
    };
  }
}
```

PS: method to check if api is available when loading plugin:

```ts
async onload() {
  const doSomethingWith = (api: RelationResolverAPI) => {
    // do something
  };
  if (this.app.enabledPlugins.has("relation-resolver")) {
    const api = this.app.plugins["relation-resolver"]?.api;
    if (api && api.initialized) doSomethingWith(api);
    else
      this.registerEvent(
        this.app.metadataCache.on("relation:resolved", (api) =>
          doSomethingWith(api)
        )
      );
  }
}
```

## Compatibility

The required API feature is only available for Obsidian v0.9.12+.

## Installation

### From GitHub

1. Download the Latest Release from the Releases section of the GitHub Repository
2. Put files to your vault's plugins folder: `<vault>/.obsidian/plugins/relation-resolver`
3. Reload Obsidian
4. If prompted about Safe Mode, you can disable safe mode and enable the plugin.
   Otherwise, head to Settings, third-party plugins, make sure safe mode is off and
   enable the plugin from there.

> Note: The `.obsidian` folder may be hidden. On macOS, you should be able to press `Command+Shift+Dot` to show the folder in Finder.

### From Obsidian

> Not yet available

1. Open `Settings` > `Third-party plugin`
2. Make sure Safe mode is **off**
3. Click `Browse community plugins`
4. Search for this plugin
5. Click `Install`
6. Once installed, close the community plugins window and the patch is ready to use.
