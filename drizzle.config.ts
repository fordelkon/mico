import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  out: './src/main/data/migrations',
  schema: './src/main/data/provider-schema.ts'
})
