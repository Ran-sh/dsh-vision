/**
 * Visual-challenge fixtures for the connection test: three tiny self-generated
 * 32x32 solid-color PNGs, embedded as base64 so the probe works identically
 * from a source checkout and from the published package — no tests/ directory
 * and no filesystem reads at runtime. The host sends one random fixture and
 * the model must NAME the color it sees; a text-only model or a broken image
 * path fails the probe even when the endpoint answers HTTP 200.
 * @module dsh-plugin-image-mind/runtime/visual-fixtures
 */

/** The three fixture colors a probe may use. */
export type FixtureColor = 'red' | 'blue' | 'green'

/** One embedded visual-challenge fixture. */
export interface VisualFixture {
  color: FixtureColor
  /** The PNG bytes (32x32 solid color). */
  bytes: Buffer
}

/** The embedded 32x32 solid-color PNGs (base64; generated once, verified in tests). */
const PNG_BASE64: Record<FixtureColor, string> = {
  red: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGO4o6FBU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAIahsD2ItTF0AAAAAElFTkSuQmCC',
  blue: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGPQCLhDU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAB8sUExAp8tCAAAAAElFTkSuQmCC',
  green: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGPQ2OJGU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULALA3iD0Svh2DAAAAAElFTkSuQmCC',
}

/** Every embedded fixture, one per color. */
export const VISUAL_FIXTURES: readonly VisualFixture[] = (['red', 'blue', 'green'] as const).map(color => ({
  color,
  bytes: Buffer.from(PNG_BASE64[color], 'base64'),
}))

/** The fixture for one named color. */
export function visualFixture(color: FixtureColor): VisualFixture {
  const fixture = VISUAL_FIXTURES.find(entry => entry.color === color)
  if (fixture === undefined) {
    throw new Error(`image-mind: unknown visual fixture color ${JSON.stringify(color)}`)
  }
  return fixture
}

/** Pick one fixture at random so a guessing model cannot pre-answer. */
export function pickFixture(): VisualFixture {
  return VISUAL_FIXTURES[Math.floor(Math.random() * VISUAL_FIXTURES.length)]
}

/** Whether the model's reply names the fixture color (loose, case-insensitive). */
export function answerMatches(reply: string, color: string): boolean {
  return reply.trim().toLowerCase().includes(color)
}
