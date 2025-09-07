import { Hono } from 'hono'
import { db } from '../db/index.js'
import { customers } from '../db/schema.js'
import { requireAuth } from '../middleware/auth.js'

const customersRouter = new Hono()

customersRouter.use('*', requireAuth)

// Create a customer
customersRouter.post('/', async (c: any) => {
  try {
    const user = c.get('user')
    const body = await c.req.json()
    const name: string = body?.name
    const email: string | undefined = body?.email
    const phoneNumber: string | undefined = body?.phone
    const address: string | undefined = body?.address

    if (!name) return c.json({ error: 'name is required' }, 400)

    const [created] = await db.insert(customers).values({
      name,
      email: email || null,
      phoneNumber: phoneNumber || null,
      address: address || null,
      createdBy: user?.id || null,
    }).returning()

    return c.json({
      message: 'Customer created',
      customer: created,
    }, 201)
  } catch (error) {
    console.error('Create customer error:', error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

export default customersRouter


