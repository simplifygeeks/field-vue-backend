import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { db } from './db/index.js'
import { sql } from 'drizzle-orm'
import authRouter from './routes/auth.js'
import jobsRouter from './routes/jobs.js'
import { requireAuth } from './middleware/auth.js'

const app = new Hono()

// Mount auth routes
app.route('/auth', authRouter)

// Mount jobs routes with authentication
app.use('/jobs/*', requireAuth)
app.route('/jobs', jobsRouter)

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
