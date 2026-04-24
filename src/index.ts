import { runCLI } from './cli/main.js'

runCLI(process.argv).catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
