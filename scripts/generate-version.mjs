#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(resolve(here, '..', 'package.json'), 'utf8'))

const out = `export const SDK_VERSION = ${JSON.stringify(pkg.version)} as const
export const SDK_USER_AGENT = \`@speakspec/astro/\${SDK_VERSION}\`
`

const targetDir = resolve(here, '..', 'src', 'runtime')
mkdirSync(targetDir, { recursive: true })
writeFileSync(resolve(targetDir, 'version.ts'), out)
console.log(`generated src/runtime/version.ts (v${pkg.version})`)
