import { writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import { createVitest, parseCLI } from 'vitest/node'

const [destination, ...args] = process.argv.slice(2)
const { options, filter } = parseCLI(['vitest', ...args])
const ctx = await createVitest(options)
try {
  const specs = await ctx.getRelevantTestSpecifications(filter)
  const projects = new Map()
  for (const spec of specs) {
    const project = spec.project.name
    if (!project) {
      throw new Error('Split related selection requires named Vitest projects.')
    }
    let files = projects.get(project)
    if (!files) {
      files = []
      projects.set(project, files)
    }
    files.push(relative(process.cwd(), spec.moduleId).replaceAll('\\', '/'))
  }
  writeFileSync(
    destination,
    JSON.stringify([...projects].map(([project, files]) => ({ project, files })))
  )
  console.log(`Selected ${specs.length} related test files across ${projects.size} projects.`)
} finally {
  await ctx.close()
}
