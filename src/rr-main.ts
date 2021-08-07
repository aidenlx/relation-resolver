import { Plugin } from "obsidian";
import {
  DEFAULT_SETTINGS,
  RelationResolverSettings,
  RelationResolverSettingTab,
} from "settings";

export default class RelationResolver extends Plugin {
  settings: RelationResolverSettings = DEFAULT_SETTINGS;

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
}
