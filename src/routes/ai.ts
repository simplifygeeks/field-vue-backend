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
IDENTIFY ONLY these five object types when they are clearly visible. Map any synonyms to the exact type name in parentheses:

ALLOWED OBJECT TYPES (exact type names for output):
- Siding (type: "siding")
- Window (type: "window")
- Door (type: "door")
- Foundation (type: "foundation")
- Railing (type: "railing")

CRITICAL ACCURACY REQUIREMENTS:
- ONLY identify objects that are DEFINITIVELY present and clearly visible.
- DO NOT guess or infer hidden parts; prefer omission over false positives.
- COUNT ONLY WHAT YOU CAN ACTUALLY SEE.

DEFINITIONS, VISUAL CUES, AND STRICT RULES:

1) SIDING (type: "siding")
- Also known as: clapboard, lap siding, vinyl siding, wood siding, fiber-cement (Hardie), board-and-batten, shingle siding, metal panels.
- Visual cues: Repeating horizontal boards with small overlaps (lap/clapboard), vertical wide boards with narrow battens covering seams (board-and-batten), uniform shingles, or panel seams; consistent texture across a wall plane; corner trim/transition at wall edges; J-channels or casings around windows/doors.
- Include: Only exterior wall cladding surfaces ABOVE the foundation.
- Exclude: Brick/stone veneer, stucco, bare sheathing, foundation concrete/CMU, soffits, fascia, trim/corner boards, gutters/downspouts, porch ceilings.
- Bounding box: Cover only the siding surface on that wall plane; do NOT include windows, doors, trim, soffits, fascia, gutters, or roof surfaces.
- Counting: Count each distinct wall plane or clearly separated siding section as one siding object.

2) WINDOW (type: "window")
- Must see frame AND glass; clearly recognizable opening.
- Exclude reflections counted as extra windows, decorative glass, mirrors, or wall art.
- Count each individual window unit separately.

3) DOOR (type: "door")
- Must see door panel AND frame; clearly recognizable door opening.
- Exclude open doorways without a door, storm/screen doors alone, or shadows.
- Count each individual door separately.

4) FOUNDATION (type: "foundation")
- MANDATORY DETECTION: You MUST always check for and identify foundation elements. This is a CRITICAL component that should NEVER be missed.
- Also known as: foundation brick, water table brick, masonry skirt, brick base, CMU/concrete foundation, stem wall, foundation wall, brick foundation, block foundation, concrete base, masonry foundation, foundation band, foundation veneer.
- Definition: The continuous horizontal structural band at the VERY BOTTOM of exterior walls (at or near ground level/grade) that serves as the base support for the structure above. This is typically made of brick, CMU (concrete masonry units/cinder blocks), poured concrete, or stone masonry. It sits directly below the main wall cladding (siding) and is the transition point between the ground and the elevated structure.
- CRITICAL CLASSIFICATION DIRECTIVE: If ANY foundation material is visible at the base of the wall—even a single row of brick, a narrow CMU band, or a concrete strip—you MUST output an object of type "foundation" for it. NEVER skip foundations. NEVER label foundation elements as "wall" or "siding". Foundation detection takes PRIORITY over other identifications.
- Visual cues to ALWAYS look for (check ALL of these):
  * Horizontal courses of red/orange/brown brick with white/gray mortar joints (running bond, stack bond, or other brick patterns)
  * Gray CMU blocks (concrete blocks) with rectangular pattern and visible mortar lines—typically 8"×16" blocks
  * Solid poured concrete band (may be smooth, textured, or painted)
  * Stone masonry with irregular or cut stone pattern
  * Change in material at the base where siding/cladding begins above
  * A horizontal ledge, cap, or water table where the foundation meets the wall above
  * Weep holes (small rectangular holes) near the top of brick foundations for moisture drainage
  * Different texture/color at the bottom of the wall compared to siding above
  * Vertical expansion joints or control joints in concrete/CMU
  * Mortar joints that create a grid pattern (brick or block)
  * Adjacent to soil, grass, mulch, gravel, driveway, or walkway at the bottom edge
  * May have a slight outward projection from the wall above
  * Often darker or weathered due to ground proximity
  * May have efflorescence (white mineral deposits) from moisture
  * Foundation typically starts at ground level and extends 8-36 inches upward
  * Look for the transition line where one material (foundation) meets another (siding)
- Typical characteristics:
  * Vertical extent: About 8–36 inches (roughly 1–6 brick courses, 1–3 CMU courses, or equivalent concrete/stone band)
  * Occupies ONLY the lower portion of the wall (bottom 10-35% of visible wall height)
  * Continuous horizontal band that follows the perimeter of the building
  * May step up or down to follow grade/slope of the ground
  * Usually same material all around the building perimeter
  * Typically 8-12 inches thick (depth from exterior face)
