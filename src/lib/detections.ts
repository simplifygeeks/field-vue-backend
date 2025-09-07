import 'dotenv/config'
import { db } from '../db/index.js'
import { rooms } from '../db/schema.js'
import { eq } from 'drizzle-orm'

const DETECTION_ENDPOINT = process.env.DETECTION_ENDPOINT!
type CountsMap = Record<string, number>

function normalizeType(type: string | null | undefined): string | null {
  if (!type) return null
  return String(type).trim().toLowerCase().replace(/\s+/g, '_')
}

function addToMap(map: CountsMap, key: string, value: number) {
  if (!key) return
  map[key] = (map[key] || 0) + (Number.isFinite(value) ? value : 0)
}

function toNumber(value: unknown): number | null {
  if (value == null) return null
  const n = typeof value === 'string' ? parseFloat(value) : typeof value === 'number' ? value : NaN
  return Number.isFinite(n) ? n : null
}

async function callDetectionApi(imageUrl: string): Promise<any> {
  if (imageUrl.startsWith('gs://')) {
    throw new Error('Detection API requires HTTP-accessible image; got gs:// URI')
  }

  const imgResp = await fetch(imageUrl)
  if (!imgResp.ok) throw new Error(`Failed to fetch image: HTTP ${imgResp.status}`)
  const contentType = imgResp.headers.get('content-type') || 'application/octet-stream'
  const arrayBuffer = await imgResp.arrayBuffer()
  const blob = new Blob([arrayBuffer], { type: contentType })

  const form = new FormData()
  // Derive a filename from URL path
  const urlPath = (() => {
    try {
      return new URL(imageUrl).pathname
    } catch {
      return 'image'
    }
  })()
  const fileName = urlPath.split('/').pop() || 'image'
  form.append('image', blob, fileName)

  const resp = await fetch(`${DETECTION_ENDPOINT}/api/object-detection`, {
    method: 'POST',
    body: form,
  })
  if (!resp.ok) {
    console.log('rrr',resp)
    throw new Error(`Detection API HTTP ${resp.status}`)
  }
  return await resp.json()
}

export async function analyzeImagesForRoom(roomId: string, imageUrls: string[]): Promise<void> {
  try {
    const perImage: Array<{ url: string; summary: { countsByType: CountsMap; areaSqftByType: CountsMap }; raw: any }> = []
    const totalCounts: CountsMap = {}
    const totalArea: CountsMap = {}
    let roomDimensions: { estimated_width?: number | null; estimated_height?: number | null; estimated_length?: number | null } = {}

    for (const url of imageUrls) {
      try {
        const json = await callDetectionApi(url)


        // Per-image maps
        const countsByType: CountsMap = {}
        const areaSqftByType: CountsMap = {}

        // objects[]
        if (Array.isArray(json?.objects)) {
          for (const obj of json.objects) {
            const key = normalizeType(obj?.type) || normalizeType(obj?.name) || 'object'
            addToMap(countsByType, key, 1)
            const w = toNumber(obj?.estimated_width_feet)
            const h = toNumber(obj?.estimated_height_feet)
            const area = w != null && h != null ? w * h : null
            if (area != null) addToMap(areaSqftByType, key, area)
          }
        }

        // architectural_elements {}
        const ae = json?.architectural_elements || {}
        for (const category of Object.keys(ae)) {
          const items = Array.isArray(ae[category]) ? ae[category] : []
          for (const it of items) {
            const key = normalizeType(category) || 'architectural'
            addToMap(countsByType, key, 1)
            const area = toNumber(it?.surface_area)
            if (area != null) addToMap(areaSqftByType, key, area)
            const w = toNumber(it?.estimated_width_feet)
            const h = toNumber(it?.estimated_height_feet)
            const whArea = w != null && h != null ? w * h : null
            if (whArea != null) addToMap(areaSqftByType, key, whArea)
          }
        }

        // room_dimensions
        if (json?.room_dimensions) {
          roomDimensions = {
            estimated_width: toNumber(json.room_dimensions.estimated_width) ?? roomDimensions.estimated_width ?? null,
            estimated_height: toNumber(json.room_dimensions.estimated_height) ?? roomDimensions.estimated_height ?? null,
            estimated_length: toNumber(json.room_dimensions.estimated_length) ?? roomDimensions.estimated_length ?? null,
          }
        }

        // Push per-image
        perImage.push({ url, summary: { countsByType, areaSqftByType }, raw: json })

        // Accumulate totals
        for (const k of Object.keys(countsByType)) addToMap(totalCounts, k, countsByType[k])
        for (const k of Object.keys(areaSqftByType)) addToMap(totalArea, k, areaSqftByType[k])
      } catch (err) {
        // Skip failing image but continue others
        perImage.push({ url, summary: { countsByType: {}, areaSqftByType: {} }, raw: { error: (err as Error).message } })
      }
    }

    // Build measurements payload
    // Build consolidated items: combine counts and area per type
    const allTypes = new Set<string>([
      ...Object.keys(totalCounts),
      ...Object.keys(totalArea),
    ])
    const items = Array.from(allTypes).map((type) => ({
      type,
      count: totalCounts[type] || 0,
      sqft: totalArea[type] || 0,
    }))

    const measurements = {
      processedAt: new Date().toISOString(),
      images: perImage,
      aggregates: {
        // consolidated array for UI editing side-by-side
        items,
        // keep maps for potential analytics/back-compat
        countsByType: totalCounts,
        areaSqftByType: totalArea,
        roomDimensions,
      },
      model: {
        endpoint: DETECTION_ENDPOINT,
      },
    }

    await db.update(rooms).set({ measurements }).where(eq(rooms.id, roomId))
  } catch (err) {
    // Swallow errors to avoid crashing background flow
    console.error("Error with detection analysis", err)
    return
  }
}


