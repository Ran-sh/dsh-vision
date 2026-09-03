# rc.1 browser journey findings (2026-09-03, Batch 029)

Environment: isolated DSH_HOME, registry `dsh-plugin-image-mind@0.3.0` +
`@ran-sh/dsh-vision@0.3.0`, exact `@deepseek-ai/dsh@0.1.2-rc.1` web on a
task-owned port, driven through a real Chrome session.

## Passed

- Web boots; onboarding gate (内测声明 → 稍后配置) renders and works.
- Plugin loads and runs: 设置 → 插件 → 插件列表 shows
  `plugin-image-mind` (已启用 / 运行中). Its detail card shows
  `include: image-mind`, 完整名称 `dsh-plugin-image-mind`, 配置状态 已启用,
  运行状态 运行中. No console exceptions.
- Host settings section registers and persists: an ops-array POST to
  `/image-mind/config` writes the `image-mind` section (providers/active)
  into the isolated `settings.yaml`; the config route serves schema defaults
  with `writable: true`.

## Open issue: image-mind does not appear in the plugin configuration tab

设置 → 插件 → 插件配置 lists the official configurable sections
(网页搜索 / Subagent / Agent 循环 / 终端) but not image-mind — even after a
cold restart with the section already persisted in `settings.yaml`.

Evidence from `dsh-client-ui-settings-plugins@0.1.2-rc.1` sources
(`lib/types/client/slot-contract.d.ts`, `tab-store.d.ts`,
`ConfigurablePluginsTab.d.ts`): the configurable tab dispatches
`settings.plugin.item` cards keyed by settings **namespace**; it renders the
intersection of the namespaces the Host describe mirror serves and the card
keys registered in the slot. Absence of image-mind therefore means either

1. the Host describe mirror does not serve the `image-mind` namespace, or
2. our client card registration key does not pair with what the tab enumerates.

Our client registers the card under `key: 'image-mind'` (client/index.ts) and
the Host section namespace is `'image-mind'` — keys match on paper. The
official sections that do appear are backed by **composition config declared
in bundle patches** (e.g. `web-search-deepseek.config.apiKeyEnv`), which
suggests rc.1's describe "served set" may only cover bundle-config sections,
not dynamically `installSection`-registered namespaces, or that the mirror
snapshot missed our late registration.

## Next steps (needs design decision)

- Determine whether rc.1's Host describe should serve dynamically registered
  `installSection` namespaces (ours) and why it does not; compare against the
  official registration path used by the bundle-config sections.
- Confirm the correct rc.1 route for a third-party plugin settings card
  (plugin-list detail card vs configurable-plugins tab) and the exact card
  key/registration contract.
- Then fix client/host registration accordingly and re-run this journey.
