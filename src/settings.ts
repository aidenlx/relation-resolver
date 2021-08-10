import { App, debounce, PluginSettingTab, Setting } from "obsidian";
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

    this.setFieldNames();
  }

  setFieldNames() {
    const { settings } = this.plugin;
    const firstUpperCase = ([first, ...rest]: string) =>
      first?.toUpperCase() + rest.join("");
    const setup = (field: keyof RelationResolverSettings["fieldNames"]) =>
      new Setting(this.containerEl)
        .setName(`${firstUpperCase(field)} Field Name`)
        .setDesc(
          `Used to find ${field} set in note's frontmatter/dataview fields`,
        )
        .addText((text) => {
          const save = debounce(
            async (value: string) => {
              settings.fieldNames[field] = value;
              await this.plugin.saveSettings();
            },
            500,
            true,
          );
          text
            .setValue(settings.fieldNames[field])
            .onChange(async (value: string) => save(value));
        });
    setup("parents");
    setup("children");
  }
}
