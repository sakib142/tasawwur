import { NextResponse } from "next/server";
import { listJobs, startJob } from "@tasawwur/core";
import { VideoParams } from "@tasawwur/schema";
import { z } from "zod";

/** Start a render, or list previous ones. */
const Body = z.object({
  params: VideoParams,
  /** Absolute paths chosen through the storyboard, bypassing a fresh search. */
  materials: z.array(z.string()).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Those settings were not valid.",
        issues: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          problem: i.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const job = await startJob(parsed.data.params, parsed.data.materials);
    return NextResponse.json(job, { status: 202 });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Could not start rendering." },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ jobs: await listJobs() });
}
