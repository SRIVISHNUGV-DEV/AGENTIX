import { PluginManifest } from '../types/plugin';

/**
 * Validate a parsed plugin manifest (TOML object) and normalize it into a PluginManifest.
 * Why: plugins are third-party code — the manifest is the trust boundary; a malformed manifest must be rejected before anything is loaded.
 * @param raw - untrusted parsed TOML value; must be an object with a [plugin] section.
 * @returns { valid, manifest, errors }: manifest is present only when valid; errors list every problem found (name, version, type, description, pipeline_stages all required; stages must be known).
 * Security note: this validates the manifest only — it says nothing about the plugin code itself, which is still untrusted.
 * Maps to: internal — PluginRegistry.register (manifest gate before registration).
 */
export function validateManifest(raw: unknown): { valid: boolean; manifest?: PluginManifest; errors: string[] } {
  const errors: string[] = [];
  const m = raw as Record<string, unknown>;

  if (!m || typeof m !== 'object') {
    return { valid: false, errors: ['Manifest must be a TOML object'] };
  }

  const plugin = m.plugin as Record<string, unknown> | undefined;
  if (!plugin) {
    return { valid: false, errors: ['Missing [plugin] section'] };
  }

  const name = plugin.name as string | undefined;
  if (!name || typeof name !== 'string' || name.length === 0) {
    errors.push('plugin.name is required');
  }

  const version = plugin.version as string | undefined;
  if (!version || typeof version !== 'string') {
    errors.push('plugin.version is required');
  }

  const type = plugin.type as string | undefined;
  const validTypes = ['capability', 'protocol', 'chain', 'intent-type', 'policy-rule', 'risk-rule', 'simulation-rule'];
  if (!type || !validTypes.includes(type)) {
    errors.push(`plugin.type must be one of: ${validTypes.join(', ')}`);
  }

  const description = plugin.description as string | undefined;
  if (!description || typeof description !== 'string') {
    errors.push('plugin.description is required');
  }

  const hooks = plugin.hooks as Record<string, unknown> | undefined;
  const pipelineStages = hooks?.pipeline_stages as string[] | undefined;
  if (!pipelineStages || !Array.isArray(pipelineStages) || pipelineStages.length === 0) {
    errors.push('plugin.hooks.pipeline_stages requires at least one pipeline stage');
  }

  const validStages = [
    'intent-parser', 'validator', 'capability-resolver', 'policy-generator',
    'policy-optimizer', 'contract-resolver', 'simulator', 'risk-engine',
    'explanation-generator', 'plan-generator',
  ];
  if (pipelineStages) {
    for (const stage of pipelineStages) {
      if (!validStages.includes(stage)) {
        errors.push(`Unknown pipeline stage: ${stage}. Valid: ${validStages.join(', ')}`);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    manifest: {
      name: name!,
      version: version!,
      type: type as PluginManifest['type'],
      description: description!,
      hooks: { pipeline_stages: pipelineStages as PluginManifest['hooks']['pipeline_stages'] },
    },
  };
}
