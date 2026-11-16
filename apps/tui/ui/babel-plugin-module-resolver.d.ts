// babel-plugin-module-resolver ships no types; only the plugin's identity is
// needed by tsdown.config.ts.
declare module "babel-plugin-module-resolver" {
  import type { PluginObj } from "@babel/core";

  const plugin: (...args: unknown[]) => PluginObj;
  export default plugin;
}