- WHAT TO INCLUDE (be generous with identification):
  * ANY visible foundation/masonry band directly attached to and supporting the house wall at the bottom
  * Even a single visible row of brick or block at the base—still counts as foundation
  * Partial foundation views where only a section is visible—still identify it
  * Foundations that are partially obscured by landscaping—identify the visible portion
  * Painted or stained foundation materials—still foundation
  * Foundations with attached lattice or skirting on porches—identify the foundation behind it
- WHAT TO EXCLUDE:
  * Full-height brick veneer walls (if brick extends to roofline, it's the main wall, not foundation)
  * Brick chimneys (freestanding vertical structures)
  * Porch steps, stoop steps, or entry stairs (separate from foundation wall)
  * Walkways, patios, or driveways (horizontal surfaces on the ground)
  * Planters, flower boxes, or garden beds
  * Freestanding or retaining walls not attached to the house wall
  * Stone columns or pillars (vertical supports)
  * Pavers or decorative stonework not part of the structural foundation
- Bounding box rules (be precise):
  * BOTTOM of box: Align with the visible ground/grade line, soil line, or lowest visible foundation edge
  * TOP of box: Align with the transition point where foundation material ends and siding/cladding begins (look for the ledge, water table, or material change)
  * LEFT/RIGHT of box: Extend to the corners/edges of the continuous foundation band on that wall plane
  * Do NOT extend above the foundation-to-siding transition line
  * Do NOT include adjacent steps, stoops, porches, or separate masonry structures
  * Do NOT include siding, trim, or other materials above the foundation
  * Height guideline: Generally less than ~35% of total wall height in the image (unless clearly a raised foundation or walkout basement)
  * Position guideline: Foundation box should typically occupy the lower half of the image (y > ~45-50%)
- Counting rules:
  * Count each continuous foundation segment visible along a wall plane as ONE foundation object
  * If foundation wraps around a corner and both sides are visible, count as TWO separate foundation objects (one per wall plane)
  * If there are clear breaks or separations (e.g., garage foundation vs. house foundation), count separately
- DETECTION CHECKLIST (ask yourself these questions):
  1. Is there ANY material at the very bottom of the wall that looks different from the siding above?
  2. Can I see brick, block, concrete, or stone at the base near the ground?
  3. Is there a horizontal line or ledge where one material transitions to another?
  4. Is there a change in color, texture, or pattern at the base of the wall?
  5. Do I see mortar joints, brick patterns, or block patterns at the bottom?
  6. If YES to any of the above: Output type "foundation" immediately.

5) RAILING (type: "railing")
- Also known as: handrail, guardrail, balustrade, deck railing, porch railing, stair railing.
- Definition: A protective barrier system typically consisting of vertical posts (balusters/spindles), horizontal rails (top rail and bottom rail), and a handrail, installed along stairs, porches, decks, balconies, or elevated platforms.
- Visual cues: Repeating vertical balusters or spindles with consistent spacing; horizontal top rail and/or bottom rail; handrail for gripping; posts at intervals; often made of wood, metal (wrought iron, aluminum), vinyl, or composite materials; typically 36-42 inches in height.
- Include: Only exterior railings attached to porches, decks, stairs, balconies, or elevated platforms that are clearly visible.
- Exclude: Interior railings, fences not attached to the structure, decorative metalwork that is not a railing, window grilles, shutters, arbors, trellises.
- Bounding box: Cover the entire visible railing section including posts, balusters, and rails; do NOT include the deck/porch floor or stairs themselves unless they are part of the railing structure.
- Counting: Count each distinct railing section separately (e.g., porch railing and stair railing are separate objects).

WHAT NOT TO IDENTIFY (COMMON FALSE POSITIVES):
- Roofs, gutters, downspouts, fascia, soffits, corner trim, vents, lights, cameras, shutters, house numbers, mailboxes, landscaping, vehicles, reflections, shadows, lines.
- Decorative brick/stone that is NOT the foundation band; steps/walkways/patios; chimneys; freestanding/retaining walls not attached to the house.
- BUT REMEMBER: Any brick, block, or concrete AT THE BASE of the wall IS foundation and MUST be identified.

BOUNDING BOX SANITY RULES:
- Siding: Must not overlap roof, soffit, fascia, or extend over windows/doors/trim.
- Foundation: Must be at the base of the wall and below the siding transition; avoid including steps, stoops, or separate masonry. Prefer the lower half of the image for the foundation box (y > ~45%) and keep height small relative to full image (typically 5–35%), unless clearly a raised foundation. ALWAYS check for foundation presence at the base of walls.

CLASSIFICATION SANITY RULES:
- Do NOT output type "wall" for any exterior cladding; use type "siding" for wall cladding above the foundation band.
- When siding is present above a foundation band, output TWO separate objects: one "foundation" for the band and one "siding" for the cladding above. Do not merge them into a single object.
- MANDATORY: Always scan the base of walls for foundation material. If present, it MUST be identified as type "foundation".

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
      "type": "siding/window/door/foundation/railing",
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
