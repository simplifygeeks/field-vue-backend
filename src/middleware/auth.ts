import { verifyToken } from '../auth/config.js'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { eq } from 'drizzle-orm'

export const requireAuth = async (c: any, next: any) => {
  try {
    const authHeader = c.req.header('Authorization')
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Authentication required' }, 401)
    }

    const token = authHeader.substring(7)
    const payload = verifyToken(token)

    if (!payload) {
      return c.json({ error: 'Invalid token' }, 401)
    }

    // Get user from database
    const user = await db.query.users.findFirst({
      where: (users, { eq }) => eq(users.id, payload.userId),
    })

    if (!user) {
      return c.json({ error: 'User not found' }, 404)
    }

    // Add user to context for use in route handlers
    c.set('user', {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    })
    
    await next()
  } catch (error) {
    console.error('Auth middleware error:', error)
    return c.json({ error: 'Authentication failed' }, 401)
  }
}

export const requireRole = (allowedRoles: string[]) => {
  return async (c: any, next: any) => {
    try {
      const authHeader = c.req.header('Authorization')
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json({ error: 'Authentication required' }, 401)
      }

      const token = authHeader.substring(7)
      const payload = verifyToken(token)

      if (!payload) {
        return c.json({ error: 'Invalid token' }, 401)
      }

      if (!allowedRoles.includes(payload.role)) {
        return c.json({ error: 'Insufficient permissions' }, 403)
      }

      // Get user from database
      const user = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, payload.userId),
      })

      if (!user) {
        return c.json({ error: 'User not found' }, 404)
      }

      c.set('user', {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      })
      
      await next()
    } catch (error) {
      console.error('Role middleware error:', error)
      return c.json({ error: 'Authorization failed' }, 403)
    }
  }
} 