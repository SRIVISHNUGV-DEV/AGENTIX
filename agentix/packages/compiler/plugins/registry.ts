import { CompilerPlugin, PluginType, PipelineStage } from '../types/plugin';

export class PluginRegistry {
  private plugins: Map<string, CompilerPlugin> = new Map();
  private pluginsByStage: Map<PipelineStage, CompilerPlugin[]> = new Map();
  private pluginsByType: Map<PluginType, CompilerPlugin[]> = new Map();

  /**
   * Register a plugin under its name and index it by stage and type.
   * Why: stages look plugins up by type/stage at compile time — registration is the only way a plugin becomes visible.
   * @param plugin - plugin with a unique name and at least its declared hooks.
   * @throws When a plugin with the same name is already registered (duplicate names are never silently overwritten).
   * Side effects: mutates the name/stage/type indexes.
   * Maps to: internal — PipelineOrchestrator stages (getByType / getForStage lookups).
   */
  register(plugin: CompilerPlugin): void {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }

    this.plugins.set(plugin.name, plugin);

    for (const stage of plugin.hooks) {
      const list = this.pluginsByStage.get(stage) || [];
      list.push(plugin);
      this.pluginsByStage.set(stage, list);
    }

    const typeList = this.pluginsByType.get(plugin.type) || [];
    typeList.push(plugin);
    this.pluginsByType.set(plugin.type, typeList);
  }

  /**
   * Remove a plugin from all indexes.
   * Why: hot-unloading a plugin must leave no stale stage/type entries behind.
   * @param name - plugin name; unknown names are a no-op, not an error.
   * Side effects: removes the plugin from the name, stage and type indexes.
   * Maps to: internal — PluginRegistry.register.
   */
  unregister(name: string): void {
    const plugin = this.plugins.get(name);
    if (!plugin) return;

    this.plugins.delete(name);

    for (const [stage, list] of this.pluginsByStage) {
      this.pluginsByStage.set(stage, list.filter((p) => p.name !== name));
    }

    for (const [type, list] of this.pluginsByType) {
      this.pluginsByType.set(type, list.filter((p) => p.name !== name));
    }
  }

  /**
   * Return all plugins hooked to a pipeline stage.
   * Why: stages ask "who wants to run here" rather than hard-coding plugin lists.
   * @param stage - pipeline stage name.
   * @returns Plugins for the stage in registration order; empty array when none.
   * Maps to: internal — pipeline stage constructors.
   */
  getForStage(stage: PipelineStage): CompilerPlugin[] {
    return this.pluginsByStage.get(stage) || [];
  }

  /**
   * Return all plugins of a type (capability, policy-rule, risk-rule, ...).
   * Why: stages dispatch by plugin type — e.g. the capability resolver only runs 'capability' plugins.
   * @param type - plugin type.
   * @returns Plugins of that type in registration order; empty array when none.
   * Maps to: internal — CapabilityResolver.resolve / PolicyGenerator.generate / RiskEngineCore.runPlugins.
   */
  getByType(type: PluginType): CompilerPlugin[] {
    return this.pluginsByType.get(type) || [];
  }

  /**
   * Fetch one plugin by name.
   * Why: direct lookup for management/debugging paths.
   * @param name - plugin name.
   * @returns The plugin, or undefined when not registered.
   * Maps to: internal — PluginRegistry.register.
   */
  get(name: string): CompilerPlugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * Return every registered plugin in registration order.
   * Why: introspection/listing — e.g. a CLI "list plugins" view.
   * @returns All plugins; empty array when the registry is empty.
   * Maps to: internal — PluginRegistry.register.
   */
  getAll(): CompilerPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Remove every plugin from the registry.
   * Why: test teardown and full reconfiguration need a clean registry.
   * Side effects: empties all three indexes.
   * Maps to: internal — PluginRegistry.register.
   */
  clear(): void {
    this.plugins.clear();
    this.pluginsByStage.clear();
    this.pluginsByType.clear();
  }

  /**
   * Number of registered plugins.
   * Why: a cheap health/introspection signal — 0 means no plugin will run at any stage.
   * @returns The size of the name index.
   * Maps to: internal — PluginRegistry.register.
   */
  get count(): number {
    return this.plugins.size;
  }
}
