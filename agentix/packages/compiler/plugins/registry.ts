import { CompilerPlugin, PluginType, PipelineStage } from '../types/plugin';

export class PluginRegistry {
  private plugins: Map<string, CompilerPlugin> = new Map();
  private pluginsByStage: Map<PipelineStage, CompilerPlugin[]> = new Map();
  private pluginsByType: Map<PluginType, CompilerPlugin[]> = new Map();

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

  getForStage(stage: PipelineStage): CompilerPlugin[] {
    return this.pluginsByStage.get(stage) || [];
  }

  getByType(type: PluginType): CompilerPlugin[] {
    return this.pluginsByType.get(type) || [];
  }

  get(name: string): CompilerPlugin | undefined {
    return this.plugins.get(name);
  }

  getAll(): CompilerPlugin[] {
    return Array.from(this.plugins.values());
  }

  clear(): void {
    this.plugins.clear();
    this.pluginsByStage.clear();
    this.pluginsByType.clear();
  }

  get count(): number {
    return this.plugins.size;
  }
}
