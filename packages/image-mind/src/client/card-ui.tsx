/**
 * Card chrome for plugin settings cards: a disclosure header naming the
 * plugin and what its settings govern, the controls inside, and the save
 * that writes them. Renders nothing while the namespace is loading. Styles
 * mirror the official ui-settings-plugins PluginCard/fields exactly (same
 * design tokens and spacing), with prefixed class names injected as one
 * fixed <style> tag.
 * @module dsh-plugin-image-mind/client/card_ui
 */

import { useState, type ReactNode } from 'react'
import type { CardShell } from './card-form.ts'

/** Card chrome copy keys shared by the card; every locale carries them. */
export const CARD_COPY_KEYS = [
  'settings.collapse',
  'settings.expand',
  'settings.unsaved',
  'settings.readOnly',
  'settings.saveFailed',
  'settings.discard',
  'settings.save',
  'settings.saving',
] as const

/** Copy key domain for the card's own copy. */
export type SettingsCardKey<TKey extends string = string> = TKey | (typeof CARD_COPY_KEYS)[number]

/** Connection status a settings card can surface in its header lamp. */
export type CardStatus = 'unknown' | 'testing' | 'ok' | 'fail'

/** Card chrome shared by every plugin settings card. */
export interface SettingsCardProps<TKey extends string = string> {
  /** Locale reader for this card's copy. */
  t: (key: SettingsCardKey<TKey>) => string
  /** Locale key of the plugin's name. */
  titleKey: TKey
  /** Locale key of the line describing what this plugin's settings govern. */
  descriptionKey: TKey
  /** The card's form state: availability, writability, and what a save would do. */
  state: CardShell
  /** Write every staged edit. */
  onSave: () => void
  /** Drop every staged edit. */
  onDiscard: () => void
  /** The plugin's controls. */
  children: ReactNode
  /** Connection lamp state and its short label; omit for no lamp. */
  status?: CardStatus
  /** Short status label shown beside the lamp. */
  statusLabel?: string
}

/**
 * Official-plugin card + fields stylesheet (mirrors ui-settings-plugins
 * PluginCard / fields), class names prefixed with `image-mind-`. Injected
 * once per document; idempotent under re-evaluation.
 */
