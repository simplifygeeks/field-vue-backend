import { Hono } from "hono";
import { db } from "../db/index.js";
import { jobs, users, rooms, customers, roomImages } from "../db/schema.js";
import { eq, or, inArray, ilike, and } from "drizzle-orm";
import { uploadBuffer } from "../lib/storage.js";
import { analyzeImagesForRoom } from "../lib/detections.js";

const jobsRouter = new Hono();

// Get all jobs for the authenticated user
jobsRouter.get("/", async (c: any) => {
  try {
    const user = c.get("user");
    
    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }

    let userJobs;

    // Different logic based on user role
    if (user.role === "admin") {
      // Admin can see all jobs
      userJobs = await db.query.jobs.findMany({
        orderBy: (jobs, { desc }) => [desc(jobs.createdAt)],
      });
    } else if (user.role === "contractor") {
      // Contractor sees jobs assigned to them
      userJobs = await db.query.jobs.findMany({
        where: (jobs, { eq }) => eq(jobs.contractorId, user.id),
        orderBy: (jobs, { desc }) => [desc(jobs.createdAt)],
      });
    } else if (user.role === "customer") {
      // Customer sees jobs they created
      userJobs = await db.query.jobs.findMany({
        where: (jobs, { eq }) => eq(jobs.customerId, user.id),
        orderBy: (jobs, { desc }) => [desc(jobs.createdAt)],
      });
    } else {
      return c.json({ error: "Invalid user role" }, 400);
    }

    // Get user and customer details for each job, filtering for jobs with room images
    const jobsWithUsers = await Promise.all(
      userJobs.map(async (job) => {
        const customer = job.customerId
          ? await db.query.customers.findFirst({
              where: (customers, { eq }) =>
                eq(customers.id, job.customerId as string),
            })
          : null;
        const contractor = await db.query.users.findFirst({
          where: (users, { eq }) => eq(users.id, job.contractorId),
        });

        // Get rooms for this job
        const jobRooms = await db.query.rooms.findMany({
          where: (rooms, { eq }) => eq(rooms.jobId, job.id),
          orderBy: (rooms, { asc }) => [asc(rooms.createdAt)],
        });

        const roomsResponse = jobRooms.map((r) => {
          const imageUrls = Array.isArray(r.imageUrls)
            ? (r.imageUrls as unknown as string[])
            : [];
          const measurements = (r.measurements as any) || null;
          let aggregates =
            measurements && typeof measurements === "object"
              ? measurements.aggregates || null
              : null;
          // Reshape to expose only consolidated items and roomDimensions for UI
          if (aggregates) {
            const roomDimensions = aggregates.roomDimensions || null;
            aggregates = { aggregates, roomDimensions };
          }

          return {
            id: r.id,
            name: r.name,
            roomType: r.roomType,
            imageUrls,
            measurements: aggregates,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          };
        });

        
        return {
          ...job,
          title: job.title + job.jobNumber,
          customer,
          contractor,
          rooms: roomsResponse,
        };
      })
    );

    // Filter out null values (jobs without room images)
    const filteredJobs = jobsWithUsers.filter(job => job !== null);

    return c.json({ 
      jobs: filteredJobs,
      count: filteredJobs.length,
      user: {
        id: user.id,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Get jobs error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Get all photos across all jobs for the authenticated contractor
jobsRouter.get("/photos", async (c: any) => {
  try {
    const user = c.get("user");
    if (!user) return c.json({ error: "Authentication required" }, 401);
    if (user.role !== "contractor")
      return c.json({ error: "Only contractors can fetch their photos" }, 403);

    const contractorJobs = await db.query.jobs.findMany({
      where: (jobs, { eq }) => eq(jobs.contractorId, user.id),
      orderBy: (jobs, { desc }) => [desc(jobs.createdAt)],
    });

    const jobIds = contractorJobs.map((j) => j.id);
    if (jobIds.length === 0)
      return c.json({ photos: [], totals: { jobs: 0, rooms: 0, images: 0 } });

    const contractorRooms = await db.query.rooms.findMany({
      where: (rooms, { inArray: inArr }) => inArr(rooms.jobId, jobIds),
      orderBy: (rooms, { desc }) => [desc(rooms.createdAt)],
    });

    let images = 0;
    const photos = contractorRooms.flatMap((r) => {
      const urls = Array.isArray(r.imageUrls)
        ? (r.imageUrls as unknown as string[])
        : [];
      images += urls.length;
      const job = contractorJobs.find((j) => j.id === r.jobId);
      return urls.map((url) => ({
        url,
        jobId: r.jobId,
        jobTitle: (job?.title || "") + (job?.jobNumber || ""),
        roomId: r.id,
        roomName: r.name,
        roomType: r.roomType,
        createdAt: r.createdAt,
      }));
    });

    return c.json({
      photos,
      totals: {
        jobs: contractorJobs.length,
        rooms: contractorRooms.length,
        images,
      },
    });
  } catch (error) {
    console.error("Get contractor photos error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Search jobs by field and term (contractor-only). If term is empty, return all contractor jobs.
jobsRouter.get("/search", async (c: any) => {
  try {
    const user = c.get("user");
    if (!user) return c.json({ error: "Authentication required" }, 401);
    if (user.role !== "contractor")
      return c.json({ error: "Only contractors can search their jobs" }, 403);

    const url = new URL(c.req.url);
    const field = (url.searchParams.get("field") || "title").trim();
    const term = (url.searchParams.get("term") || "").trim();

    // For customer/address searches, search in customers table first
    if (field === "customer" || field === "customerName" || field === "address" || field === "customerAddress") {
      let customerResults;
      
      if (term === "") {
        // Get all customers that  this contractor has created
        customerResults = await db.query.customers.findMany({
          where: (customers, { eq }) => eq(customers.createdBy, user.id),
        });
      } else {
        const pattern = `%${term}%`;
        const customerColumn = field === "address" || field === "customerAddress" ? customers.address : customers.name;
        
        customerResults = await db.query.customers.findMany({
          where: (customers, helpers) => helpers.and(helpers.ilike(customerColumn, pattern), helpers.eq(customers.createdBy,user.id)),
        });
      }

      // For each customer, get their jobs with this contractor
      const customersWithJobs = [];
      for (const customer of customerResults) {
        const customerJobs = await db.query.jobs.findMany({
          where: (jobs, { and, eq }) => and(
            eq(jobs.customerId, customer.id),
            eq(jobs.contractorId, user.id)
          ),
          orderBy: (jobs, { desc }) => [desc(jobs.createdAt)],
        });

        customersWithJobs.push({
          customer: customer,
          jobs: customerJobs.map(job => ({
            id: job.id,
            jobNumber: job.jobNumber,
            title: job.title + job.jobNumber,
            status: job.status,
            customerName: job.customerName,
            customerAddress: job.customerAddress,
            createdAt: job.createdAt,
          }))
        });
      }

      
      return c.json({ 
        count: customersWithJobs.length, 
        customers: customersWithJobs,
        searchType: "customer"
      });
    }

    // For job searches, search in jobs table
    const fieldToColumn: Record<string, any> = {
      title: jobs.title,
      job: jobs.title,
      jobName: jobs.title,
    };
    const column = fieldToColumn[field] || jobs.title;

    let results;
    if (term === "") {
      results = await db.query.jobs.findMany({
        where: (jobs, { eq }) => eq(jobs.contractorId, user.id),
        orderBy: (jobs, { desc }) => [desc(jobs.createdAt)],
      });
    } else {
      const pattern = `%${term}%`;
      results = await db.query.jobs.findMany({
        where: (jobs, helpers) =>
          helpers.and(
            helpers.eq(jobs.contractorId, user.id),
            helpers.ilike(column, pattern)
          ),
        orderBy: (jobs, { desc }) => [desc(jobs.createdAt)],
      });
    }

    // For job searches, return job data only
    const items = results.map((j) => ({
      id: j.id,
      jobNumber: j.jobNumber,
      title: j.title + j.jobNumber,
      status: j.status,
      customerName: j.customerName,
      customerAddress: j.customerAddress,
      createdAt: j.createdAt,
    }));

    return c.json({ 
      count: items.length, 
      jobs: items,
      searchType: "job"
    });
  } catch (error) {
    console.error("Search jobs error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Get a specific job by ID (if user has access to it)
jobsRouter.get("/:id", async (c: any) => {
  try {
    const user = c.get("user");
    const jobId = c.req.param("id");
    
    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const job = await db.query.jobs.findFirst({
      where: (jobs, { eq }) => eq(jobs.id, jobId),
    });

    if (!job) {
      return c.json({ error: "Job not found" }, 404);
    }

    // Check if user has access to this job
    const hasAccess = 
      user.role === "admin" ||
      (user.role === "contractor" && job.contractorId === user.id) ||
      (user.role === "customer" && job.customerId === user.id);

    if (!hasAccess) {
      return c.json({ error: "Access denied" }, 403);
    }

    // Get customer details
    const customer = job.customerId
      ? await db.query.customers.findFirst({
          where: (customers, { eq }) =>
            eq(customers.id, job.customerId as string),
        })
      : null;
    const contractor = await db.query.users.findFirst({
      where: (users, { eq }) => eq(users.id, job.contractorId),
    });

    return c.json({ 
      job: {
        ...job,
        customer,
        contractor,
      },
    });
  } catch (error) {
    console.error("Get job error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Create a new job (only customers can create jobs)
jobsRouter.post("/", async (c: any) => {
  try {
    const user = c.get("user");
    const { 
      title, 
      description, 
      customerName, 
      customerAddress, 
      customerPhone, 
      customerEmail,
      appointmentDate, 
      estimatedCost, 
      contractorId,
    } = await c.req.json();
    
    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }

    if (user.role !== "customer") {
      return c.json({ error: "Only customers can create jobs" }, 403);
    }

    if (
      !title ||
      !description ||
      !customerName ||
      !customerAddress ||
      !contractorId
    ) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    // Verify contractor exists
    const contractor = await db.query.users.findFirst({
      where: (users, { eq, and }) => 
        and(eq(users.id, contractorId), eq(users.role, "contractor")),
    });

    if (!contractor) {
      return c.json({ error: "Contractor not found" }, 404);
    }

    await db.insert(customers).values({
      name: customerName,email: customerEmail, address: customerAddress,createdBy: user.id
    })

    const [newJob] = await db
      .insert(jobs)
      .values({
      title,
      description,
      customerName,
      customerAddress,
      customerPhone: customerPhone || null,
      appointmentDate: appointmentDate || null,
      estimatedCost: estimatedCost ? estimatedCost.toString() : null,
      customerId: user.id,
      contractorId,
        status: "pending",
      })
      .returning();

    return c.json(
      {
        message: "Job created successfully",
        job: newJob,
      },
      201
    );
  } catch (error) {
    console.error("Create job error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Update job status
jobsRouter.patch("/:id/status", async (c: any) => {
  try {
    const user = c.get("user");
    const jobId = c.req.param("id");
    const { status } = await c.req.json();
    
    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }

    if (
      ![
        "pending",
        "estimated",
        "in_progress",
        "completed",
        "cancelled",
      ].includes(status)
    ) {
      return c.json({ error: "Invalid status" }, 400);
    }

    // Get the job
    const job = await db.query.jobs.findFirst({
      where: (jobs, { eq }) => eq(jobs.id, jobId),
    });

    if (!job) {
      return c.json({ error: "Job not found" }, 404);
    }

    // Check if user can update this job
    const canUpdate = 
      user.role === "admin" ||
      (user.role === "contractor" && job.contractorId === user.id) ||
      (user.role === "customer" && job.customerId === user.id);

    if (!canUpdate) {
      return c.json({ error: "Access denied" }, 403);
    }

    const [updatedJob] = await db
      .update(jobs)
      .set({ 
        status,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId))
      .returning();

    return c.json({ 
      message: "Job status updated successfully",
      job: updatedJob,
    });
  } catch (error) {
    console.error("Update job status error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Update job details
jobsRouter.patch("/:id", async (c: any) => {
  try {
    const user = c.get("user");
    const jobId = c.req.param("id");
    const updateData = await c.req.json();
    
    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }

    // Get the job
    const job = await db.query.jobs.findFirst({
      where: (jobs, { eq }) => eq(jobs.id, jobId),
    });

    if (!job) {
      return c.json({ error: "Job not found" }, 404);
    }

    // Check if user can update this job
    const canUpdate = 
      user.role === "admin" ||
      (user.role === "contractor" && job.contractorId === user.id) ||
      (user.role === "customer" && job.customerId === user.id);

    if (!canUpdate) {
      return c.json({ error: "Access denied" }, 403);
    }

    // Prepare update data
    const updateFields: any = {
      updatedAt: new Date(),
    };

    // Only allow updating certain fields
    if (updateData.title) updateFields.title = updateData.title;
    if (updateData.description)
      updateFields.description = updateData.description;
    if (updateData.customerName)
      updateFields.customerName = updateData.customerName;
    if (updateData.customerAddress)
      updateFields.customerAddress = updateData.customerAddress;
    if (updateData.customerPhone !== undefined)
      updateFields.customerPhone = updateData.customerPhone;
    if (updateData.appointmentDate !== undefined)
      updateFields.appointmentDate = updateData.appointmentDate;
    if (updateData.estimatedCost !== undefined)
      updateFields.estimatedCost = parseFloat(updateData.estimatedCost);
    if (updateData.status) updateFields.status = updateData.status;

    const [updatedJob] = await db
      .update(jobs)
      .set(updateFields)
      .where(eq(jobs.id, jobId))
      .returning();

    return c.json({ 
      message: "Job updated successfully",
      job: updatedJob,
    });
  } catch (error) {
    console.error("Update job error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Get individual image measurements for a room
jobsRouter.get("/:id/rooms/:roomId/images", async (c: any) => {
  try {
    const user = c.get("user");
    if (!user) return c.json({ error: "Authentication required" }, 401);

    const jobId = c.req.param("id");
    const roomId = c.req.param("roomId");

    // Verify job belongs to contractor
    const job = await db.query.jobs.findFirst({
      where: (jobs, { and, eq }) => and(
        eq(jobs.id, jobId),
        eq(jobs.contractorId, user.id)
      ),
    });

    if (!job) {
      return c.json({ error: "Job not found or access denied" }, 404);
    }

    // Get room images with measurements
    const images = await db.query.roomImages.findMany({
      where: (roomImages, { eq }) => eq(roomImages.roomId, roomId),
      orderBy: (roomImages, { desc }) => [desc(roomImages.createdAt)],
    });

    return c.json({
      roomId,
      images: images.map(img => ({
        id: img.id,
        imageUrl: img.imageUrl,
        measurements: img.measurements,
        processedAt: img.processedAt,
        createdAt: img.createdAt,
        updatedAt: img.updatedAt,
      })),
    });
  } catch (error) {
    console.error("Get room images error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Get all estimated item categories for all rooms in a job
jobsRouter.get("/:id/rooms/estimated-items", async (c: any) => {
  try {
    const user = c.get("user");
    if (!user) return c.json({ error: "Authentication required" }, 401);

    const jobId = c.req.param("id");

    // Verify job belongs to contractor
    const job = await db.query.jobs.findFirst({
      where: (jobs, { and, eq }) => and(
        eq(jobs.id, jobId),
        eq(jobs.contractorId, user.id)
      ),
    });

    if (!job) {
      return c.json({ error: "Job not found or access denied" }, 404);
    }

    // Get all rooms for this job
    const jobRooms = await db.query.rooms.findMany({
      where: (rooms, { eq }) => eq(rooms.jobId, jobId),
    });

    // Build result object with roomId as key and item categories array as value
    const result: Record<string, string[]> = {};

    for (const room of jobRooms) {
      // Get all room images for this room
      const images = await db.query.roomImages.findMany({
        where: (roomImages, { eq }) => eq(roomImages.roomId, room.id),
      });

      // Extract unique item categories (types) from all images
      const itemCategoriesSet = new Set<string>();
      
      for (const image of images) {
        const measurements = image.measurements as any;
        if (measurements && measurements.objects && Array.isArray(measurements.objects)) {
          for (const obj of measurements.objects) {
            if (obj.type && typeof obj.type === 'string') {
              itemCategoriesSet.add(obj.type);
            }
          }
        }
      }

      // Convert set to array and assign to room ID
      result[room.id] = Array.from(itemCategoriesSet).sort();
    }

    return c.json(result);
  } catch (error) {
    console.error("Get estimated items error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Update selected/unselected item categories for a room
jobsRouter.patch("/:jobId/rooms/:roomId/estimated-items", async (c: any) => {
  try {
    const user = c.get("user");
    if (!user) return c.json({ error: "Authentication required" }, 401);

    const jobId = c.req.param("jobId");
    const roomId = c.req.param("roomId");

    // Verify job belongs to contractor
    const job = await db.query.jobs.findFirst({
      where: (jobs, { and, eq }) => and(
        eq(jobs.id, jobId),
        eq(jobs.contractorId, user.id)
      ),
    });

    if (!job) {
      return c.json({ error: "Job not found or access denied" }, 404);
    }

    // Verify room belongs to job
    const room = await db.query.rooms.findFirst({
      where: (rooms, { and, eq }) => and(
        eq(rooms.id, roomId),
        eq(rooms.jobId, jobId)
      ),
    });

    if (!room) {
      return c.json({ error: "Room not found" }, 404);
    }

    // Get payload
    const body = await c.req.json();
    const selectedItems = Array.isArray(body.selectedItems) ? body.selectedItems : [];
    const unselectedItems = Array.isArray(body.unselectedItems) ? body.unselectedItems : [];

    // Get all room images to determine which categories are part of estimation
    const images = await db.query.roomImages.findMany({
      where: (roomImages, { eq }) => eq(roomImages.roomId, roomId),
    });

    // Extract estimated categories from images
    const estimatedCategoriesSet = new Set<string>();
    for (const image of images) {
      const measurements = image.measurements as any;
      if (measurements && measurements.objects && Array.isArray(measurements.objects)) {
        for (const obj of measurements.objects) {
          if (obj.type && typeof obj.type === 'string') {
            estimatedCategoriesSet.add(obj.type);
          }
        }
      }
    }

    const estimatedCategories = Array.from(estimatedCategoriesSet);

    // Filter unselectedItems to only include those that are part of estimation
    const validUnselectedItems = unselectedItems.filter((cat: string) => 
      estimatedCategories.includes(cat)
    );

    // Get existing measurements
    const existingMeasurements = (room.measurements as any) || {};

    // Update measurements with selected/unselected categories
    const updatedMeasurements = {
      ...existingMeasurements,
      selectedCategories: selectedItems,
      unselectedCategories: validUnselectedItems,
    };

    // Update room
    const [updatedRoom] = await db
      .update(rooms)
      .set({
        measurements: updatedMeasurements,
        updatedAt: new Date(),
      })
      .where(eq(rooms.id, roomId))
      .returning();

    return c.json({
      message: "Room item categories updated successfully",
      room: {
        id: updatedRoom.id,
        selectedCategories: selectedItems,
        unselectedCategories: validUnselectedItems,
      },
    });
  } catch (error) {
    console.error("Update room estimated items error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Delete a specific room image
jobsRouter.delete("/:jobId/rooms/:roomId/images/:imageId", async (c: any) => {
  try {
    const user = c.get("user");
    if (!user) return c.json({ error: "Authentication required" }, 401);

    const jobId = c.req.param("jobId");
    const roomId = c.req.param("roomId");
    const imageId = c.req.param("imageId");

    // Verify job exists and user has access
    const job = await db.query.jobs.findFirst({
      where: (jobs, { eq }) => eq(jobs.id, jobId),
    });

    if (!job) {
      return c.json({ error: "Job not found" }, 404);
    }

    // Check access permissions
    const hasAccess =
      user.role === "admin" ||
      (user.role === "contractor" && job.contractorId === user.id) ||
      (user.role === "customer" && job.customerId === user.id);

    if (!hasAccess) {
      return c.json({ error: "Access denied" }, 403);
    }

    // Verify room belongs to the job
    const room = await db.query.rooms.findFirst({
      where: (rooms, { and, eq }) => and(
        eq(rooms.id, roomId),
        eq(rooms.jobId, jobId)
      ),
    });

    if (!room) {
      return c.json({ error: "Room not found in this job" }, 404);
    }

    // Verify image belongs to the room
    const roomImage = await db.query.roomImages.findFirst({
      where: (roomImages, { and, eq }) => and(
        eq(roomImages.id, imageId),
        eq(roomImages.roomId, roomId)
      ),
    });

    if (!roomImage) {
      return c.json({ error: "Image not found in this room" }, 404);
    }

    // Remove the image URL from the room's imageUrls array
    const currentImageUrls = Array.isArray(room.imageUrls) 
      ? (room.imageUrls as unknown as string[]) 
      : [];
    const updatedImageUrls = currentImageUrls.filter(url => url !== roomImage.imageUrl);
    
    await db.update(rooms)
      .set({ 
        imageUrls: updatedImageUrls,
        updatedAt: new Date()
      })
      .where(eq(rooms.id, roomId));

    // Delete the specific image
    await db.delete(roomImages).where(eq(roomImages.id, imageId));

    // Check if this was the only image in the room
    const remainingImages = await db.query.roomImages.findMany({
      where: (roomImages, { eq }) => eq(roomImages.roomId, roomId),
    });

    let response: any = {
      message: "Image deleted successfully",
      deletedImage: {
        id: roomImage.id,
        imageUrl: roomImage.imageUrl,
      },
    };

    // If no images left, delete the entire room
    if (remainingImages.length === 0) {
      await db.delete(rooms).where(eq(rooms.id, roomId));
      
      response = {
        message: "Image deleted successfully. Room also deleted as it had no remaining images.",
        deletedImage: {
          id: roomImage.id,
          imageUrl: roomImage.imageUrl,
        },
        deletedRoom: {
          id: room.id,
          name: room.name,
          roomType: room.roomType,
        },
      };
    }

    return c.json(response);
  } catch (error) {
    console.error("Delete room image error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Delete a specific room from a job
jobsRouter.delete("/:jobId/rooms/:roomId", async (c: any) => {
  try {
    const user = c.get("user");
    if (!user) return c.json({ error: "Authentication required" }, 401);

    const jobId = c.req.param("jobId");
    const roomId = c.req.param("roomId");

    // Verify job exists and user has access
    const job = await db.query.jobs.findFirst({
      where: (jobs, { eq }) => eq(jobs.id, jobId),
    });

    if (!job) {
      return c.json({ error: "Job not found" }, 404);
    }

    // Check access permissions
    const hasAccess =
      user.role === "admin" ||
      (user.role === "contractor" && job.contractorId === user.id) ||
      (user.role === "customer" && job.customerId === user.id);

    if (!hasAccess) {
      return c.json({ error: "Access denied" }, 403);
    }

    // Verify room belongs to the job
    const room = await db.query.rooms.findFirst({
      where: (rooms, { and, eq }) => and(
        eq(rooms.id, roomId),
        eq(rooms.jobId, jobId)
      ),
    });

    if (!room) {
      return c.json({ error: "Room not found in this job" }, 404);
    }

    // Delete associated room images first (cascade delete)
    await db.delete(roomImages).where(eq(roomImages.roomId, roomId));

    // Delete the room
    await db.delete(rooms).where(eq(rooms.id, roomId));

    return c.json({
      message: "Room deleted successfully",
      deletedRoom: {
        id: room.id,
        name: room.name,
        roomType: room.roomType,
      },
    });
  } catch (error) {
    console.error("Delete room error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export default jobsRouter;

// Create a new job with rooms and upload images (multipart/form-data)
jobsRouter.post("/create-with-rooms", async (c: any) => {
  try {
    const user = c.get("user");
    if (!user) return c.json({ error: "Authentication required" }, 401);
    if (user.role !== "contractor")
      return c.json(
        { error: "Only contractors can create jobs with rooms" },
        403
      );

    const form = await c.req.formData();
    const jobField = form.get("job");
    const roomsField = form.get("rooms");

    if (typeof jobField !== "string" || typeof roomsField !== "string") {
      return c.json({ error: "job and rooms must be JSON strings" }, 400);
    }

    const jobPayload = JSON.parse(jobField);
    const roomsPayload = JSON.parse(roomsField) as Array<{
      name: string;
      roomType?: string;
      imageKeys?: string[];
    }>;

    // Validate minimal required job fields (match existing schema)
    const {
      title,
      description,
      customerName,
      customerAddress,
      customerPhone,
      appointmentDate,
      estimatedCost,
      customerField,
    } = jobPayload;

    if (!title) {
      return c.json({ error: "Missing required job fields: title" }, 400);
    }

    // Customer is optional: only lookup/create if provided in payload
    let customer: any = null;
    const hasCustomerInput = Boolean(
      customerName || customerPhone || customerField
    );
    if (hasCustomerInput && customerPhone) {
      customer = await db.query.customers.findFirst({
        where: (customers, { eq }) => eq(customers.phoneNumber, customerPhone),
      });
    }
    if (!customer && hasCustomerInput && customerName) {
      [customer] = await db
        .insert(customers)
        .values({
          name: customerName,
          address: customerAddress || null,
          phoneNumber: customerPhone || null,
          createdBy: user.id,
        })
        .returning();
    }

    // Create job with customerId from customers table
    const [newJob] = await db
      .insert(jobs)
      .values({
        title,
        description,
        customerName,
        customerAddress,
        customerPhone: customerPhone || null,
        appointmentDate: appointmentDate || new Date().toISOString(),
        estimatedCost: estimatedCost ? estimatedCost.toString() : null,
        customerId: customer ? customer.id : null,
        contractorId: user.id,
        status: "pending",
      })
      .returning();

    const createdRooms: any[] = [];

    for (const r of roomsPayload || []) {
      const roomName = r?.name;
      if (!roomName) continue;
      const roomType = r?.roomType || "interior";
      const imageKeys = Array.isArray(r?.imageKeys) ? r.imageKeys : [];

      // Create room first
      const [roomRow] = await db
        .insert(rooms)
        .values({
          jobId: newJob.id,
          name: roomName,
          roomType,
          imageUrls: JSON.parse("[]"),
          measurements: null,
        })
        .returning();

      // Batch upload images in parallel for this room
      const uploadPromises = imageKeys.map(async (key) => {
        const f = form.get(key);
        if (!f || typeof f === "string") return null;
        const blob = f as File | Blob;
        const buf = Buffer.from(await blob.arrayBuffer());
        const contentType = (blob as any).type || "application/octet-stream";
        const ext = contentType.split("/")[1] || "bin";
        const now = new Date().toISOString().replace(/[:.]/g, "-");
        const dest = `uploads/${user.id}/${newJob.id}/${
          roomRow.id
        }/${now}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { publicUrl, gcsUri } = await uploadBuffer(buf, dest, {
          contentType,
          makePublic: true,
        });
        return publicUrl || gcsUri;
      });

      const uploadResults = await Promise.all(uploadPromises);
      const uploadedUrls = uploadResults.filter((url): url is string => url !== null);

      // Update room with image URLs if any
      const [updatedRoom] = await db
        .update(rooms)
        .set({ imageUrls: uploadedUrls })
        .where(eq(rooms.id, roomRow.id))
        .returning();

      createdRooms.push(updatedRoom);

      // Fire-and-forget background analysis per room
      if (uploadedUrls.length > 0) {
        // Do not await: background task
        analyzeImagesForRoom(updatedRoom.id, uploadedUrls, roomType).catch(() => {});
      }
    }

    return c.json(
      {
        message: "Job and rooms created, images uploaded",
        job: newJob,
        rooms: createdRooms,
      },
      201
    );
  } catch (error) {
    console.error("Create job with rooms error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Fetch job details with customer and rooms, including images and measurements aggregates only
jobsRouter.get("/:id/details", async (c: any) => {
  try {
    const user = c.get("user");
    const jobId = c.req.param("id");

    if (!user) return c.json({ error: "Authentication required" }, 401);

    const job = await db.query.jobs.findFirst({
      where: (jobs, { eq }) => eq(jobs.id, jobId),
    });
    if (!job) return c.json({ error: "Job not found" }, 404);

    // Access control: admin, contractor on job, or customer on job
    const hasAccess =
      user.role === "admin" ||
      (user.role === "contractor" && job.contractorId === user.id) ||
      (user.role === "customer" && job.customerId === user.id);
    if (!hasAccess) return c.json({ error: "Access denied" }, 403);

    const customer = job.customerId
      ? await db.query.customers.findFirst({
          where: (customers, { eq }) =>
            eq(customers.id, job.customerId as string),
        })
      : null;

    const jobRooms = await db.query.rooms.findMany({
      where: (rooms, { eq }) => eq(rooms.jobId, job.id),
      orderBy: (rooms, { asc }) => [asc(rooms.createdAt)],
    });

    const roomsResponse = await Promise.all(jobRooms.map(async (r) => {
      const imageUrls = Array.isArray(r.imageUrls)
        ? (r.imageUrls as unknown as string[])
        : [];
      const measurements = (r.measurements as any) || null;
      let aggregates =
        measurements && typeof measurements === "object"
          ? measurements.aggregates || null
          : null;
      // Reshape to expose only consolidated items and roomDimensions for UI
      if (aggregates) {
        const roomDimensions = aggregates.roomDimensions || null;
        aggregates = { aggregates, roomDimensions };
      }

      // Fetch individual image measurements
      const roomImages = await db.query.roomImages.findMany({
        where: (roomImages, { eq }) => eq(roomImages.roomId, r.id),
        orderBy: (roomImages, { asc }) => [asc(roomImages.createdAt)],
      });

      const imageMeasurements = roomImages.map(img => ({
        id: img.id,
        imageUrl: img.imageUrl,
        measurements: img.measurements,
        processedAt: img.processedAt,
        createdAt: img.createdAt,
        updatedAt: img.updatedAt,
      }));

      return {
        id: r.id,
        name: r.name,
        roomType: r.roomType,
        imageUrls,
        measurements: aggregates, // Keep existing aggregated measurements
        imageMeasurements, // Add new image-wise measurements
        customService: r.customService,
        deduction: r.deduction,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    }));

    const jobResponse = {
      id: job.id,
      title: job.title + job.jobNumber,
      description: job.description,
      status: job.status,
      customerName: job.customerName,
      customerAddress: job.customerAddress,
      customerPhone: job.customerPhone,
      appointmentDate: job.appointmentDate,
      estimatedCost: job.estimatedCost,
      contractorId: job.contractorId,
      customerId: job.customerId,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      estimate:job.estimation
    };

    return c.json({
      job: jobResponse,
      customer: customer
        ? {
            id: customer.id,
            name: customer.name,
            email: customer.email,
            address: customer.address,
            phoneNumber: customer.phoneNumber,
            createdAt: customer.createdAt,
            updatedAt: customer.updatedAt,
          }
        : null,
      rooms: roomsResponse,
    });
  } catch (error) {
    console.error("Get job details error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Get all photos across all jobs for the authenticated contractor
jobsRouter.get("/photos", async (c: any) => {
  try {
    const user = c.get("user");
    if (!user) return c.json({ error: "Authentication required" }, 401);
    if (user.role !== "contractor")
      return c.json({ error: "Only contractors can fetch their photos" }, 403);

    const contractorJobs = await db.query.jobs.findMany({
      where: (jobs, { eq }) => eq(jobs.contractorId, user.id),
      orderBy: (jobs, { desc }) => [desc(jobs.createdAt)],
    });

    const jobIds = contractorJobs.map((j) => j.id);
    if (jobIds.length === 0)
      return c.json({ photos: [], totals: { jobs: 0, rooms: 0, images: 0 } });

    const contractorRooms = await db.query.rooms.findMany({
      where: (rooms, { inArray: inArr }) => inArr(rooms.jobId, jobIds),
      orderBy: (rooms, { desc }) => [desc(rooms.createdAt)],
    });

    let images = 0;
    const photos = contractorRooms.flatMap((r) => {
      const urls = Array.isArray(r.imageUrls)
        ? (r.imageUrls as unknown as string[])
        : [];
      images += urls.length;
      const job = contractorJobs.find((j) => j.id === r.jobId);
      return urls.map((url) => ({
        url,
        jobId: r.jobId,
        jobTitle: job?.title ?? null,
        roomId: r.id,
        roomName: r.name,
        roomType: r.roomType,
        createdAt: r.createdAt,
      }));
    });

    return c.json({
      photos,
      totals: {
        jobs: contractorJobs.length,
        rooms: contractorRooms.length,
        images,
      },
    });
  } catch (error) {
    console.error("Get contractor photos error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Update job estimation data
jobsRouter.patch("/:id/estimate", async (c: any) => {
  try {
    const user = c.get("user");
    const jobId = c.req.param("id");


    if (!user) return c.json({ error: "Authentication required" }, 401);

    const job = await db.query.jobs.findFirst({
      where: (jobs, { eq }) => eq(jobs.id, jobId),
    });
    if (!job) return c.json({ error: "Job not found" }, 404);

    const hasAccess =
      user.role === "admin" ||
      (user.role === "contractor" && job.contractorId === user.id) ||
      (user.role === "customer" && job.customerId === user.id);
    if (!hasAccess) return c.json({ error: "Access denied" }, 403);

    const estimationData = await c.req.json();

    const [updatedJob] = await db
      .update(jobs)
      .set({ 
        estimation: estimationData,
        status: "estimated",
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId))
      .returning();

    return c.json({
      message: "Job estimation updated successfully",
      job: {
        id: updatedJob.id,
        jobNumber: updatedJob.jobNumber,
        title: updatedJob.title,
        estimation: updatedJob.estimation,
        updatedAt: updatedJob.updatedAt,
      },
    });
  } catch (error) {
    console.error("Update job estimation error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Update job details aggregates for rooms (counts/sqft/selected flags)
jobsRouter.patch("/:id/details", async (c: any) => {
  try {
    const user = c.get("user");
    const jobId = c.req.param("id");

    if (!user) return c.json({ error: "Authentication required" }, 401);

    const job = await db.query.jobs.findFirst({
      where: (jobs, { eq }) => eq(jobs.id, jobId),
    });
    if (!job) return c.json({ error: "Job not found" }, 404);

    const hasAccess =
      user.role === "admin" ||
      (user.role === "contractor" && job.contractorId === user.id) ||
      (user.role === "customer" && job.customerId === user.id);
    if (!hasAccess) return c.json({ error: "Access denied" }, 403);

    const body = await c.req.json();
    const roomsPayload = Array.isArray(body?.rooms) ? body.rooms : [];
    if (roomsPayload.length === 0)
      return c.json({ error: "No rooms provided" }, 400);

    const updatedRooms: any[] = [];

    for (const rp of roomsPayload) {
      const roomId = rp?.id || rp?.roomId;
      if (!roomId) continue;

      // Load existing room and ensure it belongs to the job
      const roomRow = await db.query.rooms.findFirst({
        where: (rooms, { and, eq }) =>
          and(eq(rooms.id, roomId), eq(rooms.jobId, job.id)),
      });
      if (!roomRow) continue;

      // Check if this is image-wise measurements or legacy room-level measurements
      if (rp?.imageMeasurements && Array.isArray(rp.imageMeasurements)) {
        // Handle image-wise measurements - update individual image records
        const imageMeasurements = rp.imageMeasurements;

        for (const imageData of imageMeasurements) {
          if (!imageData.id || !imageData.imageUrl) continue;

          // Update the image measurement record in roomImages table
          await db.update(roomImages)
            .set({
              measurements: imageData.measurements,
              updatedAt: new Date(),
            })
            .where(and(
              eq(roomImages.roomId, roomId),
              eq(roomImages.imageUrl, imageData.imageUrl)
            ));
        }

        // Get the updated room data for response
        const [updated] = await db
          .update(rooms)
          .set({ updatedAt: new Date(), customService: rp.customService, deduction: rp.deduction })
          .where(eq(rooms.id, roomRow.id))
          .returning();

        updatedRooms.push({
          id: updated.id,
          name: updated.name,
          roomType: updated.roomType,
          imageUrls: Array.isArray(updated.imageUrls)
            ? (updated.imageUrls as unknown as string[])
            : [],
          measurements: updated.measurements,
          customService: updated.customService,
          deduction: updated.deduction,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        });

      } else {
        // Handle legacy room-level measurements (existing logic)
        const existing = (roomRow.measurements as any) || {};
        const existingAggregates = (existing.aggregates as any) || {};

        // Accept shape: { aggregates: { items: [...] } } or directly { items: [...] }
        const aggInput = rp?.aggregates || rp;
        const itemsInput = Array.isArray(aggInput?.items) ? aggInput.items : [];
        const roomDimensionsInput = aggInput?.roomDimensions;

        // Normalize items
        type Item = {
          type: string;
          count?: number;
          sqft?: number;
          selected?: boolean;
        };
        const normalizedItems: Item[] = [];
        const countsByType: Record<string, number> = {};
        const areaSqftByType: Record<string, number> = {};

        for (const it of itemsInput) {
          if (!it || typeof it !== "object") continue;
          const type = String(it.type || "").trim();
          if (!type) continue;
          const count = Number.isFinite(Number(it.count)) ? Number(it.count) : 0;
          const sqft = Number.isFinite(Number(it.sqft)) ? Number(it.sqft) : 0;
          const selected =
            typeof it.selected === "boolean"
              ? it.selected
              : (undefined as boolean | undefined);
          normalizedItems.push({ type, count, sqft, selected });
          countsByType[type] = (countsByType[type] || 0) + count;
          areaSqftByType[type] = (areaSqftByType[type] || 0) + sqft;
        }

        const newAggregates = {
          ...existingAggregates,
          items: normalizedItems,
          countsByType,
          areaSqftByType,
          roomDimensions:
            roomDimensionsInput ?? existingAggregates.roomDimensions ?? null,
        };

        const newMeasurements = {
          ...existing,
          aggregates: newAggregates,
        };

        // Handle customService and deduction fields
        const updateFields: any = {
          measurements: newMeasurements,
          updatedAt: new Date()
        };

        if (rp?.customService !== undefined) {
          updateFields.customService = rp.customService;
        }
        if (rp?.deduction !== undefined) {
          updateFields.deduction = rp.deduction;
        }

        const [updated] = await db
          .update(rooms)
          .set(updateFields)
          .where(eq(rooms.id, roomRow.id))
          .returning();

        // Shape response to match details endpoint
        const shapedAggregates = {
          items: newAggregates.items,
          roomDimensions: newAggregates.roomDimensions,
        };

        updatedRooms.push({
          id: updated.id,
          name: updated.name,
          roomType: updated.roomType,
          imageUrls: Array.isArray(updated.imageUrls)
            ? (updated.imageUrls as unknown as string[])
            : [],
          measurements: shapedAggregates,
          customService: updated.customService,
          deduction: updated.deduction,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        });
      }
    }

    return c.json({
      message: "Rooms updated successfully",
      rooms: updatedRooms,
    });
  } catch (error) {
    console.error("Patch job details error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Add a new room with images to an existing job
jobsRouter.post("/:id/add-room", async (c: any) => {
  try {
    const user = c.get("user");
    const jobId = c.req.param("id");

    if (!user) return c.json({ error: "Authentication required" }, 401);
    if (user.role !== "contractor")
      return c.json({ error: "Only contractors can add rooms to jobs" }, 403);

    // Verify job exists and user has access
    const job = await db.query.jobs.findFirst({
      where: (jobs, { and, eq }) =>
        and(eq(jobs.id, jobId), eq(jobs.contractorId, user.id)),
    });

    if (!job) {
      return c.json({ error: "Job not found or access denied" }, 404);
    }

    const form = await c.req.formData();
    const roomDataField = form.get("room");

    if (typeof roomDataField !== "string") {
      return c.json({ error: "room must be a JSON string" }, 400);
    }

    const roomData = JSON.parse(roomDataField);
    const { name, roomType } = roomData;

    if (!name) {
      return c.json({ error: "Room name is required" }, 400);
    }

    // Create room first
    const [newRoom] = await db
      .insert(rooms)
      .values({
        jobId: jobId,
        name: name,
        roomType: roomType || "interior",
        imageUrls: JSON.parse("[]"),
        measurements: null,
      })
      .returning();

    const imageKeys: string[] = [];

    // Extract image keys from form data
    for (const [key] of form.entries()) {
      if (key.startsWith("image")) {
        imageKeys.push(key);
      }
    }

    // Batch upload all images in parallel
    const uploadPromises = imageKeys.map(async (key) => {
      const f = form.get(key);
      if (!f || typeof f === "string") return null;
      const blob = f as File | Blob;
      const buf = Buffer.from(await blob.arrayBuffer());
      const contentType = (blob as any).type || "application/octet-stream";
      const ext = contentType.split("/")[1] || "bin";
      const now = new Date().toISOString().replace(/[:.]/g, "-");
      const dest = `uploads/${user.id}/${jobId}/${newRoom.id}/${now}-${Math.random()
        .toString(36)
        .slice(2)}.${ext}`;
      const { publicUrl, gcsUri } = await uploadBuffer(buf, dest, {
        contentType,
        makePublic: true,
      });
      return publicUrl || gcsUri;
    });

    const uploadResults = await Promise.all(uploadPromises);
    const uploadedUrls = uploadResults.filter((url): url is string => url !== null);

    // Update room with image URLs if any
    const [updatedRoom] = await db
      .update(rooms)
      .set({ imageUrls: uploadedUrls, updatedAt: new Date() })
      .where(eq(rooms.id, newRoom.id))
      .returning();

    // Fire-and-forget background analysis for the images
    if (uploadedUrls.length > 0) {
      const roomTypeValue = roomType || "interior";
      analyzeImagesForRoom(newRoom.id, uploadedUrls, roomTypeValue).catch(() => {});
    }

    return c.json(
      {
        message: "Room created and images uploaded successfully",
        room: {
          id: updatedRoom.id,
          name: updatedRoom.name,
          roomType: updatedRoom.roomType,
          imageUrls: Array.isArray(updatedRoom.imageUrls)
            ? (updatedRoom.imageUrls as unknown as string[])
            : [],
          createdAt: updatedRoom.createdAt,
          updatedAt: updatedRoom.updatedAt,
        },
        uploadedImages: uploadedUrls,
      },
      201
    );
  } catch (error) {
    console.error("Add room to job error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});
