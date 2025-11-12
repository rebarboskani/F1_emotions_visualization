import { promises as fs } from "node:fs";
import path from "node:path";

import type { F1EmotionsResponse } from "@/types/emotions";

const DATA_FILE = path.join(process.cwd(), "data", "f1_emotions_data.json");

let cachedData: F1EmotionsResponse | null = null;

export async function getEmotionsData(): Promise<F1EmotionsResponse> {
  if (cachedData) {
    return cachedData;
  }

  const file = await fs.readFile(DATA_FILE, "utf-8");
  const parsed = JSON.parse(file) as F1EmotionsResponse;

  // Normalise laps to integers since source file encodes as floats.
  parsed.available_laps = parsed.available_laps.map((lap) => Math.round(lap));

  cachedData = parsed;
  return parsed;
}

export function clearEmotionsCache() {
  cachedData = null;
}


