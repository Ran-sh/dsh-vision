/**
 * Self-contained locale dictionary for the image-mind settings card. The card
 * copy switches on the document language mirror (zh vs en) without depending
 * on the shell locale service — keeps the client bundle small and the card
 * robust to locale-service shape changes.
 * @module dsh-plugin-image-mind/client/locales
 */

/** Card copy keys, shared chrome plus the image-mind fields. */
export interface CardCopy {
  'card.title': string
  'card.description': string
  'settings.collapse': string
  'settings.expand': string
  'settings.unsaved': string
  'settings.readOnly': string
  'settings.saveFailed': string
  'settings.discard': string
  'settings.save': string
  'settings.saving': string
  'settings.overridden': string
  'settings.reset': string
  'settings.set': string
  'settings.clear': string
  'settings.invalidNumber': string
  'settings.inherit': string
  'settings.on': string
  'settings.off': string
  'test.run': string
  'test.running': string
  'test.success': string
  'test.failure': string
  'model.load': string
  'model.loading': string
  'model.verified': string
  'model.fallbackNote': string
  'preset.none': string
  'preset.select': string
  'preset.save': string
  'preset.saved': string
  'preset.deleted': string
  'preset.namePlaceholder': string
  'preset.needName': string
  'preset.invalid': string
  'preset.duplicate': string
  'field.presets': string
  'field.baseURL': string
  'field.baseURL.hint': string
  'field.model': string
  'field.model.hint': string
  'field.apiStyle': string
  'field.apiStyle.hint': string
  'field.apiStyle.chatCompletions': string
  'field.apiStyle.responses': string
  'field.apiKey': string
  'field.apiKey.hint': string
  'field.apiKeyEnv': string
  'field.apiKeyEnv.hint': string
  'field.defaultPrompt': string
  'field.defaultPrompt.hint': string
  'field.maxBytes': string
  'field.maxBytes.hint': string
  'field.maxOutputTokens': string
  'field.maxOutputTokens.hint': string
  'field.timeoutMs': string
  'field.timeoutMs.hint': string
  'field.renderImagePreview': string
  'field.renderImagePreview.hint': string
  'provider.active': string
  'provider.setActive': string
  'provider.edit': string
  'provider.delete': string
  'provider.add': string
  'provider.deleteConfirm': string
  'provider.namePlaceholder': string
  'provider.needName': string
  'provider.duplicate': string
  'provider.incomplete': string
  'provider.invalidId': string
  'provider.customIdPlaceholder': string
  'provider.untested': string
  'field.displayName': string
  'field.displayName.hint': string
  'field.keyless': string
  'field.keyless.hint': string
  'field.apiKey.keylessHint': string
  'test.visualFailed': string
  'provider.testing': string
  'provider.ok': string
  'provider.fail': string
  'field.apiKeyConfigured': string
  'field.apiKeyEnv.hint.multi': string
  'provider.fromCatalog': string
  'provider.custom': string
  'provider.missingKey': string
  'provider.ready': string
  'provider.notReady': string
  'provider.directory': string
  'provider.customName': string
  'provider.save': string
  'provider.cancel': string
  'provider.done': string
  'provider.added': string
  'provider.saved': string
  'provider.deleted': string
  'provider.setAsActive': string
  'provider.noProviders': string
  'provider.deleteTitle': string
  'provider.deleteBody': string
}

export type CardKey = keyof CardCopy