const CARD_CSS = [
  '.image-mind-card { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-3); border-radius: 12px; list-style: none; margin: 0; transition: border-color .16s, background .16s; }',
  '.image-mind-card:hover { border-color: var(--dsw-alias-label-dimmed); }',
  '.image-mind-card-open { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-label-dimmed); }',
  '.image-mind-card-header { appearance: none; width: 100%; font: inherit; color: inherit; text-align: left; cursor: pointer; background: none; border: 0; border-radius: 12px; align-items: center; gap: 12px; padding: 14px 16px; display: flex; }',
  '.image-mind-card-header:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }',
  '.image-mind-card-head { flex-direction: column; flex: 1; gap: 4px; min-width: 0; display: flex; }',
  '.image-mind-card-name { color: var(--dsw-alias-label-primary); font-size: 15px; font-weight: 600; line-height: 1.4; }',
  '.image-mind-card-desc { color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 1.5; }',
  '.image-mind-card-chevron { color: var(--dsw-alias-label-tertiary); flex: none; transition: transform .16s; }',
  '.image-mind-card-chevron-open { transform: rotate(180deg); }',
  '.image-mind-card-pending { white-space: nowrap; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); border-radius: 999px; flex: none; padding: 1px 8px; font-size: 11px; font-weight: 500; line-height: 17px; }',
  '.image-mind-card-status { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; flex: none; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }',
  '.image-mind-card-status-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--dsw-alias-label-tertiary); }',
  '.image-mind-card-status-ok .image-mind-card-status-dot { background: var(--dsw-alias-label-positive, #1a7f37); }',
  '.image-mind-card-status-fail .image-mind-card-status-dot { background: var(--dsw-alias-label-error, #d93636); }',
  '.image-mind-card-status-testing .image-mind-card-status-dot { background: var(--dsw-alias-label-warning, #d9822b); animation: imageMindPulse 1s ease-in-out infinite; }',
  '@keyframes imageMindPulse { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }',
  '.image-mind-card-body { border-top: 1px solid var(--dsw-alias-border-l2); margin: 0 16px; padding-bottom: 8px; }',
  '.image-mind-card-readonly { color: var(--dsw-alias-label-tertiary); margin: 12px 0 0; font-size: 12px; line-height: 1.5; }',
  '.image-mind-card-field { flex-direction: column; gap: 6px; padding: 12px 0; display: flex; }',
  '.image-mind-card-field + .image-mind-card-field { border-top: 1px solid var(--dsw-alias-border-l2); }',
  '.image-mind-card-field-head { align-items: center; gap: 8px; display: flex; }',
  '.image-mind-card-label { min-width: 0; color: var(--dsw-alias-label-primary); flex: 1; font-size: 13px; font-weight: 500; line-height: 1.5; }',
  '.image-mind-card-badges { align-items: center; gap: 8px; display: inline-flex; }',
  '.image-mind-card-badge { white-space: nowrap; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); border-radius: 999px; padding: 1px 8px; font-size: 11px; font-weight: 500; line-height: 17px; }',
  '.image-mind-card-reset { font: inherit; color: var(--dsw-alias-label-secondary); cursor: pointer; background: none; border: none; padding: 0; font-size: 12px; line-height: 1.5; }',
  '.image-mind-card-reset:hover:not(:disabled) { color: var(--dsw-alias-label-primary); }',
  '.image-mind-card-reset:disabled { cursor: default; }',
  '.image-mind-card-input, .image-mind-card-select { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-3); height: 34px; font: inherit; color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 0 12px; font-size: 13px; line-height: 1.5; }',
  '.image-mind-card-input:focus-visible, .image-mind-card-select:focus-visible { border-color: var(--dsw-alias-brand-primary); outline: none; }',
  '.image-mind-card-input:disabled, .image-mind-card-select:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }',
  '.image-mind-card-input-invalid { border-color: var(--dsw-alias-label-error); }',
  '.image-mind-card-hint { color: var(--dsw-alias-label-tertiary); margin: 0; font-size: 12px; line-height: 1.5; }',
  '.image-mind-card-invalid { color: var(--dsw-alias-label-error); margin: 0; font-size: 12px; line-height: 1.5; }',
  '.image-mind-card-footer { border-top: 1px solid var(--dsw-alias-border-l2); justify-content: flex-end; align-items: center; gap: 8px; padding: 12px 0 4px; display: flex; }',
  '.image-mind-card-failed { min-width: 0; color: var(--dsw-alias-label-error); flex: 1; margin: 0; font-size: 12px; line-height: 1.5; }',
  '.image-mind-card-testrow { justify-content: flex-end; align-items: center; gap: 8px; padding-top: 4px; display: flex; }',
  '.image-mind-card-test-ok, .image-mind-card-test-err { min-width: 0; color: var(--dsw-alias-label-primary); flex: 1; margin: 0; font-size: 12px; line-height: 1.5; word-break: break-all; }',
  '.image-mind-card-test-err { color: var(--dsw-alias-label-error); }',
  '.image-mind-card-test { appearance: none; font: inherit; cursor: pointer; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 5px 14px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-secondary); background: none; }',
  '.image-mind-card-test:hover:not(:disabled) { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-dimmed); }',
  '.image-mind-card-test:disabled { opacity: .5; cursor: default; }',
  '.image-mind-model-row { display: flex; align-items: center; gap: 8px; }',
  '.image-mind-model-row > .image-mind-card-input { flex: 1; min-width: 0; }',
  '.image-mind-model-load { appearance: none; font: inherit; cursor: pointer; white-space: nowrap; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 0 12px; height: 34px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-secondary); background: none; }',
  '.image-mind-model-load:hover:not(:disabled) { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-dimmed); }',
  '.image-mind-model-load:disabled { opacity: .5; cursor: default; }',
  '.image-mind-model-verified { white-space: nowrap; color: var(--dsw-alias-label-positive, #1a7f37); font-size: 12px; line-height: 1.5; }',
  '.image-mind-model-note { color: var(--dsw-alias-label-tertiary); margin: 0; font-size: 12px; line-height: 1.5; }',
  '.image-mind-provider { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-3); border-radius: 10px; margin: 10px 0; }',
  '.image-mind-provider-open { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-label-dimmed); }',
  '.image-mind-provider-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; }',
  '.image-mind-provider-toggle { appearance: none; font: inherit; color: inherit; text-align: left; cursor: pointer; background: none; border: 0; flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 4px 0; }',
  '.image-mind-provider-name { color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 600; line-height: 1.4; min-width: 0; }',
  '.image-mind-provider-actions { display: flex; align-items: center; gap: 6px; flex: none; }',
  '.image-mind-provider-action { appearance: none; font: inherit; cursor: pointer; white-space: nowrap; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; padding: 3px 10px; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); background: none; }',
  '.image-mind-provider-action:hover:not(:disabled) { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-dimmed); }',
  '.image-mind-provider-action:disabled { opacity: .4; cursor: default; }',
  '.image-mind-provider-del { color: var(--dsw-alias-label-error); }',
  '.image-mind-provider-body { border-top: 1px solid var(--dsw-alias-border-l2); margin: 0 12px; padding: 4px 0 10px; }',
  '.image-mind-card-provider-add { display: flex; align-items: center; gap: 8px; padding: 10px 0; border-bottom: 1px solid var(--dsw-alias-border-l2); }',
  '.image-mind-card-provider-add > .image-mind-card-input { flex: 1; min-width: 0; }',
  '.image-mind-card-addrow { display: flex; align-items: center; gap: 8px; padding: 10px 0; border-bottom: 1px solid var(--dsw-alias-border-l2); }',
  '.image-mind-card-addbtn { appearance: none; font: inherit; cursor: pointer; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 8px; padding: 6px 14px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-secondary); background: none; }',
  '.image-mind-card-addbtn:hover:not(:disabled) { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-dimmed); }',
  '.image-mind-card-addbtn:disabled { opacity: .4; cursor: default; }',
  '.image-mind-card-catalog { padding: 10px 0; }',
  '.image-mind-card-catalog-list { list-style: none; margin: 6px 0 0; padding: 0; max-height: 260px; overflow: auto; }',
  '.image-mind-card-catalog-item { appearance: none; font: inherit; color: inherit; text-align: left; cursor: pointer; background: none; border: 0; border-bottom: 1px solid var(--dsw-alias-border-l2); width: 100%; display: flex; align-items: baseline; gap: 10px; padding: 8px 2px; }',
  '.image-mind-card-catalog-name { color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 500; flex: 1; min-width: 0; }',
  '.image-mind-card-catalog-meta { color: var(--dsw-alias-label-tertiary); font-size: 12px; flex: none; }',
  '.image-mind-card-customrow { display: flex; align-items: center; gap: 8px; padding: 10px 0; }',
  '.image-mind-card-customrow > .image-mind-card-input { flex: 1; min-width: 0; }',
  '.image-mind-card-providerlist { list-style: none; margin: 6px 0 0; padding: 0; }',
  '.image-mind-provider-row { display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--dsw-alias-border-l2); padding: 8px 0; }',
  '.image-mind-provider-row-main { appearance: none; font: inherit; color: inherit; text-align: left; cursor: pointer; background: none; border: 0; flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 2px 0; }',
  '.image-mind-provider-row-name { color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 600; min-width: 0; }',
  '.image-mind-provider-row-lamp { color: var(--dsw-alias-label-tertiary); font-size: 12px; flex: none; }',
  '.image-mind-provider-row-actions { display: flex; align-items: center; gap: 6px; flex: none; }',
  '.image-mind-provider-editor { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-3); border-radius: 10px; padding: 4px 12px 10px; margin: 8px 0; }',
  '.image-mind-provider-editor-head { display: flex; align-items: center; gap: 8px; padding: 8px 0 2px; }',
  '.image-mind-provider-editor-title { color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 600; flex: 1; min-width: 0; }',
  '.image-mind-provider-advanced-toggle { appearance: none; font: inherit; cursor: pointer; background: none; border: none; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.5; padding: 6px 0 2px; text-align: left; }',
  '.image-mind-provider-advanced-toggle:hover:not(:disabled) { color: var(--dsw-alias-label-primary); }',
  '.image-mind-provider-advanced-toggle:disabled { opacity: .5; cursor: default; }',
  '.image-mind-card-presetrow { border-bottom: 1px solid var(--dsw-alias-border-l2); align-items: center; gap: 8px; padding: 10px 0; display: flex; }',
  '.image-mind-card-presetlabel { min-width: 0; color: var(--dsw-alias-label-secondary); flex: none; font-size: 13px; line-height: 1.5; }',
  '.image-mind-card-presetselect { flex: 1; min-width: 0; }',
  '.image-mind-card-presetname { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-3); height: 34px; font: inherit; color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 0 12px; font-size: 13px; line-height: 1.5; min-width: 0; flex: 1; }',
  '.image-mind-card-presetbtn { appearance: none; font: inherit; cursor: pointer; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 5px 14px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-secondary); background: none; flex: none; }',
  '.image-mind-card-presetbtn:hover:not(:disabled) { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-dimmed); }',
  '.image-mind-card-presetbtn:disabled { opacity: .5; cursor: default; }',
  '.image-mind-card-presetdel { color: var(--dsw-alias-label-error); }',
  '.image-mind-card-discard, .image-mind-card-save { appearance: none; font: inherit; cursor: pointer; border: 1px solid transparent; border-radius: 8px; padding: 5px 14px; font-size: 13px; line-height: 1.5; }',
  '.image-mind-card-discard { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); background: none; }',
  '.image-mind-card-discard:hover:not(:disabled) { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-dimmed); }',
  '.image-mind-card-save { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3); }',
  '.image-mind-card-discard:disabled, .image-mind-card-save:disabled { opacity: .4; cursor: default; }',
  '.image-mind-card-discard:focus-visible, .image-mind-card-save:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }',
].join('\n')

