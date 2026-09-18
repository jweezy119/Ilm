export const starterConfig = {
  app: {
    description:
      "Reader-first Quran Foundation starter powered by the official SDK.",
    name: "Quran Foundation Starter",
    shortName: "QF Starter",
  },
  branding: {
    accent: "#55d5ff",
    background: "#020617",
    card: "#0b1228",
    text: "#e5e7eb",
  },
  defaults: {
    chapterId: "1",
    mushafId: 4,
    searchPlaceholder: "Search a verse, surah, or phrase",
  },
  features: {
    collections: true,
    goals: true,
    notes: true,
    reflections: true,
    search: true,
  },
} as const;

export type StarterConfig = typeof starterConfig;
