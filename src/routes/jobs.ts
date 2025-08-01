import { Hono } from 'hono'
import { db } from '../db/index.js'
import { jobs, users } from '../db/schema.js'
import { eq, or } from 'drizzle-orm'

const jobsRouter = new Hono()

// Get all jobs for the authenticated user
jobsRouter.get('/', async (c: any) => {
  try {
    const user = c.get('user')
    
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401)
    }

    let userJobs

    // Different logic based on user role
    if (user.role === 'admin') {
      // Admin can see all jobs
      userJobs = await db.query.jobs.findMany({
        orderBy: (jobs, { desc }) => [desc(jobs.createdAt)],
      })
    } else if (user.role === 'contractor') {
      // Contractor sees jobs assigned to them
      userJobs = await db.query.jobs.findMany({
        where: (jobs, { eq }) => eq(jobs.contractorId, user.id),
        orderBy: (jobs, { desc }) => [desc(jobs.createdAt)],
      })
    } else if (user.role === 'customer') {
      // Customer sees jobs they created
      userJobs = await db.query.jobs.findMany({
        where: (jobs, { eq }) => eq(jobs.customerId, user.id),
        orderBy: (jobs, { desc }) => [desc(jobs.createdAt)],
      })
    } else {
      return c.json({ error: 'Invalid user role' }, 400)
    }

    // Get user details for each job
    const jobsWithUsers = await Promise.all(
      userJobs.map(async (job) => {
        const customer = await db.query.users.findFirst({
          where: (users, { eq }) => eq(users.id, job.customerId),
        })
        const contractor = await db.query.users.findFirst({
          where: (users, { eq }) => eq(users.id, job.contractorId),
        })
        
        return {
          ...job,
          customer,
          contractor,
        }
      })
    )

    return c.json({ 
      jobs: jobsWithUsers,
      count: jobsWithUsers.length,
      user: {
        id: user.id,
        role: user.role,
      }
    })
  } catch (error) {
    console.error('Get jobs error:', error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// Get a specific job by ID (if user has access to it)
jobsRouter.get('/:id', async (c: any) => {
  try {
    const user = c.get('user')
    const jobId = c.req.param('id')
    
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401)
    }

    const job = await db.query.jobs.findFirst({
      where: (jobs, { eq }) => eq(jobs.id, jobId),
    })

    if (!job) {
      return c.json({ error: 'Job not found' }, 404)
    }

    // Check if user has access to this job
    const hasAccess = 
      user.role === 'admin' ||
      (user.role === 'contractor' && job.contractorId === user.id) ||
      (user.role === 'customer' && job.customerId === user.id)

    if (!hasAccess) {
      return c.json({ error: 'Access denied' }, 403)
    }

    // Get user details
    const customer = await db.query.users.findFirst({
      where: (users, { eq }) => eq(users.id, job.customerId),
    })
    const contractor = await db.query.users.findFirst({
      where: (users, { eq }) => eq(users.id, job.contractorId),
    })

    return c.json({ 
      job: {
        ...job,
        customer,
        contractor,
      }
    })
  } catch (error) {
    console.error('Get job error:', error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// Create a new job (only customers can create jobs)
jobsRouter.post('/', async (c: any) => {
  try {
    const user = c.get('user')
    const { 
      title, 
      description, 
      customerName, 
      customerAddress, 
      customerPhone, 
      appointmentDate, 
      estimatedCost, 
      contractorId 
    } = await c.req.json()
    
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401)
    }

    if (user.role !== 'customer') {
      return c.json({ error: 'Only customers can create jobs' }, 403)
    }

    if (!title || !description || !customerName || !customerAddress || !contractorId) {
      return c.json({ error: 'Missing required fields' }, 400)
    }

    // Verify contractor exists
    const contractor = await db.query.users.findFirst({
      where: (users, { eq, and }) => 
        and(eq(users.id, contractorId), eq(users.role, 'contractor')),
    })

    if (!contractor) {
      return c.json({ error: 'Contractor not found' }, 404)
    }

    const [newJob] = await db.insert(jobs).values({
      title,
      description,
      customerName,
      customerAddress,
      customerPhone: customerPhone || null,
      appointmentDate: appointmentDate || null,
      estimatedCost: estimatedCost ? estimatedCost.toString() : null,
      customerId: user.id,
      contractorId,
      status: 'pending',
    }).returning()

    return c.json({ 
      message: 'Job created successfully',
      job: newJob
    }, 201)
  } catch (error) {
    console.error('Create job error:', error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// Update job status
jobsRouter.patch('/:id/status', async (c: any) => {
  try {
    const user = c.get('user')
    const jobId = c.req.param('id')
    const { status } = await c.req.json()
    
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401)
    }

    if (!['pending', 'estimated', 'in_progress', 'completed', 'cancelled'].includes(status)) {
      return c.json({ error: 'Invalid status' }, 400)
    }

    // Get the job
    const job = await db.query.jobs.findFirst({
      where: (jobs, { eq }) => eq(jobs.id, jobId),
    })

    if (!job) {
      return c.json({ error: 'Job not found' }, 404)
    }

    // Check if user can update this job
    const canUpdate = 
      user.role === 'admin' ||
      (user.role === 'contractor' && job.contractorId === user.id) ||
      (user.role === 'customer' && job.customerId === user.id)

    if (!canUpdate) {
      return c.json({ error: 'Access denied' }, 403)
    }

    const [updatedJob] = await db.update(jobs)
      .set({ 
        status,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId))
      .returning()

    return c.json({ 
      message: 'Job status updated successfully',
      job: updatedJob
    })
  } catch (error) {
    console.error('Update job status error:', error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// Update job details
jobsRouter.patch('/:id', async (c: any) => {
  try {
    const user = c.get('user')
    const jobId = c.req.param('id')
    const updateData = await c.req.json()
    
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401)
    }

    // Get the job
    const job = await db.query.jobs.findFirst({
      where: (jobs, { eq }) => eq(jobs.id, jobId),
    })

    if (!job) {
      return c.json({ error: 'Job not found' }, 404)
    }

    // Check if user can update this job
    const canUpdate = 
      user.role === 'admin' ||
      (user.role === 'contractor' && job.contractorId === user.id) ||
      (user.role === 'customer' && job.customerId === user.id)

    if (!canUpdate) {
      return c.json({ error: 'Access denied' }, 403)
    }

    // Prepare update data
    const updateFields: any = {
      updatedAt: new Date(),
    }

    // Only allow updating certain fields
    if (updateData.title) updateFields.title = updateData.title
    if (updateData.description) updateFields.description = updateData.description
    if (updateData.customerName) updateFields.customerName = updateData.customerName
    if (updateData.customerAddress) updateFields.customerAddress = updateData.customerAddress
    if (updateData.customerPhone !== undefined) updateFields.customerPhone = updateData.customerPhone
    if (updateData.appointmentDate !== undefined) updateFields.appointmentDate = updateData.appointmentDate
    if (updateData.estimatedCost !== undefined) updateFields.estimatedCost = parseFloat(updateData.estimatedCost)
    if (updateData.status) updateFields.status = updateData.status

    const [updatedJob] = await db.update(jobs)
      .set(updateFields)
      .where(eq(jobs.id, jobId))
      .returning()

    return c.json({ 
      message: 'Job updated successfully',
      job: updatedJob
    })
  } catch (error) {
    console.error('Update job error:', error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

export default jobsRouter 