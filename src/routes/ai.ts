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
1. SCAN FOR FOUNDATION: Look at the bottom of walls near ground level. Is there brick, concrete, CMU, or stone at the base? If YES, mark foundation for identification.
2. SCAN FOR SIDING: Look at wall surfaces above the foundation. Is there wall cladding (boards, panels, shingles, painted surfaces)? If YES, mark siding for identification.
3. VERIFY CONSISTENCY: If foundation was marked, ensure siding is also marked above it. If windows/doors are present, ensure siding is marked on that wall plane.
4. SCAN FOR OTHER OBJECTS: Look for windows (frame + glass), doors (panel + frame), railings (posts + balusters).
5. CREATE BOUNDING BOXES: For each marked object, draw bounding box and estimate dimensions.
6. FINAL CHECK: Is siding count > 0 when walls are visible? Is foundation count > 0 when base is visible? If NO to either, re-examine.

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

CRITICAL EXCEPTION - SIDING AND FOUNDATION ARE MANDATORY:
- Siding and foundation are the PRIMARY objects we need from exterior images.
- Missing siding or foundation is a CRITICAL FAILURE.
- If you see a house exterior wall, you MUST detect siding - NO EXCEPTIONS. Even brick walls should be detected as siding.
- Default assumption: ALL exterior walls have siding unless definitively proven otherwise.
- BRICK WALLS ARE SIDING: Even full-height brick walls should be output as "siding", not as "foundation" or excluded.
- Simple clear walls MUST always be detected as siding.

DEFINITIONS, VISUAL CUES, AND STRICT RULES:

1) SIDING (type: "siding")
- ABSOLUTE MANDATORY PRIORITY: Siding detection is THE MOST CRITICAL task. Missing siding is a CRITICAL FAILURE.
- ZERO TOLERANCE FOR MISSING SIDING: If there is ANY wall surface visible above the foundation, you MUST output siding. NO EXCEPTIONS.
- SIMPLE RULE: Wall surface above foundation = SIDING. Always. Foundation is at the bottom (typically bottom 8-36 inches); everything above it is siding.
- CONFIDENCE RULE FOR SIDING: When uncertain, ALWAYS use "low" confidence and output siding rather than skipping it. Missing siding is worse than low-confidence siding.

- Also known as: clapboard, lap siding, vinyl siding, wood siding, fiber-cement (Hardie), board-and-batten, shingle siding, metal panels, wall cladding, exterior wall covering, house siding, exterior panels, brick walls, masonry walls.

- CRITICAL: BRICK WALLS ARE SIDING - If you see brick walls (full-height brick or brick above foundation), output them as type "siding", NOT as "foundation". Only brick at the very bottom foundation band should be "foundation". Brick walls themselves are siding.

- Visual cues (if you see ANY of these, output siding IMMEDIATELY):
  * Repeating horizontal boards with small overlaps (lap/clapboard) - classic siding
  * Vertical wide boards with narrow battens covering seams (board-and-batten) - common siding
  * Uniform shingles or panel seams - definitely siding
  * Consistent texture or pattern across a wall plane - likely siding
  * Corner trim/transition at wall edges - indicates siding
  * J-channels or casings around windows/doors - typical siding installation
  * Horizontal or vertical lines indicating board/panel edges - siding boards
  * ANY visible wall surface material above the foundation - default to siding
  * Painted or colored wall surfaces - almost always siding underneath
  * Smooth painted surfaces - could be siding or other cladding, output as siding
  * Textured surfaces on walls - likely siding
  * Wall surfaces between windows - this is siding
  * Wall surfaces around doors - this is siding
  * Brick walls (full-height brick or brick above foundation) - OUTPUT AS SIDING
  * ANY wall material above ground level - treat as siding unless it's clearly ONLY a foundation band

- MANDATORY DETECTION RULES (follow these strictly, NO EXCEPTIONS):
  * If foundation is detected: ALWAYS detect siding above it - output siding with "low" confidence minimum
  * If windows/doors are detected: ALWAYS detect siding on that wall plane around them - no exceptions
  * If you see ANY wall surface above ground level: ALWAYS detect siding - NO EXCEPTIONS
  * If you see brick walls (full-height or above foundation): Output as "siding", NOT as "foundation"
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
  * You can see brick walls (full-height or above foundation) - OUTPUT AS SIDING
  * Simple clear walls are visible - OUTPUT SIDING (even if details are unclear)
  * The wall exists above the foundation - OUTPUT SIDING (default assumption)

