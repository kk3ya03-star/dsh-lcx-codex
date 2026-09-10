import assert from 'node:assert/strict'

// Runs before registry access or publication. Review metadata cannot authorize release.
export function assertReleasePolicy(pkg, manifest, ref) {
  const field = name => manifest.match(new RegExp(`^\\s*${name}:\\s*(\\S+)\\s*$`, 'm'))?.[1]
  assert.equal(pkg.name, 'dsh-lcx-codex')
  assert.match(pkg.version, /^\d+\.\d+\.\d+-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*$/, 'Prereleases only')
  assert.equal(ref, `refs/tags/v${pkg.version}`)
  assert.equal(field('version'), pkg.version)
  assert.equal(field('tag'), `v${pkg.version}`)
  assert.equal(field('npm_dist_tag'), 'prelatest')
  assert.equal(field('state'), 'APPROVED_PRERELEASE', 'Explicit prerelease approval required')
  assert.match(manifest, /^publication:\s*\n\s+state: APPROVED_PENDING_PUBLISH\s*$/m, 'Publication must be explicitly approved')
  assert.ok(field('product_owner') && field('product_owner') !== 'PENDING_CONTROLLER_APPROVAL', 'Product Owner approval required')
  assert.equal(field('dsh'), pkg.devDependencies['@deepseek-ai/dsh'])
  assert.equal(field('plugin_pi'), pkg.devDependencies['@earendil-works/pi-ai'])
  assert.equal(field('host_pi'), pkg.devDependencies['@earendil-works/pi-ai'])
  return field
}
