/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { buildVisionRequest } from '../src/adapters/openai-compatible/parse.ts'

const PNG = { bytes: Buffer.from([1, 2, 3]), mimeType: 'image/png' as const }

function plannedText(body: string, style: 'chat-completions' | 'responses'): string {
  const parsed = JSON.parse(body) as any
  return style === 'responses'
    ? parsed.input[0].content[0].text
    : parsed.messages[0].content[0].text
}

describe('vision planner wire integration', () => {
  it('augments chat-completions without losing the caller instruction', () => {
    const request = buildVisionRequest('https://example/v1', 'm', 'chat-completions', 512, 'diagnose the UI layout', [PNG])
    const text = plannedText(request.body, 'chat-completions')
    expect(text).toContain('Visual task: ui-review')
    expect(text).toContain('Caller instruction:\ndiagnose the UI layout')
    expect(text).toContain('untrusted image content')
  })

  it('augments Responses API and preserves multi-image order guidance', () => {
    const request = buildVisionRequest('https://example/v1', 'm', 'responses', 512, 'compare these two screenshots', [PNG, PNG])
    const text = plannedText(request.body, 'responses')
    expect(text).toContain('Visual task: compare')
    expect(text).toContain('There are 2 images')
    expect(text).toContain('supplied order')
  })
})
