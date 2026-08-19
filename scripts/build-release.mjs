/**
 * Build the GitHub-only release assets for dsh-vision.
 *
 * Produces two prebuilt .tgz files (lib is already compiled by `npm run build`):
 *   dist-release/dsh-vision-0.1.0.tgz                    (@ran-sh/dsh-vision)
 *   dist-release/dsh-plugin-image-mind-0.1.0.tgz          (dsh-plugin-image-mind)
 *
 * The image-mind tarball is the ONE user-facing artifact. Its package manifest
 * is prepared from the source copy with the @ran-sh/dsh-vision dependency
 * rewired from the dev-only `file:../vision` to the GitHub Release asset URL of
 * the matching tag — a normal user's single `dsh plugin ... add <image-mind-url>`
 * pulls the vision service in automatically from GitHub, with no npm account,
 * no registry publication, and no separate vision install. The source packages
 * stay untouched (vision stays a workspace `file:` dev dependency), so offline
 * development tests are unaffected.
 *
 * Tag/version come from GIT_TAG / PACKAGE_VERSION / REPOSITORY env; defaults
 * derive from the package version with a v prefix.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'dist-release')
const PREP = join(ROOT, '.tmp-release-prep')

/** The .tgz filename npm produces for a package name + version. */
function packName(pkgName, version) {
  const base = pkgName.startsWith('@') ? pkgName.slice(1).replace('/', '-') : pkgName
  return `${base}-${version}.tgz`
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function run(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
}

const vision = JSON.parse(readFileSync(join(ROOT, 'packages/vision/package.json'), 'utf8'))
const imageMind = JSON.parse(readFileSync(join(ROOT, 'packages/image-mind/package.json'), 'utf8'))

const version = process.env.PACKAGE_VERSION ?? vision.version
const tag = process.env.GIT_TAG ?? `v${version}`
const repo = process.env.REPOSITORY ?? 'Ran-sh/dsh-vision'
const baseAssetURL = `https://github.com/${repo}/releases/download/${tag}`

/** Clean, URL-safe asset names (strip the @scope/ prefix). */
const visionAssetName = `dsh-vision-${version}.tgz`
const imageMindAssetName = `dsh-plugin-image-mind-${version}.tgz`

console.log(`release build: tag=${tag} version=${version} repo=${repo}`)

rmSync(OUT, { recursive: true, force: true })
rmSync(PREP, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

// 1. @ran-sh/dsh-vision is standalone (peer deps only): pack as-is, rename to
//    the clean asset name.
const visionPacked = packName(vision.name, version)
run('npm', ['pack', '--pack-destination', OUT], join(ROOT, 'packages/vision'))
copyFileSync(join(OUT, visionPacked), join(OUT, visionAssetName))
rmSync(join(OUT, visionPacked), { force: true })

// 2. dsh-plugin-image-mind: prepare a release-flavoured package copy whose
//    vision dependency points at the GitHub asset, then pack that copy.
const prepImg = join(PREP, 'image-mind')
mkdirSync(prepImg, { recursive: true })
cpSync(join(ROOT, 'packages/image-mind/lib'), join(prepImg, 'lib'), { recursive: true })
copyFileSync(join(ROOT, 'packages/image-mind/cordis.patch.yml'), join(prepImg, 'cordis.patch.yml'))
copyFileSync(join(ROOT, 'packages/image-mind/README.md'), join(prepImg, 'README.md'))
const prepared = {
  ...imageMind,
  dependencies: {
    ...imageMind.dependencies,
    '@ran-sh/dsh-vision': `${baseAssetURL}/${visionAssetName}`,
  },
}
writeFileSync(join(prepImg, 'package.json'), `${JSON.stringify(prepared, null, 2)}\n`)
run('npm', ['pack', '--pack-destination', OUT, '.'], prepImg)

// The prepared copy already packed under the image-mind name; no rename needed.
rmSync(PREP, { recursive: true, force: true })

for (const file of [visionAssetName, imageMindAssetName]) {
  const path = join(OUT, file)
  console.log(`${file}  (${(readFileSync(path).length / 1024).toFixed(1)} KiB)  sha256=${sha256(path)}`)
}
console.log(`artifacts written to dist-release/`)
