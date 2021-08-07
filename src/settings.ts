import { App, PluginSettingTab, Setting } from "obsidian";
import RelationResolver from "rr-main";

export interface RelationResolverSettings {}

export const DEFAULT_SETTINGS: RelationResolverSettings = {};

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
