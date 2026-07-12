// Identité visuelle Alertiva + polices Google chargées de façon déterministe
// (rendu identique en local Windows ET sur les runners Linux de GitHub Actions,
//  où Georgia/Arial n'existent pas).
import { loadFont as loadHeadFont } from "@remotion/google-fonts/PlayfairDisplay";
import { loadFont as loadBodyFont } from "@remotion/google-fonts/Inter";

export const { fontFamily: SERIF } = loadHeadFont("normal", { weights: ["700", "800", "900"] });
export const { fontFamily: SANS } = loadBodyFont("normal", { weights: ["500", "600", "700", "800"] });

export const ALERT = "#E03131";
export const DARK = "#0d0d14";
export const CREAM = "#F5EFE0";

export const CAT_FR: Record<string, string> = {
  monde: "À l'international", france: "En France", politique: "Politique",
  economie: "Économie", tech: "Technologie", sport: "Sport", sciences: "Sciences",
  sante: "Santé", culture: "Culture", insolite: "Insolite",
};

export type Cue = { text: string; start: number; end: number };
