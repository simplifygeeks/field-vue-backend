// Helper for Google Vertex AI wall dimension estimation
// For now, this is mocked. Replace with real API call when available.

import { VertexAI } from "@google-cloud/vertexai";


const project = process.env.GOOGLE_PROJECT_ID!;
const location = process.env.GOOGLE_LOCATION || "us-central1";
const model = "gemini-2.0-flash"; // Use Gemini Vision model

const vertexAI = new VertexAI({
  project,
  location,
});

const generativeVisionModel = vertexAI.getGenerativeModel({ model });

/**
 * Accepts a File or Blob (from Next.js API route), reads it as base64, and sends to Vertex AI.
 * Returns the model's response as { width, height }.
 */
export async function getWallDimensions(
  image: File | Blob,
  zoom: number = 1
): Promise<{ width: number; height: number }> {
  // Convert Blob to Buffer
  const buffer = Buffer.from(await image.arrayBuffer());
  const mimeType = (image as File).type || "image/jpeg";
  const base64Image = buffer.toString("base64");

  // Enhanced prompt for the model considering zoom and scanning distance
  const filePart = { inlineData: { data: base64Image, mimeType } };
  const textPart = {
    text: `Analyze this wall image carefully. Consider the following factors:

1. ZOOM LEVEL: This image was taken with a zoom level of ${zoom}x
   - If zoom > 1: The image shows a closer, more detailed view - objects appear larger
   - If zoom < 1: The image shows a wider, more distant view - objects appear smaller
   - If zoom = 1: Standard view with normal perspective

2. SCANNING AND DISTANCE ANALYSIS:
   - Examine the image to determine how far the camera was from the wall
   - Look for visual cues like shadows, perspective, and object relationships
   - Consider the apparent size of objects in the image relative to the zoom level
   - Analyze the depth and distance perception in the scene

3. ACCURATE DIMENSION ESTIMATION:
   - Use the zoom level to adjust your size estimates appropriately
   - Account for the camera distance and perspective distortion
   - Provide dimensions that reflect the actual wall size, not the apparent size in the image

Estimate the width and height of the wall in feet, considering the zoom level and scanning distance. Respond ONLY as JSON: {"width": <number>, "height": <number>}`,
  };

  const request = {
    contents: [{ role: "user", parts: [textPart, filePart] }],
  };

  const result = await generativeVisionModel.generateContent(request);
  const responseText =
    result.response.candidates?.[0]?.content?.parts?.[0]?.text || "";

  // Try to parse the JSON from the model's response
  try {
    const match = responseText.match(/\{.*\}/);
    if (match) {
      const dims = JSON.parse(match[0]);
      if (typeof dims.width === "number" && typeof dims.height === "number") {
        return dims;
      }
    }
    throw new Error("Could not parse dimensions from model response");
  } catch (e) {
    console.error(e);
    throw new Error(
      "Vertex AI did not return valid dimensions: " + responseText
    );
  }
}
