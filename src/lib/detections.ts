import 'dotenv/config'
import { db } from '../db/index.js'
import { rooms, roomImages } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'

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

function getMaxReasonableCount(objectType: string): number {
  const type = objectType.toLowerCase()
  
  // Define maximum reasonable counts per photo for each object type
  const maxCounts: Record<string, number> = {
    ceiling: 1,        // Only 1 ceiling visible per room photo
    roof: 1,          // Only 1 roof section visible per exterior photo
    wall: 4,          // Maximum 4 walls visible in a room photo
    window: 6,         // Maximum 6 windows visible (unusual but possible)
    door: 3,          // Maximum 3 doors visible (unusual but possible)
    trim: 10,         // Multiple trim pieces possible
    moulding: 10,     // Multiple moulding pieces possible
    baseboard: 8,     // Multiple baseboard sections possible
    railing: 3,       // Maximum 3 railing sections visible
    gutter: 4,        // Maximum 4 gutter sections visible
  }
  
  return maxCounts[type] || 5 // Default maximum of 5 for unknown types
}

async function callDetectionApi(imageUrl: string, roomType: string = 'interior'): Promise<any> {
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

  // Use our new AI endpoint instead of external Vercel endpoint
  const baseUrl = process.env.API_BASE_URL || 'http://localhost:3000'
  const resp = await fetch(`${baseUrl}/ai/object-detection?type=${roomType}`, {
    method: 'POST',
    body: form,
  })
  if (!resp.ok) {
    console.error('AI Detection API error:', resp.status, await resp.text())
    throw new Error(`AI Detection API HTTP ${resp.status}`)
  }
  const result = await resp.json()
  
  // Return the analysis object from our new API format
  return result.analysis || result
}

export async function analyzeImagesForRoom(roomId: string, imageUrls: string[], roomType: string = 'interior'): Promise<void> {
  try {
    const perImage: Array<{ url: string; summary: { countsByType: CountsMap; areaSqftByType: CountsMap }; raw: any }> = []
    const totalCounts: CountsMap = {}
    const totalArea: CountsMap = {}
    let roomDimensions: { estimated_width?: number | null; estimated_height?: number | null; estimated_length?: number | null } = {}

    for (const url of imageUrls) {
      try {
        const json = await callDetectionApi(url, roomType)


        // Per-image maps
        const countsByType: CountsMap = {}
        const areaSqftByType: CountsMap = {}

        // Our new API returns objects[] directly
        if (Array.isArray(json?.objects)) {
          // Track counts per type to validate realistic numbers
          const typeCounts: Record<string, number> = {}
          
          for (const obj of json.objects) {
            // Accept high confidence by default; allow medium/low for siding/foundation to improve recall
            const confidence = obj?.confidence?.toLowerCase()
            let typeKey = normalizeType(obj?.type) || normalizeType(obj?.name) || 'object'
            // Canonicalize common synonyms/mislabels for exterior
            if (typeKey === 'wall' || typeKey === 'cladding') typeKey = 'siding'
            // Only convert specific foundation-related terms to foundation; brick/masonry walls should be siding
            if (typeKey === 'masonry_foundation' || typeKey === 'brick_foundation') typeKey = 'foundation'
            // If it's brick or masonry but not explicitly foundation, treat as siding (brick walls are siding)
            if (typeKey === 'masonry' || typeKey === 'brick') typeKey = 'siding'
            const isFoundationOrSiding = typeKey === 'foundation' || typeKey === 'siding'
            // Accept high confidence for all types; accept medium/low for siding/foundation to improve recall
            if (!(confidence === 'high' || (isFoundationOrSiding && (confidence === 'medium' || confidence === 'low')))) {
              console.log(`Skipping ${typeKey} with confidence: ${confidence}`)
              continue
            }

            typeCounts[typeKey] = (typeCounts[typeKey] || 0) + 1
            
            // For exterior, do not enforce a max per-photo count cap
            // (User requested removing reasonable count restriction for exterior)
            
            addToMap(countsByType, typeKey, 1)
            
            // Use surface_area if available, otherwise calculate from width/height
            const area = toNumber(obj?.surface_area)
            if (area != null) {
              addToMap(areaSqftByType, typeKey, area)
            } else {
              const w = toNumber(obj?.estimated_width_feet)
              const h = toNumber(obj?.estimated_height_feet)
              const calculatedArea = w != null && h != null ? w * h : null
              if (calculatedArea != null) addToMap(areaSqftByType, typeKey, calculatedArea)
            }
          }
        }

        // Our new API doesn't have architectural_elements, everything is in objects[]
        // But we can still check for room_dimensions if they exist
        if (json?.room_dimensions) {
          roomDimensions = {
            estimated_width: toNumber(json.room_dimensions.estimated_width) ?? roomDimensions.estimated_width ?? null,
            estimated_height: toNumber(json.room_dimensions.estimated_height) ?? roomDimensions.estimated_height ?? null,
            estimated_length: toNumber(json.room_dimensions.estimated_length) ?? roomDimensions.estimated_length ?? null,
          }
        }

        // Store individual image measurements in roomImages table
        const imageMeasurements = {
          processedAt: new Date().toISOString(),
          objects: json?.objects || [],
          scene: json?.scene || '',
          summary: json?.summary || '',
          countsByType,
          areaSqftByType,
          roomDimensions: json?.room_dimensions || null,
        }

        // Insert or update room image record
        try {
          await db.insert(roomImages).values({
            roomId,
            imageUrl: url,
            measurements: imageMeasurements,
            processedAt: new Date(),
          })
        } catch (error) {
          // If record exists, update it
          await db.update(roomImages)
            .set({
              measurements: imageMeasurements,
              processedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(and(eq(roomImages.roomId, roomId), eq(roomImages.imageUrl, url)))
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
        endpoint: 'internal-ai-object-detection',
        type: roomType,
      },
    }

    await db.update(rooms).set({ measurements }).where(eq(rooms.id, roomId))
  } catch (err) {
    // Swallow errors to avoid crashing background flow
    console.error("Error with detection analysis", err)
    return
  }
}


