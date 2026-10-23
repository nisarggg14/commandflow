export const BACKGROUND_VALUES = ["obsidian", "paper", "mist", "black"] as const;

export type BackgroundValue = (typeof BACKGROUND_VALUES)[number];