- Include (be EXTREMELY GENEROUS - when in doubt, include):
  * ALL exterior wall cladding surfaces ABOVE the foundation (this is the default)
  * Siding behind railings, columns, partial occlusions (output even if partially hidden)
  * Siding that coexists with brick/stone accents (output siding portions)
  * Brick walls (full-height brick or brick above foundation) - OUTPUT AS SIDING
  * Painted surfaces (almost always siding underneath)
  * Smooth wall surfaces (likely siding, output with medium/low confidence)
  * Simple clear walls - ALWAYS output as siding (even if you can't see details)
  * Any wall material you cannot definitively identify as non-siding (default to siding)
  * Walls in shadow or poor lighting (output siding with low confidence)
  * Walls partially obscured by landscaping (output visible siding portions)

- Exclude ONLY these (must be 100% ABSOLUTELY CERTAIN - if ANY doubt, output siding):
  * Foundation band itself (bottom portion only - below the transition line, typically bottom 8-36 inches)
  * Full-height stucco wall from foundation to roof with zero siding visible (entire wall is smooth stucco)
  * NOTE: Even full-height brick walls should be output as SIDING, not excluded
  * IF YOU ARE NOT 100% CERTAIN IT'S ONE OF THESE, OUTPUT SIDING

- Confidence levels for siding (use these generously):
  * "high": Siding is clearly visible with obvious boards/panels/texture
  * "medium": Wall surface is visible but details are unclear - STILL OUTPUT SIDING
  * "low": Uncertain about wall material but it's not clearly brick/stucco - STILL OUTPUT SIDING
  * When in doubt: Use "low" confidence and OUTPUT SIDING - missing siding is not acceptable

- Bounding box: Cover the siding surface on that wall plane above foundation; start at foundation transition line (or ground level if no foundation visible), extend to below roof/soffit. Include the wall area even if windows/doors are present.

- Counting: Count each distinct wall plane as one siding object. If you see front and side walls, count both separately. If multiple wall planes are visible, output siding for EACH plane.

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
- CRITICAL: If you detect foundation, you MUST ALSO detect siding above it. They always appear together.
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
- If foundation is detected, siding MUST ALSO be detected above it. Never return foundation without siding.
- If windows or doors are detected, siding MUST be detected on that wall plane.

PRE-RESPONSE VALIDATION CHECKLIST (answer these BEFORE outputting JSON):
1. Did I detect any foundation objects? → If YES, did I also detect siding above each foundation? If NO siding detected, ADD SIDING NOW (use "low" confidence if uncertain).
2. Did I detect any windows or doors? → If YES, did I detect siding on that wall plane? If NO siding detected, ADD SIDING NOW (use "low" confidence if uncertain).
3. Do I see any wall surfaces above ground level? → If YES, did I detect siding? If NO siding detected, ADD SIDING NOW (use "low" confidence if uncertain).
4. Do I see brick walls? → If YES, did I output them as "siding"? If they were output as "foundation" or missing, FIX THIS NOW - brick walls are siding.
5. Do I see simple clear walls? → If YES, did I detect siding? If NO siding detected, ADD SIDING NOW (use "low" confidence if uncertain).
6. Is my siding count zero? → If YES, re-examine the image for wall surfaces and ADD SIDING. Use "low" confidence if uncertain, but ADD SIDING.
7. For each visible wall plane (front, side, etc.), do I have a siding object? → If NO for any plane, ADD SIDING NOW with at least "low" confidence.
8. Am I uncertain about the wall material? → Output siding with "low" confidence anyway - missing siding is not acceptable.

CRITICAL: Before outputting your JSON response, verify that siding objects exist for all wall surfaces above foundation level. If siding count is zero and walls are visible, you have made an error - add siding objects with "low" confidence at minimum. Better to have low-confidence siding than no siding at all. Remember: brick walls are siding, and simple clear walls must always be detected as siding.

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

STEP 1 - FOUNDATION SCAN (always do this first):
- Look at the bottom 35% of the image near ground level
- Identify any brick, CMU blocks, concrete, or stone material at the base
- If found, prepare to output a "foundation" object
- Note the top edge of foundation (where it transitions to siding)

STEP 2 - SIDING SCAN (always do this second):
- Look at wall surfaces ABOVE where foundation ends (or above ground if no foundation)
- Look for ANY wall cladding: boards, panels, shingles, painted surfaces, textured surfaces, smooth surfaces, brick walls
- If ANY wall surface is visible above foundation level, prepare to output a "siding" object
- CRITICAL: Brick walls ARE siding - if you see brick walls (full-height or above foundation), output as "siding"
- Simple clear walls ALWAYS count as siding - even if you can't see material details
- Default assumption: it IS siding unless it's ONLY a foundation band
- If uncertain about the wall material: STILL output siding with "low" confidence
- If the wall is painted or smooth: Output siding with "medium" confidence
- NEVER skip siding - use low confidence if needed, but ALWAYS output siding when walls are visible

STEP 3 - CONSISTENCY CHECK:
- Foundation detected? → MUST also detect siding above it
- Windows/doors detected? → MUST also detect siding on that wall
- Wall visible but siding count = 0? → ERROR: Add siding now

STEP 4 - OTHER OBJECTS:
- Scan for windows (frame + glass visible)
- Scan for doors (panel + frame visible)
- Scan for railings (posts + balusters visible)

STEP 5 - BOUNDING BOXES:
- Draw boxes for each identified object
- Estimate dimensions if edges are clear

FINAL REMINDER BEFORE RESPONDING:
- SIDING is the MOST IMPORTANT object type for exterior images
- If you see a house/building exterior with walls, you MUST detect siding - NO EXCEPTIONS
- BRICK WALLS ARE SIDING - even full-height brick walls should be output as "siding", not excluded
- Simple clear walls MUST be detected as siding - even if material details are unclear
- If you detected foundation, you MUST detect siding above it
- If you detected windows/doors, you MUST detect siding on that wall
- DO NOT return a response with zero siding objects when walls are visible
- Missing siding is a CRITICAL ERROR - always include siding when wall surfaces are present
- USE LOW CONFIDENCE WHEN UNCERTAIN: Better to output siding with "low" confidence than to skip it entirely
- When uncertain about wall material: Default to siding with "low" or "medium" confidence
- Painted walls, smooth walls, textured walls, brick walls, clear walls = OUTPUT SIDING (use appropriate confidence level)
- Follow the 5-step methodology above for CONSISTENT results every time

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
