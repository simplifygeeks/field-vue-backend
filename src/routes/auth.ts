import { Hono } from 'hono'
import { db } from '../db/index.js'
import { users, jobs } from '../db/schema.js'
import { 
  hashPassword, 
  comparePassword, 
  generateToken, 
  verifyToken
} from '../auth/config.js'

const authRouter = new Hono()

// Function to create temporary jobs for new users
async function createTemporaryJobs(userId: string, userName: string) {
  try {
    // Find a contractor to assign jobs to (or create a default one)
    let contractor = await db.query.users.findFirst({
      where: (users, { eq }) => eq(users.role, 'contractor'),
    })

    // If no contractor exists, create a default one
    if (!contractor) {
      const [defaultContractor] = await db.insert(users).values({
        name: 'Default Contractor',
        email: 'contractor@example.com',
        password: await hashPassword('temp123'), // Temporary password
        role: 'contractor',
      }).returning()
      contractor = defaultContractor
    }

    // Create three temporary jobs
    const temporaryJobs = [
      {
        title: 'Kitchen Wall Painting',
        description: 'Paint the kitchen walls with a fresh coat. The walls are currently white and need to be painted in a light beige color. Area is approximately 200 sq ft.',
        customerName: userName,
        customerAddress: '123 Main Street, Anytown, USA',
        customerPhone: '+1-555-0123',
        appointmentDate: '2024-01-15',
        estimatedCost: '450.00',
        customerId: userId,
        contractorId: contractor.id,
        status: 'pending' as const,
      },
      {
        title: 'Living Room Ceiling Repair',
        description: 'Fix water damage on the living room ceiling. There are visible water stains and some peeling paint. Need to patch, prime, and repaint the affected area.',
        customerName: userName,
        customerAddress: '123 Main Street, Anytown, USA',
        customerPhone: '+1-555-0123',
        appointmentDate: '2024-01-20',
        estimatedCost: '300.00',
        customerId: userId,
        contractorId: contractor.id,
        status: 'estimated' as const,
      },
      {
        title: 'Bedroom Door Installation',
        description: 'Install a new interior door for the master bedroom. The old door is damaged and needs replacement. Standard 32" x 80" door with hardware.',
        customerName: userName,
        customerAddress: '123 Main Street, Anytown, USA',
        customerPhone: '+1-555-0123',
        appointmentDate: '2024-01-25',
        estimatedCost: '250.00',
        customerId: userId,
        contractorId: contractor.id,
        status: 'pending' as const,
      }
    ]

    // Insert all temporary jobs
    const createdJobs = await db.insert(jobs).values(temporaryJobs).returning()
    
    console.log(`Created ${createdJobs.length} temporary jobs for user ${userName}`)
    return createdJobs
  } catch (error) {
    console.error('Error creating temporary jobs:', error)
    // Don't fail the signup if job creation fails
    return []
  }
}

// Register endpoint
authRouter.post('/register', async (c) => {
  try {
    const { name, email, password, role } = await c.req.json()

    if (!name || !email || !password || !role) {
      return c.json({ error: 'Missing required fields' }, 400)
    }

    // Check if user already exists
    const existingUser = await db.query.users.findFirst({
      where: (users, { eq }) => eq(users.email, email),
    })

    if (existingUser) {
      return c.json({ error: 'User already exists' }, 409)
    }

    // Hash password
    const hashedPassword = await hashPassword(password)

    // Create user
    const [newUser] = await db.insert(users).values({
      name,
      email,
      password: hashedPassword,
      role,
    }).returning()

    // Create temporary jobs for customers
    let temporaryJobs = []
    if (role === 'customer') {
      temporaryJobs = await createTemporaryJobs(newUser.id, newUser.name)
    }

    // Generate JWT token
    const token = generateToken({
      userId: newUser.id,
      email: newUser.email,
      role: newUser.role,
    })

    return c.json({ 
      message: 'User created successfully',
      token,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
      },
      temporaryJobs: temporaryJobs.length > 0 ? temporaryJobs.length : undefined
    }, 201)
  } catch (error) {
    console.error('Registration error:', error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// Login endpoint
authRouter.post('/login', async (c) => {
  try {
    const { email, password } = await c.req.json()

    if (!email || !password) {
      return c.json({ error: 'Email and password are required' }, 400)
    }

    // Find user by email
    const user = await db.query.users.findFirst({
      where: (users, { eq }) => eq(users.email, email),
    })

    if (!user) {
      return c.json({ error: 'Invalid credentials' }, 401)
    }

    // Verify password
    const isValidPassword = await comparePassword(password, user.password)

    if (!isValidPassword) {
      return c.json({ error: 'Invalid credentials' }, 401)
    }

    // Generate JWT token
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    })

    return c.json({ 
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      }
    })
  } catch (error) {
    console.error('Login error:', error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// Logout endpoint
authRouter.post('/logout', async (c) => {
  try {
    const authHeader = c.req.header('Authorization')
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'No token provided' }, 401)
    }

    const token = authHeader.substring(7)
    const payload = verifyToken(token)

    if (!payload) {
      return c.json({ error: 'Invalid token' }, 401)
    }

    // In a pure JWT implementation, logout is handled client-side
    // by removing the token. Server-side, we could implement a token
    // blacklist if needed for security.
    return c.json({ message: 'Logged out successfully' })
  } catch (error) {
    console.error('Logout error:', error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// Get current user
authRouter.get('/me', async (c) => {
  try {
    const authHeader = c.req.header('Authorization')
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'No token provided' }, 401)
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

    return c.json({ 
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      }
    })
  } catch (error) {
    console.error('Get user error:', error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

export default authRouter 