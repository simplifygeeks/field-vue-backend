import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth.js'
import { uploadBuffer } from '../lib/storage.js'

const uploadsRouter = new Hono()

uploadsRouter.use('*', requireAuth)

uploadsRouter.post('/', async (c: any) => {
  const form = await c.req.formData()
  const file = form.get('file')
  const jobId = form.get('jobId') as string | null
  const roomId = form.get('roomId') as string | null
  const makePublic = (form.get('public') as string | null) === 'true'

  if (!file || typeof file === 'string') {
    return c.json({ error: 'file is required' }, 400)
  }

  const user = c.get('user')
  const blob = file as File | Blob
  const arrayBuffer = await blob.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  const contentType = (blob as any).type || 'application/octet-stream'
  const ext = contentType.split('/')[1] || 'bin'
  const now = new Date().toISOString().replace(/[:.]/g, '-')
  const base = `uploads/${user.id}/${jobId || 'no-job'}/${roomId || 'no-room'}/${now}-${Math.random().toString(36).slice(2)}.${ext}`

  const { gcsUri, publicUrl } = await uploadBuffer(buffer, base, { contentType, makePublic })

  return c.json({ success: true, gcsUri, publicUrl })
})

export default uploadsRouter


