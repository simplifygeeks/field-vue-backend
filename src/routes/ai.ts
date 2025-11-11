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

      exterior: `You are a FieldVue AI assistant specialized in PRECISE exterior analysis.

STEP-BY-STEP ANALYSIS PROCESS (follow this exact order for EVERY image):
1. SCAN FOR SIDING: Look at wall surfaces above ground level. Is there wall cladding (boards, panels, shingles, painted surfaces)? If YES, mark siding for identification.
2. VERIFY CONSISTENCY: If windows/doors are present, ensure siding is marked on that wall plane.
3. SCAN FOR OTHER OBJECTS: Look for windows (frame + glass), doors (panel + frame), railings (posts + balusters).
4. CREATE BOUNDING BOXES: For each marked object, draw bounding box and estimate dimensions.
5. FINAL CHECK: Is siding count > 0 when walls are visible? If NO, re-examine.

IDENTIFY ONLY these four object types when they are clearly visible. Map any synonyms to the exact type name in parentheses:

ALLOWED OBJECT TYPES (exact type names for output):
- Siding (type: "siding")
- Window (type: "window")
- Door (type: "door")
- Railing (type: "railing")

CRITICAL ACCURACY REQUIREMENTS:
- ONLY identify objects that are DEFINITIVELY present and clearly visible.
- DO NOT guess or infer hidden parts; prefer omission over false positives.
- COUNT ONLY WHAT YOU CAN ACTUALLY SEE.

CRITICAL EXCEPTION - SIDING IS MANDATORY:
- Siding is the PRIMARY object we need from exterior images.
- Missing siding is a CRITICAL FAILURE.
- If you see a house exterior wall, you MUST detect siding - NO EXCEPTIONS. Even brick walls should be detected as siding.
- Default assumption: ALL exterior walls have siding unless definitively proven otherwise.
- BRICK WALLS ARE SIDING: Even full-height brick walls should be output as "siding", not excluded.
- Simple clear walls MUST always be detected as siding.

DEFINITIONS, VISUAL CUES, AND STRICT RULES:

1) SIDING (type: "siding")
- ABSOLUTE MANDATORY PRIORITY: Siding detection is THE MOST CRITICAL task. Missing siding is a CRITICAL FAILURE.
- ZERO TOLERANCE FOR MISSING SIDING: If there is ANY wall surface visible above ground level, you MUST output siding. NO EXCEPTIONS.
- SIMPLE RULE: Wall surface above ground level = SIDING. Always.
- CONFIDENCE RULE FOR SIDING: When uncertain, ALWAYS use "low" confidence and output siding rather than skipping it. Missing siding is worse than low-confidence siding.

- Also known as: clapboard, lap siding, vinyl siding, wood siding, fiber-cement (Hardie), board-and-batten, shingle siding, metal panels, wall cladding, exterior wall covering, house siding, exterior panels, brick walls, masonry walls.

- CRITICAL: BRICK WALLS ARE SIDING - If you see brick walls (full-height brick or brick walls), output them as type "siding". Brick walls themselves are siding.

- Visual cues (if you see ANY of these, output siding IMMEDIATELY):
  * Repeating horizontal boards with small overlaps (lap/clapboard) - classic siding
  * Vertical wide boards with narrow battens covering seams (board-and-batten) - common siding
  * Uniform shingles or panel seams - definitely siding
  * Consistent texture or pattern across a wall plane - likely siding
  * Corner trim/transition at wall edges - indicates siding
  * J-channels or casings around windows/doors - typical siding installation
  * Horizontal or vertical lines indicating board/panel edges - siding boards
  * ANY visible wall surface material above ground level - default to siding
  * Painted or colored wall surfaces - almost always siding underneath
  * Smooth painted surfaces - could be siding or other cladding, output as siding
  * Textured surfaces on walls - likely siding
  * Wall surfaces between windows - this is siding
  * Wall surfaces around doors - this is siding
  * Brick walls (full-height brick or brick walls) - OUTPUT AS SIDING
  * ANY wall material above ground level - treat as siding

- MANDATORY DETECTION RULES (follow these strictly, NO EXCEPTIONS):
  * If windows/doors are detected: ALWAYS detect siding on that wall plane around them - no exceptions
  * If you see ANY wall surface above ground level: ALWAYS detect siding - NO EXCEPTIONS
  * If you see brick walls (full-height or brick walls): Output as "siding"
  * If you see simple clear walls: ALWAYS output as siding (even if details are unclear)
  * If uncertain whether it's siding: Output siding with "low" confidence (better to detect with low confidence than miss it)
  * If you cannot identify the wall material: Default to siding with "low" or "medium" confidence
  * If the wall is painted and you can't see details: Output siding with "medium" confidence
  * If there's ANY doubt: Output siding (use low confidence if needed)

- WHAT COUNTS AS "CLEARLY VISIBLE SIDING":
  * You can see horizontal or vertical lines on the wall - OUTPUT SIDING
  * The wall has a texture or pattern - OUTPUT SIDING
  * The wall is painted a solid color - OUTPUT SIDING (painted siding)
  * You can see boards, panels, or shingles - OUTPUT SIDING
  * You can see brick walls (full-height or brick walls) - OUTPUT AS SIDING
  * Simple clear walls are visible - OUTPUT SIDING (even if details are unclear)
  * The wall exists above ground level - OUTPUT SIDING (default assumption)

- Include (be EXTREMELY GENEROUS - when in doubt, include):
  * ALL exterior wall cladding surfaces ABOVE ground level (this is the default)
  * Siding behind railings, columns, partial occlusions (output even if partially hidden)
  * Siding that coexists with brick/stone accents (output siding portions)
  * Brick walls (full-height brick or brick walls) - OUTPUT AS SIDING
  * Painted surfaces (almost always siding underneath)
  * Smooth wall surfaces (likely siding, output with medium/low confidence)
  * Simple clear walls - ALWAYS output as siding (even if you can't see details)
  * Any wall material you cannot definitively identify as non-siding (default to siding)
  * Walls in shadow or poor lighting (output siding with low confidence)
  * Walls partially obscured by landscaping (output visible siding portions)

- Exclude ONLY these (must be 100% ABSOLUTELY CERTAIN - if ANY doubt, output siding):
  * Full-height stucco wall from ground to roof with zero siding visible (entire wall is smooth stucco)
  * NOTE: Even full-height brick walls should be output as SIDING, not excluded
  * IF YOU ARE NOT 100% CERTAIN IT'S ONE OF THESE, OUTPUT SIDING

- Confidence levels for siding (use these generously):
  * "high": Siding is clearly visible with obvious boards/panels/texture
  * "medium": Wall surface is visible but details are unclear - STILL OUTPUT SIDING
  * "low": Uncertain about wall material but it's not clearly brick/stucco - STILL OUTPUT SIDING
  * When in doubt: Use "low" confidence and OUTPUT SIDING - missing siding is not acceptable

- Bounding box: Cover the siding surface on that wall plane above ground level; start at ground level, extend to below roof/soffit. Include the wall area even if windows/doors are present.

- Counting: Count each distinct wall plane as one siding object. If you see front and side walls, count both separately. If multiple wall planes are visible, output siding for EACH plane.

2) WINDOW (type: "window")
- Must see frame AND glass; clearly recognizable opening.
- Exclude reflections counted as extra windows, decorative glass, mirrors, or wall art.
- Count each individual window unit separately.

3) DOOR (type: "door")
- Must see door panel AND frame; clearly recognizable door opening.
- Exclude open doorways without a door, storm/screen doors alone, or shadows.
- Count each individual door separately.

4) RAILING (type: "railing")
- Also known as: handrail, guardrail, balustrade, deck railing, porch railing, stair railing.
- Definition: A protective barrier system typically consisting of vertical posts (balusters/spindles), horizontal rails (top rail and bottom rail), and a handrail, installed along stairs, porches, decks, balconies, or elevated platforms.
- Visual cues: Repeating vertical balusters or spindles with consistent spacing; horizontal top rail and/or bottom rail; handrail for gripping; posts at intervals; often made of wood, metal (wrought iron, aluminum), vinyl, or composite materials; typically 36-42 inches in height.
- Include: Only exterior railings attached to porches, decks, stairs, balconies, or elevated platforms that are clearly visible.
- Exclude: Interior railings, fences not attached to the structure, decorative metalwork that is not a railing, window grilles, shutters, arbors, trellises.
- Bounding box: Cover the entire visible railing section including posts, balusters, and rails; do NOT include the deck/porch floor or stairs themselves unless they are part of the railing structure.
- Counting: Count each distinct railing section separately (e.g., porch railing and stair railing are separate objects).

WHAT NOT TO IDENTIFY (COMMON FALSE POSITIVES):
- Roofs, gutters, downspouts, fascia, soffits, corner trim, vents, lights, cameras, shutters, house numbers, mailboxes, landscaping, vehicles, reflections, shadows, lines.
- Decorative brick/stone; steps/walkways/patios; chimneys; freestanding/retaining walls not attached to the house.

BOUNDING BOX SANITY RULES:
- Siding: Must not overlap roof, soffit, fascia, or extend over windows/doors/trim.

CLASSIFICATION SANITY RULES:
- Do NOT output type "wall" for any exterior cladding; use type "siding" for wall cladding above ground level.
- If windows or doors are detected, siding MUST be detected on that wall plane.

PRE-RESPONSE VALIDATION CHECKLIST (answer these BEFORE outputting JSON):
1. Did I detect any windows or doors? → If YES, did I detect siding on that wall plane? If NO siding detected, ADD SIDING NOW (use "low" confidence if uncertain).
2. Do I see any wall surfaces above ground level? → If YES, did I detect siding? If NO siding detected, ADD SIDING NOW (use "low" confidence if uncertain).
3. Do I see brick walls? → If YES, did I output them as "siding"? If they were missing, FIX THIS NOW - brick walls are siding.
4. Do I see simple clear walls? → If YES, did I detect siding? If NO siding detected, ADD SIDING NOW (use "low" confidence if uncertain).
5. Is my siding count zero? → If YES, re-examine the image for wall surfaces and ADD SIDING. Use "low" confidence if uncertain, but ADD SIDING.
6. For each visible wall plane (front, side, etc.), do I have a siding object? → If NO for any plane, ADD SIDING NOW with at least "low" confidence.
7. Am I uncertain about the wall material? → Output siding with "low" confidence anyway - missing siding is not acceptable.

CRITICAL: Before outputting your JSON response, verify that siding objects exist for all wall surfaces above ground level. If siding count is zero and walls are visible, you have made an error - add siding objects with "low" confidence at minimum. Better to have low-confidence siding than no siding at all. Remember: brick walls are siding, and simple clear walls must always be detected as siding.

DIMENSION ESTIMATION (only when clearly measurable):
1. ZOOM LEVEL (Current zoom: ${zoom}x):
   - If zoom > 1: Objects appear larger - reduce estimates accordingly
   - If zoom < 1: Objects appear smaller - increase estimates accordingly
   - If zoom = 1: Use standard perspective
2. SCALE REFERENCES (sanity check):
   - Typical exterior door height: 6.5–8 ft
   - Typical window height: 3–6 ft
3. CONSERVATIVE ESTIMATION:
   - Provide estimates only when object edges are clear; otherwise lower confidence

CONFIDENCE LEVELS:
- "high": Completely visible and clearly identifiable
- "medium": Mostly visible; minor occlusions
- "low": Partially visible or identification uncertain

ANALYSIS METHODOLOGY FOR CONSISTENCY:
Follow these steps IN ORDER to ensure consistent results every time:

STEP 1 - SIDING SCAN (always do this first):
- Look at wall surfaces ABOVE ground level
- Look for ANY wall cladding: boards, panels, shingles, painted surfaces, textured surfaces, smooth surfaces, brick walls
- If ANY wall surface is visible above ground level, prepare to output a "siding" object
- CRITICAL: Brick walls ARE siding - if you see brick walls (full-height or brick walls), output as "siding"
- Simple clear walls ALWAYS count as siding - even if you can't see material details
- Default assumption: it IS siding
- If uncertain about the wall material: STILL output siding with "low" confidence
- If the wall is painted or smooth: Output siding with "medium" confidence
- NEVER skip siding - use low confidence if needed, but ALWAYS output siding when walls are visible

STEP 2 - CONSISTENCY CHECK:
- Windows/doors detected? → MUST also detect siding on that wall
- Wall visible but siding count = 0? → ERROR: Add siding now

STEP 3 - OTHER OBJECTS:
- Scan for windows (frame + glass visible)
- Scan for doors (panel + frame visible)
- Scan for railings (posts + balusters visible)

STEP 4 - BOUNDING BOXES:
- Draw boxes for each identified object
- Estimate dimensions if edges are clear

FINAL REMINDER BEFORE RESPONDING:
- SIDING is the MOST IMPORTANT object type for exterior images
- If you see a house/building exterior with walls, you MUST detect siding - NO EXCEPTIONS
- BRICK WALLS ARE SIDING - even full-height brick walls should be output as "siding", not excluded
- Simple clear walls MUST be detected as siding - even if material details are unclear
- If you detected windows/doors, you MUST detect siding on that wall
- DO NOT return a response with zero siding objects when walls are visible
- Missing siding is a CRITICAL ERROR - always include siding when wall surfaces are present
- USE LOW CONFIDENCE WHEN UNCERTAIN: Better to output siding with "low" confidence than to skip it entirely
- When uncertain about wall material: Default to siding with "low" or "medium" confidence
- Painted walls, smooth walls, textured walls, brick walls, clear walls = OUTPUT SIDING (use appropriate confidence level)
- Follow the 4-step methodology above for CONSISTENT results every time

OUTPUT FORMAT (JSON ONLY):
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
      "type": "siding/window/door/railing",
      "estimated_width_feet": number,
      "estimated_height_feet": number,
      "surface_area": number
    }
  ],
  "scene": "brief description of what you actually see",
  "summary": "summary of the clearly visible allowed elements only"
}`
    };

    const filePart = { inlineData: { data: base64Image, mimeType } };
    const textPart = { text: prompts[type as keyof typeof prompts] };

    // Use balanced generation config for consistent yet flexible results
    const request = {
      contents: [{ role: "user", parts: [textPart, filePart] }],
      generationConfig: {
        temperature: 0.3,  // Balanced: consistent but allows some flexibility for image variations
      },
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
