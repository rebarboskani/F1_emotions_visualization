import { NextResponse } from "next/server";

import { getEmotionsData } from "@/lib/emotions";

export async function GET() {
  try {
    const data = await getEmotionsData();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to load F1 emotions data", error);
    return NextResponse.json(
      { message: "Failed to load F1 emotions data." },
      { status: 500 }
    );
  }
}


