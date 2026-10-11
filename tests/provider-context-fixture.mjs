import { Config } from '../lib/index.js'

/** A small host fixture exposing the two DSH 0.2 provider-profile seams. */
export function providerContext(profiles, { namespace = 'llm-pi-ai' } = {}) {
  return {
    llm: {
      listConfigurableProviders: () => Object.keys(profiles).map(provider => ({
        provider, displayName: provider, settingsNs: namespace,
        settingsPath: ['providers', provider],
      })),
    },
    settings: {
      describe: () => [{ ns: namespace, value: { providers: profiles } }],
    },
  }
}

/** Use the plugin's actual volatile Config schema for host installation. */
export function pluginConfig(values = {}) {
  return Config(values)
}