const zh: CardCopy = {
  'card.title': '图像理解',
  'card.description': '给纯文本模型接上视觉：understand_image 工具调用视觉端点理解图片。',
  'settings.collapse': '收起设置',
  'settings.expand': '展开设置',
  'settings.unsaved': '未保存',
  'settings.readOnly': '本部署的设置为只读。',
  'settings.saveFailed': '本部署没有接受这些值，已保留供你修改。',
  'settings.discard': '放弃修改',
  'settings.save': '保存',
  'settings.saving': '保存中…',
  'settings.overridden': '已覆盖',
  'settings.reset': '恢复默认',
  'settings.set': '设置',
  'settings.clear': '清除',
  'settings.invalidNumber': '请填数字；留空表示使用默认值。',
  'settings.inherit': '继承',
  'settings.on': '开',
  'settings.off': '关',
  'test.run': '测试连接',
  'test.running': '测试中…',
  'test.success': '连接成功，模型回复：',
  'test.failure': '连接失败：',
  'model.load': '从端点加载模型',
  'model.loading': '加载中…',
  'model.verified': '✓ 本会话已通过连接测试',
  'model.fallbackNote': '端点无法列出模型，已显示内置常见视觉模型，可继续手动输入。',
  'preset.none': '（无方案）',
  'preset.select': '切换方案：',
  'preset.save': '保存为方案',
  'preset.saved': '已保存方案',
  'preset.deleted': '已删除方案',
  'preset.namePlaceholder': '方案名称（如：GLM-4V）',
  'preset.needName': '请先填写方案名称',
  'preset.invalid': '方案需要 baseURL 与 model 都已填写',
  'preset.duplicate': '已有同名方案',
  'field.presets': '方案列表',
  'field.baseURL': '视觉端点地址',
  'field.baseURL.hint': 'OpenAI 兼容端点根地址，如 https://dashscope.aliyuncs.com/compatible-mode/v1。',
  'field.model': '视觉模型',
  'field.model.hint': '该端点下的视觉模型 id，如 qwen-vl-max、gpt-4o-mini、mimo-v2.5。',
  'field.apiStyle': '协议风格',
  'field.apiStyle.hint': 'chat-completions 拼 /chat/completions；responses 拼 /responses（OpenAI Responses API）。',
  'field.apiStyle.chatCompletions': 'Chat Completions',
  'field.apiStyle.responses': 'Responses',
  'field.apiKey': 'API Key（内联）',
  'field.apiKey.hint': '与 apiKeyEnv 二选一；留空表示用凭证缝解析。界面输入不会写入配置文件明文。',
  'field.apiKeyEnv': 'API Key 环境变量名',
  'field.apiKeyEnv.hint': '凭证引用（如 OPENCODE_GO_API_KEY），通过 DSH 凭据存储解析；留空禁用。',
  'field.defaultPrompt': '默认指令',
  'field.defaultPrompt.hint': '模型未传 prompt 时发送给视觉模型的指令模板。',
  'field.maxBytes': '图片字节上限',
  'field.maxBytes.hint': '本地文件和 URL 下载统一生效，超出即拒绝。',
  'field.maxOutputTokens': '输出 token 上限',
  'field.maxOutputTokens.hint': '发送给视觉模型的 max_tokens / max_output_tokens。',
  'field.timeoutMs': '请求超时（毫秒）',
  'field.timeoutMs.hint': '单次视觉请求超时时间。',
  'field.renderImagePreview': '对话内预览图片',
  'field.renderImagePreview.hint': '把对话中的图片引用渲染成可点击的缩略图；仅影响显示。',
  'provider.active': '当前默认',
  'provider.setActive': '设为默认',
  'provider.edit': '编辑',
  'provider.delete': '删除',
  'provider.add': '+ 添加视觉提供方',
  'provider.deleteConfirm': '删除该提供方？',
  'provider.namePlaceholder': '提供方名称（如 opencode-go）',
  'provider.needName': '请先填写提供方名称',
  'provider.duplicate': '已有同名提供方',
  'provider.incomplete': '请填写端点地址与模型',
  'provider.invalidId': 'Provider ID 无效：以小写字母开头，只允许 a-z、0-9、点、下划线、连字符。',
  'provider.customIdPlaceholder': 'Provider ID（如 my-vision，创建后不可改）',
  'provider.untested': '已配置，未测试',
  'field.displayName': '显示名称',
  'field.displayName.hint': '仅用于界面显示；路由 ID 一旦创建保持不变。',
  'field.keyless': '无需 API Key',
  'field.keyless.hint': '本地端点（Ollama / LM Studio）自动视为无需密钥；远程端点请勿随意开启。',
  'field.apiKey.keylessHint': '此提供方无需 API Key。',
  'test.visualFailed': '端点可连接，但视觉验证失败（模型可能不支持图片输入）：',
  'provider.testing': '测试中…',
  'provider.ok': '已连接',
  'provider.fail': '连接失败',
  'field.apiKeyConfigured': '已配置密钥',
  'field.apiKeyEnv.hint.multi': '凭证引用（环境变量名，如 OPENCODE_GO_API_KEY），通过 DSH 凭据存储解析；留空禁用。每个提供方可独立设置。',
  'provider.fromCatalog': '+ 添加提供方',
  'provider.custom': '+ 添加自定义提供方',
  'provider.missingKey': '未配置密钥',
  'provider.ready': '可连接',
  'provider.notReady': '配置不完整',
  'provider.directory': '从目录选择视觉提供方',
  'provider.customName': '自定义提供方名称',
  'provider.save': '保存',
  'provider.cancel': '取消',
  'provider.done': '完成',
  'provider.added': '已添加提供方',
  'provider.saved': '已保存',
  'provider.deleted': '已删除提供方',
  'provider.setAsActive': '设为默认',
  'provider.noProviders': '还没有视觉提供方。从目录添加，或添加自定义提供方。',
  'provider.deleteTitle': '删除提供方',
  'provider.deleteBody': '确定删除该提供方？',
}

