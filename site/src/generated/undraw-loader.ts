// AUTO-GENERATED.
type PackModule = { default: string[] };
const packs: Record<string, () => Promise<PackModule>> = {
  "animals": () => import("./undraw/animals.json") as Promise<{ default: string[] }>,
  "art": () => import("./undraw/art.json") as Promise<{ default: string[] }>,
  "beauty": () => import("./undraw/beauty.json") as Promise<{ default: string[] }>,
  "character": () => import("./undraw/character.json") as Promise<{ default: string[] }>,
  "comm": () => import("./undraw/comm.json") as Promise<{ default: string[] }>,
  "education": () => import("./undraw/education.json") as Promise<{ default: string[] }>,
  "emotion": () => import("./undraw/emotion.json") as Promise<{ default: string[] }>,
  "fashion": () => import("./undraw/fashion.json") as Promise<{ default: string[] }>,
  "food": () => import("./undraw/food.json") as Promise<{ default: string[] }>,
  "health": () => import("./undraw/health.json") as Promise<{ default: string[] }>,
  "home": () => import("./undraw/home.json") as Promise<{ default: string[] }>,
  "law": () => import("./undraw/law.json") as Promise<{ default: string[] }>,
  "leisure": () => import("./undraw/leisure.json") as Promise<{ default: string[] }>,
  "media": () => import("./undraw/media.json") as Promise<{ default: string[] }>,
  "misc": () => import("./undraw/misc.json") as Promise<{ default: string[] }>,
  "money": () => import("./undraw/money.json") as Promise<{ default: string[] }>,
  "nature": () => import("./undraw/nature.json") as Promise<{ default: string[] }>,
  "people": () => import("./undraw/people.json") as Promise<{ default: string[] }>,
  "politics": () => import("./undraw/politics.json") as Promise<{ default: string[] }>,
  "religion": () => import("./undraw/religion.json") as Promise<{ default: string[] }>,
  "sport": () => import("./undraw/sport.json") as Promise<{ default: string[] }>,
  "tech": () => import("./undraw/tech.json") as Promise<{ default: string[] }>,
  "thinking": () => import("./undraw/thinking.json") as Promise<{ default: string[] }>,
  "time": () => import("./undraw/time.json") as Promise<{ default: string[] }>,
  "transport": () => import("./undraw/transport.json") as Promise<{ default: string[] }>,
  "travel": () => import("./undraw/travel.json") as Promise<{ default: string[] }>,
  "work": () => import("./undraw/work.json") as Promise<{ default: string[] }>,
};
export const loadPack = async (topic: string): Promise<string[]> => {
  const loader = packs[topic];
  if (!loader) return [];
  const mod = await loader();
  return mod.default ?? [];
};
