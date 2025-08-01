import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set')
}


// Create postgres client
const client = postgres(connectionString)

// Create drizzle instance
export const db = drizzle(client, { schema })

export { schema } 