import { Hono } from "hono";
import { getWallDimensions } from "../lib/ai.js";
import { GoogleAuth } from "google-auth-library";

const vertexAiRouter = new Hono();

const RATE = parseFloat(process.env.COST_RATE || "5"); // $5 per m^2 by default

function calculateCost(width: number, height: number): number {
  const area = width * height;
  return area * RATE;
}

// Vertex AI configuration (replace with your values if needed)
const projectId = "234063840204";
const location = "us-central1";
const endpointId = "3832461028310908928"; // AutoML Image Object Detection endpoint

// Google Auth (ADC or service account key via GOOGLE_APPLICATION_CREDENTIALS)


// Direct REST endpoint URL (regional)
const apiHost = "https://us-central1-aiplatform.googleapis.com";
const predictUrl = `${apiHost}/v1/projects/${projectId}/locations/${location}/endpoints/${endpointId}:predict`;

vertexAiRouter.post("/analyze-image", async (c) => {
  const formData = await c.req.formData();
  const image = formData.get("image");
  const zoom = formData.get("zoom");

  if (!image || typeof image === "string") {
    return c.json({ error: "No image uploaded" }, { status: 400 });
  }

  // Parse zoom value, default to 1 if not provided
  const zoomValue = zoom ? parseFloat(zoom as string) : 1;
  if (isNaN(zoomValue) || zoomValue <= 0) {
    return c.json({ error: "Invalid zoom value" }, { status: 400 });
  }

  try {
    const { width, height } = await getWallDimensions(
      image as File | Blob,
      zoomValue
    );
    const cost = calculateCost(width, height);
    return c.json({ width, height, cost, zoom: zoomValue });
  } catch (err: unknown) {
    console.log("err", err);
    if (err instanceof Error) {
      return c.json({ error: err.message }, { status: 500 });
    } else {
      console.error(err);
      return c.json({ error: "Failed to analyze image" }, { status: 500 });
    }
  }
});

vertexAiRouter.post("/object-detection", async (c) => {
  try {
    const formData = await c.req.formData();
    const image = formData.get("image");

    if (!image || typeof image === "string") {
      return c.json({ error: "No image uploaded" }, { status: 400 });
    }

    // Convert Blob to base64 content
    const buffer = Buffer.from(await (image as Blob).arrayBuffer());
    const base64Image = buffer.toString("base64");

    // Build minimal payload (content only) matching curl usage
    const body = {
      instances: [{ content: base64Image }],
      parameters: {
        confidenceThreshold: 0.2,
        maxPredictions: 100,
      },
    };

        const auth = new GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      });

    // Get OAuth token via ADC
    const client = await auth.getClient();
    const { token } = await client.getAccessToken();
    if (!token) throw new Error("Failed to obtain access token");

    // Call REST endpoint directly
    const resp = await fetch(predictUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(text || `HTTP ${resp.status}`);
    }

    const json = await resp.json();
    return c.json({ success: true, predictions: json.predictions || [] });
  } catch (error) {
    console.error("Error calling Vertex AI endpoint:", error);
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
});


export default vertexAiRouter;