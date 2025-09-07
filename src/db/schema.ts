import { pgTable, text, timestamp, uuid, varchar, pgEnum, decimal, jsonb, integer } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// Enum for user roles
export const userRoleEnum = pgEnum('user_role', ['customer', 'contractor', 'admin'])

// Enum for job status
export const jobStatusEnum = pgEnum('job_status', ['pending', 'estimated', 'in_progress', 'completed', 'cancelled'])

// Enum for room type

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

// Customers table
export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  address: text("address"),
  phoneNumber: varchar('phone_number', { length: 20 }),
  email: varchar('email', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  createdBy: uuid('created_by').references(() => users.id),
})

// Jobs table
export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobNumber: integer('job_number').generatedAlwaysAsIdentity(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  status: jobStatusEnum('status').default('pending').notNull(),
  customerName: varchar('customer_name', { length: 255 }),
  customerAddress: text('customer_address'),
  customerPhone: varchar('customer_phone', { length: 20 }),
  appointmentDate: varchar('appointment_date', { length: 100 }),
  estimatedCost: decimal('estimated_cost', { precision: 10, scale: 2 }),
  estimation: jsonb('estimation'),
  customerId: uuid('customer_id'),
  contractorId: uuid('contractor_id').references(() => users.id).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Rooms table (stores images and measurements as JSON for flexibility)
export const rooms = pgTable('rooms', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').references(() => jobs.id).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  roomType: text('room_type').default("interior"), // 'interior' | 'exterior'
  imageUrls: jsonb('image_urls'), // array of image URL strings
  measurements: jsonb('measurements'), // arbitrary JSON for counts/areas/overrides
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Define relationships
export const usersRelations = relations(users, ({ many }) => ({
  contractorJobs: many(jobs, { relationName: 'contractor' }),
}))

export const jobsRelations = relations(jobs, ({ one }) => ({
  contractor: one(users, {
    fields: [jobs.contractorId],
    references: [users.id],
    relationName: 'contractor',
  }),
})) 