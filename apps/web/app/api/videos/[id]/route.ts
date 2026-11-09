import { NextResponse } from "next/server";
import { cancelJob, deleteJob, getJob } from "@tasawwur/core";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const job = await getJob((await ctx.params).id);
  if (!job) return NextResponse.json({ error: "No such render." }, { status: 404 });
  return NextResponse.json(job);
}

/** Cancels a running render, and removes its files either way. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  cancelJob(id);
  await deleteJob(id);
  return new NextResponse(null, { status: 204 });
}
