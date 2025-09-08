import { Hono } from "hono";
import { VertexAI } from "@google-cloud/vertexai";
import { Buffer } from "node:buffer";

const aiRouter = new Hono();

// Initialize Vertex AI with Gemini 2.5 Flash
const project = process.env.GOOGLE_PROJECT_ID!;
const location = process.env.GOOGLE_LOCATION || "us-central1";
const model = "gemini-2.5-flash"; // Using Gemini 2.5 Flash experimental model

const vertexAI = new VertexAI({
  project,
  location,
});

const generativeVisionModel = vertexAI.getGenerativeModel({ model });

// Object detection API with interior/exterior analysis
aiRouter.post("/object-detection", async (c: any) => {
  try {
    const formData = await c.req.formData();
    const image = formData.get("image") as File;
    const type = c.req.query("type") as string; // "interior" or "exterior"
    const zoom = parseFloat(c.req.query("zoom") || "1"); // Default zoom level 1

    if (!image) {
      return c.json({ error: "Image is required" }, 400);
    }

    if (!type || !["interior", "exterior"].includes(type)) {
      return c.json({ error: "Type must be 'interior' or 'exterior'" }, 400);
    }

    // Convert image to base64
    const buffer = Buffer.from(await image.arrayBuffer());
    const mimeType = image.type || "image/jpeg";
    const base64Image = buffer.toString("base64");

    // Define prompts based on type with enhanced dimension estimation
    const prompts = {
      interior: `You are a FieldVue AI assistant specialized in PRECISE interior construction analysis. Your job is to identify ONLY construction elements that are CLEARLY VISIBLE and relevant for painting/construction work.

CRITICAL ACCURACY REQUIREMENTS - ZERO TOLERANCE FOR FALSE POSITIVES:
- ONLY identify objects that are DEFINITIVELY present and clearly visible
- DO NOT make assumptions or guess about objects that might be there
- If you cannot clearly see an object, DO NOT include it
- Better to miss an object than to create a false positive
- Be extremely conservative in your identifications
- COUNT ONLY WHAT YOU CAN ACTUALLY SEE - NO ESTIMATIONS OR ASSUMPTIONS
- If you cannot count individual objects clearly, DO NOT include them
- NEVER count objects that are partially visible or uncertain
- DO NOT identify ceilings unless you can see actual ceiling material clearly
- DO NOT identify walls unless you can see actual wall material clearly
- DO NOT identify any object unless you are 100% certain it exists

OBJECTS TO DETECT (ONLY if clearly visible):
- Walls (must be clearly visible wall surfaces, not just edges or corners)
- Ceilings (must be clearly visible ceiling surfaces)
- Windows (must be clearly visible window frames/glass)
- Crown moulding/trim (must be clearly visible decorative trim)
- Doors (must be clearly visible door panels/frames)
- Railings (must be clearly visible railing structures)
- Baseboards (must be clearly visible baseboard trim)

DIMENSION ESTIMATION - BE EXTREMELY ACCURATE:

1. ZOOM LEVEL ANALYSIS (Current zoom: ${zoom}x):
   - If zoom > 1: Objects appear larger - REDUCE estimates significantly
   - If zoom < 1: Objects appear smaller - INCREASE estimates moderately
   - If zoom = 1: Use standard perspective

2. SCALE REFERENCE POINTS (use these for validation):
   - Standard door height: 6.5-8 feet
   - Standard window height: 4-6 feet
   - Standard ceiling height: 8-10 feet
   - Standard baseboard height: 4-8 inches
   - Standard crown moulding: 3-8 inches

3. ACCURACY VALIDATION:
   - Cross-reference ALL objects against known architectural standards
   - If an object seems unusually large/small, double-check your estimation
   - Use multiple objects in the scene to validate scale consistency
   - If scale doesn't make sense, mark confidence as "low"

4. CONSERVATIVE ESTIMATION:
   - When in doubt, estimate smaller rather than larger
   - Only provide dimensions for objects you can clearly measure
   - If an object is partially obscured, mark confidence as "medium" or "low"

STRICT IDENTIFICATION AND COUNTING RULES - KNOW WHAT YOU'RE LOOKING FOR:

1. WALLS: 
   - Must see actual wall surface (painted drywall, brick, wood paneling, etc.)
   - NOT just corners, edges, or shadows
   - Must be clearly visible wall material, not just lines or boundaries
   - Count each distinct wall surface separately

2. CEILINGS - EXTREMELY STRICT IDENTIFICATION:
   - Must see actual ceiling surface material (drywall, plaster, wood planks, etc.)
   - Must be clearly visible ceiling material above the room
   - NOT just ceiling lines, moldings, shadows, or architectural features
   - NOT just the top edge of walls or corners
   - NOT just lighting fixtures or ceiling fans
   - NOT just ceiling paint or texture - must see actual ceiling surface
   - Typically only 1 ceiling per room visible in a photo
   - If you cannot clearly see actual ceiling material, DO NOT identify as ceiling
   - If you are not 100% certain it's a ceiling, DO NOT include it
   - Most photos do NOT show ceilings clearly - be very conservative

3. WINDOWS:
   - Must see actual window frame AND glass
   - Must be clearly recognizable as a window opening
   - NOT just reflections, shadows, or wall decorations
   - Count each individual window separately

4. DOORS:
   - Must see actual door panel AND door frame
   - Must be clearly recognizable as a door opening
   - NOT just doorways without doors or shadows
   - Count each individual door separately

5. TRIM/MOULDING:
   - Must see actual decorative trim pieces (baseboards, crown molding, casings)
   - Must be clearly visible trim material, not just lines or shadows
   - Count each distinct trim piece separately

6. RAILINGS:
   - Must see actual railing structure (posts, balusters, handrails)
   - Must be clearly recognizable as a railing system
   - NOT just shadows or decorative elements
   - Count each distinct railing section separately

WHAT NOT TO IDENTIFY (COMMON FALSE POSITIVES):
- Ceiling lines, ceiling moldings, or ceiling shadows are NOT ceilings
- Wall corners, wall edges, or wall shadows are NOT walls
- Reflections in mirrors or glass are NOT windows
- Doorways without doors are NOT doors
- Decorative lines or patterns are NOT trim
- Shadows or lighting effects are NOT objects
- Furniture, appliances, or decorations are NOT construction elements

CRITICAL WARNING - CEILING HALLUCINATIONS:
- DO NOT identify ceilings unless you can see actual ceiling material
- Most interior photos do NOT show ceilings clearly
- If you see the top edge of walls, that is NOT a ceiling
- If you see lighting fixtures, that is NOT a ceiling
- If you see shadows or lines at the top, that is NOT a ceiling
- Only identify ceilings if you can see actual ceiling surface material
- When in doubt about ceilings, DO NOT include them

COUNTING PRINCIPLES:
- NEVER count more than what is physically possible in a single photo
- A typical room photo shows 1 ceiling, 2-4 walls, 0-3 windows, 0-2 doors
- If you see multiple objects of the same type, count them individually only if clearly distinct
- If objects are connected or part of the same structure, count as 1
- When in doubt about count, use 1 or 0 - never guess higher numbers
- If you cannot clearly identify what an object is, DO NOT include it

CONFIDENCE LEVELS:
- "high": Object is completely visible and clearly identifiable
- "medium": Object is mostly visible but may be partially obscured
- "low": Object is partially visible or identification is uncertain

For each detected object, provide:
- name: Specific descriptive name
- confidence: "high", "medium", or "low" based on visibility
- bounding_box: {x, y, width, height} as percentages (0-100)
- type: One of the object types listed above
- estimated_width_feet: Conservative width estimate in feet
- estimated_height_feet: Conservative height estimate in feet
- surface_area: Conservative surface area in square feet

Respond ONLY as JSON in this exact format:
{
  "objects": [
    {
      "name": "specific object description",
      "confidence": "high/medium/low",
      "bounding_box": {
        "x": percentage_from_left_edge,
        "y": percentage_from_top_edge,
        "width": percentage_of_image_width,
        "height": percentage_of_image_height
      },
      "type": "wall/ceiling/window/crown_moulding/door/trim/railing/baseboard",
      "estimated_width_feet": number,
      "estimated_height_feet": number,
      "surface_area": number
    }
  ],
  "scene": "brief description of what you actually see",
  "summary": "summary of only the clearly visible construction elements"
}`,

      exterior: `You are a FieldVue AI assistant specialized in PRECISE exterior construction analysis. Your job is to identify ONLY construction elements that are CLEARLY VISIBLE and relevant for painting/construction work.

CRITICAL ACCURACY REQUIREMENTS - ZERO TOLERANCE FOR FALSE POSITIVES:
- ONLY identify objects that are DEFINITIVELY present and clearly visible
- DO NOT make assumptions or guess about objects that might be there
- If you cannot clearly see an object, DO NOT include it
- Better to miss an object than to create a false positive
- Be extremely conservative in your identifications
- COUNT ONLY WHAT YOU CAN ACTUALLY SEE - NO ESTIMATIONS OR ASSUMPTIONS
- If you cannot count individual objects clearly, DO NOT include them
- NEVER count objects that are partially visible or uncertain
- DO NOT identify roofs unless you can see actual roof material clearly
- DO NOT identify walls unless you can see actual wall material clearly
- DO NOT identify any object unless you are 100% certain it exists

OBJECTS TO DETECT (ONLY if clearly visible):
- Exterior walls (must be clearly visible wall surfaces with siding/brick/stucco)
- Windows (must be clearly visible window frames/glass)
- Roofs (must be clearly visible roof sections/materials)
- Doors (must be clearly visible door panels/frames)
- Trim work (must be clearly visible exterior trim/fascia/soffits)
- Gutters (must be clearly visible gutter systems)
- Exterior railings (must be clearly visible railing structures)

DIMENSION ESTIMATION - BE EXTREMELY ACCURATE:

1. ZOOM LEVEL ANALYSIS (Current zoom: ${zoom}x):
   - If zoom > 1: Objects appear larger - REDUCE estimates significantly
   - If zoom < 1: Objects appear smaller - INCREASE estimates moderately
   - If zoom = 1: Use standard perspective

2. SCALE REFERENCE POINTS (use these for validation):
   - Standard exterior door height: 6.5-8 feet
   - Standard window height: 4-6 feet
   - Standard single-story height: 8-12 feet
   - Standard gutter width: 5-6 inches
   - Standard fascia height: 8-12 inches

3. ACCURACY VALIDATION:
   - Cross-reference ALL objects against known architectural standards
   - If an object seems unusually large/small, double-check your estimation
   - Use multiple objects in the scene to validate scale consistency
   - If scale doesn't make sense, mark confidence as "low"

4. CONSERVATIVE ESTIMATION:
   - When in doubt, estimate smaller rather than larger
   - Only provide dimensions for objects you can clearly measure
   - If an object is partially obscured, mark confidence as "medium" or "low"

STRICT IDENTIFICATION AND COUNTING RULES - KNOW WHAT YOU'RE LOOKING FOR:

1. EXTERIOR WALLS:
   - Must see actual wall surface (siding, brick, stucco, wood, etc.)
   - NOT just wall lines, shadows, or architectural features
   - Must be clearly visible wall material, not just boundaries
   - Count each distinct wall section separately

2. WINDOWS:
   - Must see actual window frame AND glass
   - Must be clearly recognizable as a window opening
   - NOT just reflections, shadows, or decorative elements
   - Count each individual window separately

3. ROOFS:
   - Must see actual roof surface (shingles, tiles, metal, etc.)
   - NOT just roof lines, shadows, or architectural features
   - Must be clearly visible roof material
   - Typically only 1 roof section visible per photo
   - If you cannot clearly see roof material, DO NOT identify as roof

4. DOORS:
   - Must see actual door panel AND door frame
   - Must be clearly recognizable as a door opening
   - NOT just doorways without doors or shadows
   - Count each individual door separately

5. TRIM/FASCIA:
   - Must see actual exterior trim elements (fascia, soffits, corner trim)
   - Must be clearly visible trim material, not just lines or shadows
   - Count each distinct trim piece separately

6. GUTTERS:
   - Must see actual gutter system (gutters, downspouts)
   - Must be clearly recognizable as gutter components
   - NOT just shadows or architectural lines
   - Count each distinct gutter section separately

7. RAILINGS:
   - Must see actual railing structure (posts, balusters, handrails)
   - Must be clearly recognizable as a railing system
   - NOT just shadows or decorative elements
   - Count each distinct railing section separately

WHAT NOT TO IDENTIFY (COMMON FALSE POSITIVES):
- Roof lines, roof shadows, or architectural features are NOT roofs
- Wall lines, wall shadows, or architectural features are NOT walls
- Reflections in windows or glass are NOT additional windows
- Doorways without doors are NOT doors
- Decorative lines or patterns are NOT trim
- Shadows or lighting effects are NOT objects
- Landscaping, vehicles, or decorations are NOT construction elements

COUNTING PRINCIPLES:
- NEVER count more than what is physically possible in a single photo
- A typical exterior photo shows 1-2 wall sections, 1 roof section, 0-4 windows, 0-2 doors
- If you see multiple objects of the same type, count them individually only if clearly distinct
- If objects are connected or part of the same structure, count as 1
- When in doubt about count, use 1 or 0 - never guess higher numbers
- If you cannot clearly identify what an object is, DO NOT include it

CONFIDENCE LEVELS:
- "high": Object is completely visible and clearly identifiable
- "medium": Object is mostly visible but may be partially obscured
- "low": Object is partially visible or identification is uncertain

For each detected object, provide:
- name: Specific descriptive name
- confidence: "high", "medium", or "low" based on visibility
- bounding_box: {x, y, width, height} as percentages (0-100)
- type: One of the object types listed above
- estimated_width_feet: Conservative width estimate in feet
- estimated_height_feet: Conservative height estimate in feet
- surface_area: Conservative surface area in square feet

Respond ONLY as JSON in this exact format:
{
  "objects": [
    {
      "name": "specific object description",
      "confidence": "high/medium/low",
      "bounding_box": {
        "x": percentage_from_left_edge,
        "y": percentage_from_top_edge,
        "width": percentage_of_image_width,
        "height": percentage_of_image_height
      },
      "type": "wall/window/roof/door/trim/gutter/railing",
      "estimated_width_feet": number,
      "estimated_height_feet": number,
      "surface_area": number
    }
  ],
  "scene": "brief description of what you actually see",
  "summary": "summary of only the clearly visible construction elements"
}`
    };

    const filePart = { inlineData: { data: base64Image, mimeType } };
    const textPart = { text: prompts[type as keyof typeof prompts] };

    const request = {
      contents: [{ role: "user", parts: [textPart, filePart] }],
    };

    const result = await generativeVisionModel.generateContent(request);
    const responseText = result.response.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Parse the JSON response
    try {
      const match = responseText.match(/\{[\s\S]*\}/);
      if (match) {
        const detectionResult = JSON.parse(match[0]);
        
        // Validate the response structure
        if (detectionResult.objects && Array.isArray(detectionResult.objects)) {
          return c.json({
            success: true,
            type: type,
            analysis: detectionResult
          });
        }
      }
      throw new Error("Invalid response structure from AI model");
    } catch (parseError) {
      console.error("AI Response parsing error:", parseError);
      console.error("Raw AI response:", responseText);
      return c.json({ 
        error: "Failed to parse AI response", 
        rawResponse: responseText 
      }, 500);
    }

  } catch (error) {
    console.error("Object detection error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export default aiRouter;
