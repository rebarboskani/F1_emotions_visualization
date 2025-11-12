import F1Visualization from "@/components/F1Visualization";
import { getEmotionsData } from "@/lib/emotions";

export default async function Home() {
  const data = await getEmotionsData();

  return <F1Visualization data={data} />;
}