/** Inject the stylesheet once per document; idempotent under re-evaluation. */
function ensureStylesheet(): void {
  if (document.querySelector('style[data-plugin-card-css="image-mind"]') !== null) return
  const tag = document.createElement('style')
  tag.setAttribute('data-plugin-card-css', 'image-mind')
  tag.textContent = CARD_CSS
  document.head.append(tag)
}

/**
 * Render one plugin settings card.
 * @param props - the plugin's copy keys, its form state, and its controls.
 * @returns the card, or nothing while the namespace is still loading.
 */
export function SettingsCard<TKey extends string = string>(props: SettingsCardProps<TKey>) {
  // Collapsed on arrival, matching the official plugin cards (they render
  // their controls only after the user expands the card).
  const [open, setOpen] = useState(false)
  const { state } = props
  if (!state.available) return null
  ensureStylesheet()
  const title = props.t(props.titleKey)
  const description = props.t(props.descriptionKey)
  const blocked = !state.dirty || state.invalid || state.saving
  return (
    <li className={open ? 'image-mind-card image-mind-card-open' : 'image-mind-card'}>
      <button
        type="button"
        className="image-mind-card-header"
        aria-expanded={open}
        aria-label={`${props.t(open ? 'settings.collapse' : 'settings.expand')}: ${title}`}
        onClick={() => { setOpen(!open) }}
      >
        <span className="image-mind-card-head">
          <span className="image-mind-card-name" title={title}>{title}</span>
          <span className="image-mind-card-desc" title={description}>{description}</span>
        </span>
        {props.status !== undefined && props.status !== 'unknown'
          ? (
            <span className={`image-mind-card-status image-mind-card-status-${props.status}`}>
              <span className="image-mind-card-status-dot" />
              {props.statusLabel !== undefined && props.statusLabel !== '' ? props.statusLabel : null}
            </span>
          )
          : null}
        {state.dirty
          ? <span className="image-mind-card-pending">{props.t('settings.unsaved')}</span>
          : null}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={open ? 'image-mind-card-chevron image-mind-card-chevron-open' : 'image-mind-card-chevron'}
        >
          <path
            d="M4 6l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {open
        ? (
          <div className="image-mind-card-body">
            {!state.writable
              ? <p className="image-mind-card-readonly" role="status">{props.t('settings.readOnly')}</p>
              : null}
            {props.children}
            <div className="image-mind-card-footer">
              {state.failed
                ? (
                  <p className="image-mind-card-failed" role="status">
                    {props.t('settings.saveFailed')}{state.failedReason ? ` - ${state.failedReason}` : ''}
                  </p>
                )
                : null}
              <button
                type="button"
                className="image-mind-card-discard"
                disabled={!state.dirty || state.saving}
                onClick={props.onDiscard}
              >
                {props.t('settings.discard')}
              </button>
              <button
                type="button"
                className="image-mind-card-save"
                disabled={blocked}
                onClick={props.onSave}
              >
                {props.t(!state.saving ? 'settings.save' : 'settings.saving')}
              </button>
            </div>
          </div>
        )
        : null}
    </li>
  )
}

