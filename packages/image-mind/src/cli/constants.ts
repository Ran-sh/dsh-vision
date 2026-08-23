/**
 * Shared CLI constants for the dsh-plugin-image-mind lifecycle command.
 *
 * The CLI is a thin convenience wrapper over OFFICIAL DeepSeek Harness plugin
 * lifecycle operations (`dsh plugin --profile <name> <args...>`, which is
 * itself a pnpm forwarder with layer reconciliation). It never edits
 * Harness-owned profile manifests, lockfiles, settings or stores directly.
 */

/** Published npm package name this CLI ships inside. */
export const PLUGIN_PACKAGE = 'dsh-plugin-image-mind'

/** The provider-neutral vision service the plugin depends on. */
export const SERVICE_PACKAGE = '@ran-sh/dsh-vision'

/** Default DSH profile managed by the lifecycle commands. */
export const DEFAULT_PROFILE = 'web'

/**
 * Exact Harness release line this 0.2.0 candidate is validated against. The
 * CLI reports this as its compatibility target; it never silently claims
 * compatibility with untested Harness versions.
 */
export const COMPATIBILITY_TARGET = '0.1.1-rc.2'

/** Environment variable that relocates the DeepSeek Harness home (official). */
export const DSH_HOME_ENV = 'DSH_HOME'

/** Optional explicit path to the official `dsh` CLI JS entry (testing/CI). */
export const DSH_BIN_OPTION = '--dsh-bin'

/** Environment variable alternative to {@link DSH_BIN_OPTION}. */
export const DSH_BIN_ENV = 'DSH_PLUGIN_IMAGE_MIND_DSH_BIN'

/**
 * Advanced/testing override for the package spec handed to the official
 * installer. Defaults to the exact running CLI version; a tarball path lets
 * task-owned acceptance install packed artifacts without publishing.
 */
export const FROM_OPTION = '--from'

const VALID_COMMANDS = ['install', 'update', 'status', 'uninstall'] as const

export type CliCommand = (typeof VALID_COMMANDS)[number]

export function isCliCommand(value: string): value is CliCommand {
  return (VALID_COMMANDS as readonly string[]).includes(value)
}

export const USAGE = `dsh-plugin-image-mind lifecycle CLI (v0.2.0)

Manage this plugin in a DeepSeek Harness profile through OFFICIAL DSH
plugin lifecycle commands. All profile mutations are delegated; nothing
here hand-edits profiles, lockfiles, stores or settings.

Usage:
  dsh-plugin-image-mind <command> [options]

Commands:
  install     install the exact running version into the profile (idempotent)
  update      converge an installed plugin to the exact running version
  status      read-only report of profile/plugin/service state (--json supported)
  uninstall   remove the plugin via official remove; keeps a shared service

Options:
  --profile <name>   target DSH profile (default: ${DEFAULT_PROFILE})
  --json             machine-readable output (status)
  --from <spec>      advanced: package spec for install/update instead of the
                     exact published version (e.g. a local .tgz path)
  --dsh-bin <path>   explicit path to the official dsh CLI JS entry
                     (env: DSH_PLUGIN_IMAGE_MIND_DSH_BIN)
  -h, --help         show this help
  -V, --version      print the CLI version

Examples:
  npx dsh-plugin-image-mind install
  npx dsh-plugin-image-mind status --json
  npx dsh-plugin-image-mind uninstall --profile web

Compatibility target: @deepseek-ai/dsh@${COMPATIBILITY_TARGET} (exact).`
