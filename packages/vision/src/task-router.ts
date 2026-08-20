/**
 * Task-aware routing primitives. Kept provider-neutral: this layer classifies
 * broad visual intent and chooses a quality envelope, never a vendor/model.
 * @module @ran-sh/dsh-vision/task-router
 */

import { createVisionTokenBudget } from './token-budget.ts'

export type VisionTask =
  | 'ocr'
  | 'ui-review'
  | 'code'
  | 'document'
  | 'chart'
  | 'compare'
  | 'photo'
  | 'screenshot'
  | 'translate'
  | 'general'

export interface VisionQualityPolicy {
  detail: 'low' | 'medium' | 'high'
  preferLossless: boolean
  maxPixels: number
  maxOutputTokens: number
}

export interface VisionTaskRoute {
  task: VisionTask
  policy: VisionQualityPolicy
}

function normalized(text: string): string {
  return text.normalize('NFKC').toLowerCase()
}

function includesAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some(keyword => text.includes(keyword))
}

/**
 * Infer a broad visual task from the caller instruction and image count.
 * Conservative by design: returning `general` is safer than inventing a
 * specialized task the caller did not request.
 */
export function inferVisionTask(prompt: string, imageCount = 1): VisionTask {
  const p = normalized(prompt)

  if (includesAny(p, ['compare', 'comparison', 'diff', 'difference', 'before/after', '对比', '比较', '差异', '区别', '前后变化'])) return 'compare'
  if (imageCount > 1 && includesAny(p, ['same', 'changed', '变化', '相同', '不同', '哪个'])) return 'compare'
  if (includesAny(p, ['translate', 'translation', '翻译', '译成', '译为'])) return 'translate'
  if (includesAny(p, ['ocr', 'transcribe', 'verbatim', 'extract text', 'read all text', '识别文字', '提取文字', '抄录', '逐字', '所有文字'])) return 'ocr'
  if (includesAny(p, ['chart', 'graph', 'plot', 'trend', 'axis', 'legend', '图表', '趋势', '坐标轴', '柱状图', '折线图', '饼图'])) return 'chart'
  if (includesAny(p, ['ui', 'ux', 'interface', 'layout', 'spacing', 'alignment', 'design mock', '界面', '布局', '间距', '对齐', '设计稿', '按钮', '交互'])) return 'ui-review'
  if (includesAny(p, ['code', 'terminal', 'stack trace', 'traceback', 'console', 'ide', 'error message', '代码', '终端', '报错', '错误信息', '日志', '控制台'])) return 'code'
  if (includesAny(p, ['document', 'invoice', 'receipt', 'form', 'table', 'page', '文档', '发票', '票据', '表格', '表单', '页面'])) return 'document'
  if (includesAny(p, ['screenshot', 'screen shot', '屏幕截图', '截图'])) return 'screenshot'
  if (includesAny(p, ['photo', 'photograph', '照片', '相片', '实拍'])) return 'photo'
  return 'general'
}

/**
 * Route one classified task to its provider-neutral quality envelope.
 * `token-budget.ts` is the single source of truth for budget numbers.
 */
export function routeVisionTask(task: VisionTask): VisionTaskRoute {
  return { task, policy: createVisionTokenBudget(task) }
}
