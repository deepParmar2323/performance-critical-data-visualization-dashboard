/**
 * Route Handler: GET /api/data
 *
 * Returns a batch of synthetic DataPoints for initial page load.
 * This is a Server-side route — runs on Node.js, not the browser.
 *
 * Query params:
 *  - count: number of points per category (default: 200)
 *  - seed: optional timestamp seed for reproducibility
 */

import { NextRequest } from "next/server";
import { generateBatch, CATEGORIES } from "@/lib/dataGenerator";
import type { ApiDataResponse } from "@/lib/types";

// Dynamic — this route serves real-time-adjacent data so we never cache it
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = new URL(request.url);

  const count = Math.min(
    parseInt(searchParams.get("count") ?? "200", 10),
    1000 // hard cap per request
  );

  const seed = searchParams.get("seed")
    ? parseInt(searchParams.get("seed")!, 10)
    : Date.now() - count * 100;

  const data = generateBatch(count, seed, 100);

  const responseBody: ApiDataResponse = {
    data,
    meta: {
      count: data.length,
      generatedAt: Date.now(),
      categories: [...CATEGORIES],
    },
  };

  return Response.json(responseBody, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
