import { pgTable, text, timestamp, uuid, varchar, pgEnum, decimal } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// Enum for user roles
export const userRoleEnum = pgEnum('user_role', ['customer', 'contractor', 'admin'])

// Enum for job status
export const jobStatusEnum = pgEnum('job_status', ['pending', 'estimated', 'in_progress', 'completed', 'cancelled'])

// Users table
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password: varchar('password', { length: 255 }).notNull(),
  role: userRoleEnum('role').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Jobs table
export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description').notNull(),
  status: jobStatusEnum('status').default('pending').notNull(),
  customerName: varchar('customer_name', { length: 255 }).notNull(),
  customerAddress: text('customer_address').notNull(),
  customerPhone: varchar('customer_phone', { length: 20 }),
  appointmentDate: varchar('appointment_date', { length: 100 }),
  estimatedCost: decimal('estimated_cost', { precision: 10, scale: 2 }),
  customerId: uuid('customer_id').references(() => users.id).notNull(),
  contractorId: uuid('contractor_id').references(() => users.id).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Define relationships
export const usersRelations = relations(users, ({ many }) => ({
  customerJobs: many(jobs, { relationName: 'customer' }),
  contractorJobs: many(jobs, { relationName: 'contractor' }),
}))

export const jobsRelations = relations(jobs, ({ one }) => ({
  customer: one(users, {
    fields: [jobs.customerId],
    references: [users.id],
    relationName: 'customer',
  }),
  contractor: one(users, {
    fields: [jobs.contractorId],
    references: [users.id],
    relationName: 'contractor',
  }),
})) 