/** Props every field control needs regardless of its value type. */
export interface FieldProps {
  id: string
  label: string
  hint: string
  text: string
  overridden: boolean
  invalid: boolean
  overriddenLabel: string
  resetLabel: string
  invalidLabel: string
  disabled: boolean
  onEdit: (text: string) => void
  onReset: () => void
}

/** A staged value field. */
export function ValueField(props: FieldProps & {
  numeric?: boolean
  placeholder?: string
}) {
  return (
    <div className="image-mind-card-field">
      <div className="image-mind-card-field-head">
        <label className="image-mind-card-label" htmlFor={props.id}>{props.label}</label>
        {props.overridden
          ? (
            <span className="image-mind-card-badges">
              <span className="image-mind-card-badge">{props.overriddenLabel}</span>
              <button
                type="button"
                className="image-mind-card-reset"
                disabled={props.disabled}
                onClick={props.onReset}
              >
                {props.resetLabel}
              </button>
            </span>
          )
          : null}
      </div>
      <input
        id={props.id}
        className={props.invalid ? 'image-mind-card-input image-mind-card-input-invalid' : 'image-mind-card-input'}
        type="text"
        {...props.numeric === true ? { inputMode: 'numeric' as const } : {}}
        {...props.invalid ? { 'aria-invalid': true } : {}}
        value={props.text}
        placeholder={props.placeholder ?? ''}
        disabled={props.disabled}
        onChange={(event) => { props.onEdit(event.target.value) }}
      />
      <p className={props.invalid ? 'image-mind-card-invalid' : 'image-mind-card-hint'}>
        {props.invalid ? props.invalidLabel : props.hint}
      </p>
    </div>
  )
}

