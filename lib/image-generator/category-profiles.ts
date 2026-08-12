export type CategoryProfile = {
  id: string;
  label: string;
  aliases: string[];
  unitsPerColor: number;
  productNoun: string;
  modelGender: "female" | "male";
  baselineGuide: string;
  wearFrames: [string, string, string];
  wearSafety: string;
  detailGuide: string;
};

export const CATEGORY_PROFILES: CategoryProfile[] = [
  {
    id: "earrings", label: "귀걸이", aliases: ["귀걸이", "이어링"], unitsPerColor: 2, productNoun: "earrings",
    modelGender: "female",
    baselineGuide: "Show exactly one matching left-right pair. Preserve the front pattern, back, side, post or hoop clasp and left-right orientation.",
    wearFrames: ["full or mostly full face in an elegant three-quarter angle with one ear clearly visible", "close face crop showing eye, lips and ear", "extreme close-up centered on ear and earring"],
    wearSafety: "Hair and hands must not cover the earring. Use one natural piercing only, no extra earring, and never place a clasp through skin.",
    detailGuide: "Prioritize front motif, side thickness, back and clasp structure.",
  },
  {
    id: "necklace", label: "목걸이", aliases: ["목걸이", "네크리스"], unitsPerColor: 1, productNoun: "necklace",
    modelGender: "female",
    baselineGuide: "Show exactly one complete necklace. Preserve the full chain pattern and length, pendant, bail, clasp and extension chain.",
    wearFrames: ["upper-body portrait showing the full neckline, chain drop and pendant position", "neck and collarbone crop showing the full pendant and chain symmetry", "close-up centered on pendant, bail and nearby chain links"],
    wearSafety: "The chain must follow the neck naturally without entering skin or breaking. Keep the pendant centered at the entered real wearing length.",
    detailGuide: "Prioritize pendant front, bail, chain-link pattern, clasp and extension chain.",
  },
  {
    id: "women-ring", label: "여자반지", aliases: ["여자반지", "여성반지"], unitsPerColor: 1, productNoun: "women's ring",
    modelGender: "female",
    baselineGuide: "Show exactly one ring. Preserve ring size, inner diameter, band width, stone count, prongs and engraving.",
    wearFrames: ["natural full hand pose with the ring clearly visible", "closer elegant hand pose centered on the worn ring", "extreme close-up showing band, setting and stone at true scale"],
    wearSafety: "Use a natural female hand with five anatomically correct fingers and one product ring only. The ring must encircle one finger naturally and never merge into skin.",
    detailGuide: "Prioritize stone setting, prongs, band width, inner surface and confirmed engraving.",
  },
  {
    id: "anklet", label: "여자발찌", aliases: ["여자발찌", "여성발찌", "발찌"], unitsPerColor: 1, productNoun: "women's anklet",
    modelGender: "female",
    baselineGuide: "Show exactly one complete anklet. Preserve every chain strand, bead spacing, charm position, clasp and extension chain.",
    wearFrames: ["full foot and ankle pose with a simple light shoe that does not cover the anklet", "ankle-centered crop showing fit around the ankle bone", "extreme close-up showing charm direction, chain strands and spacing"],
    wearSafety: "Use an anatomically correct female ankle and foot. Chains must wrap naturally without entering skin, breaking or changing strand count.",
    detailGuide: "Prioritize chain strands, bead spacing, charm, clasp and extension chain.",
  },
  {
    id: "men-ring", label: "남자반지", aliases: ["남자반지", "남성반지"], unitsPerColor: 1, productNoun: "men's ring",
    modelGender: "male",
    baselineGuide: "Show exactly one ring. Preserve ring size, inner diameter, wide band, heavy thickness, brushed and polished zones, exterior motif and only confirmed inner engraving.",
    wearFrames: ["natural full male hand pose with the product ring clearly visible", "closer masculine hand pose centered on the product ring", "extreme close-up showing wide band, motif, thickness and finish"],
    wearSafety: "Use a natural male hand with five anatomically correct fingers and one product ring only. Never invent or alter lettering or engraving and never merge the ring into skin.",
    detailGuide: "Prioritize exterior motif, brushed and polished finish, band thickness and confirmed inner engraving.",
  },
];

export function categoryProfile(category: string) {
  const normalized = category.trim().replace(/\s+/g, "");
  return CATEGORY_PROFILES.find(profile => profile.aliases.some(alias => normalized.includes(alias))) || CATEGORY_PROFILES[0];
}
