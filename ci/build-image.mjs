import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { image, run, summary, versions } from './lib.mjs'

const variant = JSON.parse(readFileSync('build-variant.json', 'utf8'))
const temporary = mkdtempSync(path.join(process.env.RUNNER_TEMP || tmpdir(), 'fe-build-'))
const context = path.join(temporary, 'context')
mkdirSync(context)
run('git', ['archive', '--format=tar', '--output=' + path.join(temporary, 'source.tar'), 'HEAD'])
run('tar', ['xf', path.join(temporary, 'source.tar'), '-C', context])
const cleanEnv = { ...process.env }
for (const key of ['DATABASE_URL', 'NATS_URL', 'GH_TOKEN', 'GITHUB_TOKEN', 'NODE_AUTH_TOKEN']) delete cleanEnv[key]

async function tool(name) {
  const spec = versions.tools[name]
  const directory = path.join(temporary, name)
  mkdirSync(directory)
  const archive = path.join(directory, path.basename(new URL(spec.url).pathname))
  const response = await fetch(spec.url, { signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error('Download failed for ' + name + ': ' + response.status)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== spec.sha256) throw new Error('Checksum mismatch: ' + name)
  writeFileSync(archive, bytes)
  let binary
  if (name === 'earthly') binary = archive
  else if (name === 'jib') {
    run('unzip', ['-q', archive, '-d', directory])
    binary = path.join(directory, 'jib', 'bin', 'jib')
  } else {
    run('tar', ['xzf', archive, '-C', directory])
    binary = path.join(directory, name)
  }
  if (!existsSync(binary)) throw new Error('Expected tool not found: ' + binary)
  chmodSync(binary, 0o755)
  run(binary, ['--version'])
  return binary
}

const options = { cwd: context, env: cleanEnv }
summary('## Build ' + variant.method + '\nPlatform: ' + versions.platform + '; pnpm: ' + versions.pnpm + '\nNo image is published.')

switch (variant.method) {
  case 'railpack': {
    const binary = await tool('railpack')
    const builder = 'fe-railpack-buildkit'
    try {
      run('docker', ['run', '--detach', '--privileged', '--name', builder, versions.images.buildkit])
      run(binary, ['build', '--name', image, '--platform', versions.platform, '--progress', 'plain', '.'], {
        ...options, env: { ...cleanEnv, BUILDKIT_HOST: 'docker-container://' + builder }
      })
    } finally {
      run('docker', ['rm', '-f', builder], { allowFailure: true })
    }
    break
  }
  case 'nixpacks': {
    const binary = await tool('nixpacks')
    run(binary, ['build', '.', '--name', image, '--platform', versions.platform], options)
    break
  }
  case 'containerfile': {
    const exported = path.join(temporary, 'export')
    mkdirSync(exported)
    run('docker', ['run', '--rm', '--privileged', '--volume', context + ':/workspace:ro',
      '--volume', exported + ':/out', '--workdir', '/workspace', versions.images.podman,
      'sh', '-ceu',
      'podman --storage-driver=vfs version; podman --storage-driver=vfs build --format docker --platform linux/amd64 -f Containerfile -t ' + image +
      ' .; podman --storage-driver=vfs save --format docker-archive -o /out/image.tar ' + image])
    run('docker', ['load', '--input', path.join(exported, 'image.tar')])
    break
  }
  case 'cloud-native-buildpacks': {
    const binary = await tool('pack')
    run(binary, ['build', image, '--path', context, '--builder', versions.images.cnbBuilder,
      '--run-image', versions.images.cnbRun, '--trust-builder', '--platform', versions.platform, '--pull-policy', 'always'], options)
    break
  }
  case 'earthly': {
    const binary = await tool('earthly')
    run(binary, ['--ci', '--output', '--platform', versions.platform, '+image', '--IMAGE=' + image], {
      ...options, env: { ...cleanEnv, EARTHLY_DISABLE_ANALYTICS: '1' }
    })
    break
  }
  case 'jib': {
    const staging = path.join(context, '.build', 'jib')
    mkdirSync(staging, { recursive: true })
    for (const file of ['package.json', 'pnpm-lock.yaml', 'server', 'migrations', 'seeds', 'assets', 'index.html', 'input.html', 'query.html']) {
      cpSync(path.join(context, file), path.join(staging, file), { recursive: true })
    }
    run('pnpm', ['install', '--prod', '--frozen-lockfile', '--node-linker=hoisted'], { cwd: staging, env: cleanEnv })
    const binary = await tool('jib')
    run(binary, ['build', '--target=docker://' + image, '--build-file', 'jib.yaml', '--context', context], options)
    break
  }
  default: throw new Error('Unknown build method: ' + variant.method)
}

const inspected = JSON.parse(run('docker', ['image', 'inspect', image], { capture: true }))[0]
if (inspected.Os !== 'linux' || inspected.Architecture !== 'amd64') throw new Error('Unexpected image platform')
for (const item of inspected.Config.Env || []) {
  if (/^(DATABASE_URL|NATS_URL)=/.test(item)) throw new Error('Runtime credential baked into image')
}
summary('Built image: ' + image + '\nImage ID: ' + inspected.Id)