/** A staged boolean field: 继承 / 开 / 关. */
export function BooleanField(props: FieldProps & {
  inheritLabel: string
  onLabel: string
  offLabel: string
}) {
  return (
    <div className="image-mind-card-field">
      <div className="image-mind-card-field-head">
        <label className="image-mind-card-label" htmlFor={props.id}>{props.label}</label>
        {props.overridden
          ? (
            <span className="image-mind-card-badges">
              <span className="image-mind-card-badge">{props.overriddenLabel}</span>
              <button
                type="button"
                className="image-mind-card-reset"
                disabled={props.disabled}
                onClick={props.onReset}
              >
                {props.resetLabel}
              </button>
            </span>
          )
          : null}
      </div>
      <select
        id={props.id}
        className="image-mind-card-select"
        value={props.text}
        disabled={props.disabled}
        onChange={(event) => { props.onEdit(event.target.value) }}
      >
        <option value="">{props.inheritLabel}</option>
        <option value="true">{props.onLabel}</option>
        <option value="false">{props.offLabel}</option>
      </select>
      <p className="image-mind-card-hint">{props.hint}</p>
    </div>
  )
}

/** A staged enumerated field rendered as a select. */
export function ChoiceField(props: FieldProps & {
  inheritLabel: string
  choices: ReadonlyArray<{ value: string; label: string }>
}) {
  return (
    <div className="image-mind-card-field">
      <div className="image-mind-card-field-head">
        <label className="image-mind-card-label" htmlFor={props.id}>{props.label}</label>
        {props.overridden
          ? (
            <span className="image-mind-card-badges">
              <span className="image-mind-card-badge">{props.overriddenLabel}</span>
              <button
                type="button"
                className="image-mind-card-reset"
                disabled={props.disabled}
                onClick={props.onReset}
              >
                {props.resetLabel}
              </button>
            </span>
          )
          : null}
      </div>
      <select
        id={props.id}
        className="image-mind-card-select"
        value={props.text}
        disabled={props.disabled}
        onChange={(event) => { props.onEdit(event.target.value) }}
      >
        <option value="">{props.inheritLabel}</option>
        {props.choices.map(choice => (
          <option key={choice.value} value={choice.value}>{choice.label}</option>
        ))}
      </select>
      <p className={props.invalid ? 'image-mind-card-invalid' : 'image-mind-card-hint'}>
        {props.invalid ? props.invalidLabel : props.hint}
      </p>
    </div>
  )
}

