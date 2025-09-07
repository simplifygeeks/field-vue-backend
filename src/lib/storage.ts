import 'dotenv/config'
import { Storage } from '@google-cloud/storage'

const bucketName = process.env.GCS_BUCKET_NAME!

// Uses ADC. Ensure GOOGLE_APPLICATION_CREDENTIALS or workload identity is set.
export const storage = new Storage()

export async function uploadBuffer(
  fileBuffer: Buffer,
  destinationPath: string,
  options?: { contentType?: string; makePublic?: boolean }
): Promise<{ gcsUri: string; publicUrl?: string }> {
  const bucket = storage.bucket(bucketName)
  const file = bucket.file(destinationPath)

  await file.save(fileBuffer, {
    contentType: options?.contentType,
    resumable: false,
    metadata: options?.contentType ? { contentType: options.contentType } : undefined,
  })

  let publicUrl: string | undefined
  if (options?.makePublic) {
    await file.makePublic()
    publicUrl = `https://storage.googleapis.com/${bucketName}/${encodeURI(destinationPath)}`
  }

  return { gcsUri: `gs://${bucketName}/${destinationPath}`, publicUrl }
}


