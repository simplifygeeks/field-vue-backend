import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { db } from './db/index.js'
import { sql } from 'drizzle-orm'
import authRouter from './routes/auth.js'
import jobsRouter from './routes/jobs.js'
import { requireAuth } from './middleware/auth.js'
import vertexAiRouter from './routes/vertex-ai.js'
import uploadsRouter from './routes/uploads.js'
import customersRouter from './routes/customers.js'
import { existsSync, writeFileSync } from 'fs'

// create a vertex-ai.json file in the root of the project if doesn't exist
const vertexAiJsonPath = "/tmp/vertex-ai.json";
if (!existsSync(vertexAiJsonPath)) {
  // Write the original JSON string to preserve proper escaping
  writeFileSync(vertexAiJsonPath, process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON!);
}


const app = new Hono()

// Mount auth routes
app.route('/auth', authRouter)

// Mount jobs routes with authentication
app.use('/jobs/*', requireAuth)
app.route('/jobs', jobsRouter)
app.route('/vertex-ai', vertexAiRouter)
app.route('/uploads', uploadsRouter)
app.route('/customers', customersRouter)



app.get('/', (c) => {
  return c.text('Hello Hono!')
})

app.get('/health', async (c) => {
  try {
    // Test database connection
    await db.execute(sql`SELECT 1`)
    return c.json({ status: 'healthy', database: 'connected' })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ status: 'unhealthy', database: 'disconnected', error: errorMessage }, 500)
  }
})

// Protected route example
app.get('/protected', requireAuth, async (c: any) => {
  const user = c.get('user')
  
  return c.json({ 
    message: 'This is a protected route',
    user 
  })
})

serve({
  fetch: app.fetch,
  port: 3000
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})