/** Props for the model field: a combobox with an endpoint-driven candidate list. */
export interface ModelFieldProps extends FieldProps {
  /** Placeholder for the free-text input. */
  placeholder?: string
  /** Candidate model ids to offer; an empty array keeps the free-text input. */
  candidates: string[]
  /** Whether a model-list load is in flight. */
  loading: boolean
  /** One-line status of the last model-list load (source or error). */
  listNote?: string
  /** True when the current model id passed a connection test this session. */
  verified: boolean
  /** Verified-label copy. */
  verifiedLabel: string
  /** Load-label copy. */
  loadLabel: string
  /** Loading-label copy. */
  loadingLabel: string
  /** Called when the user asks to load the endpoint's model list. */
  onLoad: () => void
}

/** A staged model field: free-text with a loadable endpoint candidate list. */
export function ModelField(props: ModelFieldProps) {
  const listId = `${props.id}-list`
  return (
    <div className="image-mind-card-field">
      <div className="image-mind-card-field-head">
        <label className="image-mind-card-label" htmlFor={props.id}>{props.label}</label>
        {props.overridden
          ? (
            <span className="image-mind-card-badges">
              <span className="image-mind-card-badge">{props.overriddenLabel}</span>
              <button
                type="button"
                className="image-mind-card-reset"
                disabled={props.disabled}
                onClick={props.onReset}
              >
                {props.resetLabel}
              </button>
            </span>
          )
          : null}
      </div>
      <div className="image-mind-model-row">
        <input
          id={props.id}
          className={props.invalid ? 'image-mind-card-input image-mind-card-input-invalid' : 'image-mind-card-input'}
          type="text"
          list={props.candidates.length > 0 ? listId : undefined}
          {...props.invalid ? { 'aria-invalid': true } : {}}
          value={props.text}
          placeholder={props.placeholder ?? ''}
          disabled={props.disabled}
          onChange={(event) => { props.onEdit(event.target.value) }}
        />
        <button
          type="button"
          className="image-mind-model-load"
          disabled={props.disabled || props.loading}
          onClick={props.onLoad}
        >
          {props.loading ? props.loadingLabel : props.loadLabel}
        </button>
      </div>
      {props.verified
        ? <span className="image-mind-model-verified">{props.verifiedLabel}</span>
        : null}
      <datalist id={listId}>
        {props.candidates.map(candidate => <option key={candidate} value={candidate} />)}
      </datalist>
      <p className={props.invalid ? 'image-mind-card-invalid' : 'image-mind-card-hint'}>
        {props.invalid ? props.invalidLabel : props.hint}
      </p>
      {props.listNote !== undefined && props.listNote !== ''
        ? <p className="image-mind-model-note">{props.listNote}</p>
        : null}
    </div>
  )
}