const en: CardCopy = {
  'card.title': 'Image Understanding',
  'card.description': 'Vision for text-only models: the understand_image tool asks a vision endpoint to describe an image.',
  'settings.collapse': 'Collapse settings',
  'settings.expand': 'Expand settings',
  'settings.unsaved': 'Unsaved',
  'settings.readOnly': 'This deployment is read-only.',
  'settings.saveFailed': 'This deployment did not accept these values; they are kept for you to fix.',
  'settings.discard': 'Discard',
  'settings.save': 'Save',
  'settings.saving': 'Saving…',
  'settings.overridden': 'Overridden',
  'settings.reset': 'Reset',
  'settings.set': 'Set',
  'settings.clear': 'Clear',
  'settings.invalidNumber': 'Enter a number; leave empty to use the default.',
  'settings.inherit': 'Inherit',
  'settings.on': 'On',
  'settings.off': 'Off',
  'test.run': 'Test connection',
  'test.running': 'Testing…',
  'test.success': 'Connected. Model replied: ',
  'test.failure': 'Connection failed: ',
  'model.load': 'Load models from endpoint',
  'model.loading': 'Loading…',
  'model.verified': '✓ Passed a connection test this session',
  'model.fallbackNote': 'The endpoint could not list models; showing built-in common vision models. You can still type a model id.',
  'preset.none': '(none)',
  'preset.select': 'Switch preset: ',
  'preset.save': 'Save as preset',
  'preset.saved': 'Preset saved',
  'preset.deleted': 'Preset deleted',
  'preset.namePlaceholder': 'Preset name (e.g. GLM-4V)',
  'preset.needName': 'Enter a preset name first',
  'preset.invalid': 'A preset needs both baseURL and model',
  'preset.duplicate': 'A preset with that name already exists',
  'field.presets': 'Presets',
  'field.baseURL': 'Vision endpoint',
  'field.baseURL.hint': 'OpenAI-compatible endpoint root, e.g. https://dashscope.aliyuncs.com/compatible-mode/v1.',
  'field.model': 'Vision model',
  'field.model.hint': 'Vision model id on that endpoint, e.g. qwen-vl-max, gpt-4o-mini, mimo-v2.5.',
  'field.apiStyle': 'Protocol style',
  'field.apiStyle.hint': 'chat-completions appends /chat/completions; responses appends /responses (OpenAI Responses API).',
  'field.apiStyle.chatCompletions': 'Chat Completions',
  'field.apiStyle.responses': 'Responses',
  'field.apiKey': 'API Key (inline)',
  'field.apiKey.hint': 'Alternative to apiKeyEnv; leave empty to resolve through the credential seam.',
  'field.apiKeyEnv': 'API key environment variable',
  'field.apiKeyEnv.hint': 'Credential reference (e.g. OPENCODE_GO_API_KEY) resolved through the DSH credential store; empty disables.',
  'field.defaultPrompt': 'Default instruction',
  'field.defaultPrompt.hint': 'Instruction sent to the vision model when a call omits its prompt.',
  'field.maxBytes': 'Image byte bound',
  'field.maxBytes.hint': 'Applies to local files and URL downloads alike; larger images are rejected.',
  'field.maxOutputTokens': 'Max output tokens',
  'field.maxOutputTokens.hint': 'Sent as max_tokens / max_output_tokens to the vision model.',
  'field.timeoutMs': 'Timeout (ms)',
  'field.timeoutMs.hint': 'Per-call vision request timeout in milliseconds.',
  'field.renderImagePreview': 'Render image previews',
  'field.renderImagePreview.hint': 'Upgrade image-mind references in the conversation into clickable thumbnails; display only.',
  'provider.active': 'Active',
  'provider.setActive': 'Set active',
  'provider.edit': 'Edit',
  'provider.delete': 'Delete',
  'provider.add': '+ Add vision provider',
  'provider.deleteConfirm': 'Delete this provider?',
  'provider.namePlaceholder': 'Provider name (e.g. opencode-go)',
  'provider.needName': 'Enter a provider name first',
  'provider.duplicate': 'A provider with that name already exists',
  'provider.incomplete': 'Fill in the endpoint and model',
  'provider.invalidId': 'Invalid provider ID: start with a lowercase letter; only a-z, 0-9, dot, underscore, hyphen allowed.',
  'provider.customIdPlaceholder': 'Provider ID (e.g. my-vision; cannot change after creation)',
  'provider.untested': 'Configured, not tested',
  'field.displayName': 'Display name',
  'field.displayName.hint': 'Shown in the UI only; the route ID never changes.',
  'field.keyless': 'No API key needed',
  'field.keyless.hint': 'Local endpoints (Ollama / LM Studio) are keyless automatically; keep remote endpoints keyed.',
  'field.apiKey.keylessHint': 'This provider needs no API key.',
  'test.visualFailed': 'Endpoint reachable, but visual verification failed (the model may not accept images): ',
  'provider.testing': 'Testing…',
  'provider.ok': 'Connected',
  'provider.fail': 'Failed',
  'field.apiKeyConfigured': 'Key configured',
  'field.apiKeyEnv.hint.multi': 'Credential reference (env var name, e.g. OPENCODE_GO_API_KEY), resolved through the DSH credential store; empty disables. Each provider sets its own.',
  'provider.fromCatalog': '+ Add provider',
  'provider.custom': '+ Add custom provider',
  'provider.missingKey': 'No key configured',
  'provider.ready': 'Ready',
  'provider.notReady': 'Incomplete',
  'provider.directory': 'Pick a vision provider from the directory',
  'provider.customName': 'Custom provider name',
  'provider.save': 'Save',
  'provider.cancel': 'Cancel',
  'provider.done': 'Done',
  'provider.added': 'Provider added',
  'provider.saved': 'Saved',
  'provider.deleted': 'Provider deleted',
  'provider.setAsActive': 'Set as active',
  'provider.noProviders': 'No vision providers yet. Add from the directory, or add a custom provider.',
  'provider.deleteTitle': 'Delete provider',
  'provider.deleteBody': 'Delete this provider?',
}

let active: CardCopy | undefined = undefined

/** Current locale dictionary (undefined until the first language sync). */
export function dictionaries(): CardCopy {
  return active ?? zh
}

/** Switch the active dictionary (zh or en); anything else keeps the current one. */
export function setLanguage(lang: string): void {
  active = lang === 'zh' || lang.startsWith('zh-') ? zh : en
}

/** Read one card copy key from the active dictionary. */
export function t(key: CardKey): string {
  return (active ?? zh)[key]
}

/** Shared dictionary shape the shell locale service consumes ({zh, en}). */
export const localeDictionaries = { zh, en } satisfies Record<'zh' | 'en', Record<CardKey, string>>

/** Mirror the shell document language into the dictionary. Returns the observer disposer. */
export function mirrorDocumentLanguage(): () => void {
  const sync = (): void => {
    setLanguage(document.documentElement.lang)
  }
  sync()
  const observer = new MutationObserver(sync)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
  return () => observer.disconnect()
}