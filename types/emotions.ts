export interface DriverEmotions {
  aggressiveness: number;
  confidence: number;
  frustration: number;
  pressure: number;
  risk_taking: number;
}

export interface DriverEmotionEntry {
  driver: string;
  position: number;
  color: string;
  emotions: DriverEmotions;
}

export interface LapEmotionData {
  lap: number;
  drivers: DriverEmotionEntry[];
}

export interface F1EmotionsResponse {
  available_laps: number[];
  lap_data: Record<string, LapEmotionData>;
}


