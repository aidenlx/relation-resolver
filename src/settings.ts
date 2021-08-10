import { App, PluginSettingTab, Setting } from "obsidian";
import RelationResolver from "rr-main";

import { RelationInField } from "./api";

export interface RelationResolverSettings {
  fieldNames: Record<RelationInField, string>;
}

export const DEFAULT_SETTINGS: RelationResolverSettings = {
  fieldNames: {
    parents: "parent",
    children: "children",
    siblings: "sibling",
  },
};

export class RelationResolverSettingTab extends PluginSettingTab {
  plugin: RelationResolver;

  constructor(app: App, plugin: RelationResolver) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
  }
}
