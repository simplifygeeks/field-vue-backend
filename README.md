# Field Vue Backend

A Hono-based backend API with PostgreSQL database using Drizzle ORM and JWT authentication.

## Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Start PostgreSQL Database
```bash
docker-compose up -d
```

### 3. Generate and Run Migrations
```bash
npm run db:generate
npm run db:migrate
```

### 4. Start Development Server
```bash
npm run dev
```

## Database Schema

### Users Table
- `id` (UUID, Primary Key)
- `name` (VARCHAR)
- `email` (VARCHAR, Unique)
- `password` (VARCHAR, Hashed)
- `role` (ENUM: customer, contractor, admin)
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP)

### Jobs Table
- `id` (UUID, Primary Key)
- `customer_id` (UUID, Foreign Key to users.id)
- `contractor_id` (UUID, Foreign Key to users.id)
- `service_type` (VARCHAR)
- `address` (TEXT)
- `status` (ENUM: pending, in_progress, completed, cancelled)
- `scheduled_at` (TIMESTAMP)
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP)

## Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run db:generate` - Generate migration files
- `npm run db:migrate` - Run migrations
- `npm run db:studio` - Open Drizzle Studio

## API Endpoints

### Public Endpoints
- `GET /` - Hello world
- `GET /health` - Health check with database connection test

### Authentication Endpoints
- `POST /auth/register` - Register a new user
- `POST /auth/login` - Login with email and password
- `POST /auth/logout` - Logout (client-side token removal)
- `GET /auth/me` - Get current user information

### Protected Endpoints
- `GET /protected` - Example protected route (requires authentication)

## Authentication

The API uses **JWT (JSON Web Tokens)** for stateless authentication. Include the token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

### JWT Features:
- **Stateless** - No server-side session storage
- **30-day expiration** - Tokens expire after 30 days
- **Role-based** - Tokens include user role information
- **Secure** - Signed with secret key

### Register User
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "password": "password123",
    "role": "customer"
  }'
```

### Login
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "password123"
  }'
```

### Access Protected Route
```bash
curl -X GET http://localhost:3000/protected \
  -H "Authorization: Bearer <your-jwt-token>"
```

## User Roles

- `customer` - Can create jobs and view their own jobs
- `contractor` - Can view and update jobs assigned to them
- `admin` - Full access to all features

## Environment Variables

Create a `.env` file in the root directory:

```env
JWT_SECRET=your-secret-key-change-in-production
```
