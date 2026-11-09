import type { Voice } from "./types.ts";

/**
 * The voices the local speech model ships with.
 *
 * Generated from the model's own metadata rather than typed out, and held
 * statically so the voice picker does not have to load a hundred megabytes of
 * model just to list names.
 *
 * Grades come from the model authors and vary a great deal — an A voice and a
 * D voice are not close. Ordered best first, and anything below a B is marked
 * in the interface rather than silently offered as an equal.
 */
export const KOKORO_VOICES: readonly Voice[] = [
  { id: "af_heart", name: "Heart", language: "American English", gender: "Female", grade: "A" },
  { id: "af_bella", name: "Bella", language: "American English", gender: "Female", grade: "A-" },
  { id: "bf_emma", name: "Emma", language: "British English", gender: "Female", grade: "B-" },
  { id: "af_nicole", name: "Nicole", language: "American English", gender: "Female", grade: "B-" },
  { id: "af_aoede", name: "Aoede", language: "American English", gender: "Female", grade: "C+" },
  { id: "am_fenrir", name: "Fenrir", language: "American English", gender: "Male", grade: "C+" },
  { id: "af_kore", name: "Kore", language: "American English", gender: "Female", grade: "C+" },
  { id: "am_michael", name: "Michael", language: "American English", gender: "Male", grade: "C+" },
  { id: "am_puck", name: "Puck", language: "American English", gender: "Male", grade: "C+" },
  { id: "af_sarah", name: "Sarah", language: "American English", gender: "Female", grade: "C+" },
  { id: "af_alloy", name: "Alloy", language: "American English", gender: "Female", grade: "C" },
  { id: "bm_fable", name: "Fable", language: "British English", gender: "Male", grade: "C" },
  { id: "bm_george", name: "George", language: "British English", gender: "Male", grade: "C" },
  { id: "bf_isabella", name: "Isabella", language: "British English", gender: "Female", grade: "C" },
  { id: "af_nova", name: "Nova", language: "American English", gender: "Female", grade: "C" },
  { id: "af_sky", name: "Sky", language: "American English", gender: "Female", grade: "C-" },
  { id: "bf_alice", name: "Alice", language: "British English", gender: "Female", grade: "D" },
  { id: "bm_daniel", name: "Daniel", language: "British English", gender: "Male", grade: "D" },
  { id: "am_echo", name: "Echo", language: "American English", gender: "Male", grade: "D" },
  { id: "am_eric", name: "Eric", language: "American English", gender: "Male", grade: "D" },
  { id: "af_jessica", name: "Jessica", language: "American English", gender: "Female", grade: "D" },
  { id: "bm_lewis", name: "Lewis", language: "British English", gender: "Male", grade: "D+" },
  { id: "am_liam", name: "Liam", language: "American English", gender: "Male", grade: "D" },
  { id: "bf_lily", name: "Lily", language: "British English", gender: "Female", grade: "D" },
  { id: "am_onyx", name: "Onyx", language: "American English", gender: "Male", grade: "D" },
  { id: "af_river", name: "River", language: "American English", gender: "Female", grade: "D" },
  { id: "am_adam", name: "Adam", language: "American English", gender: "Male", grade: "F+" },
  { id: "am_santa", name: "Santa", language: "American English", gender: "Male", grade: "D-" },
] as const;

/** Grades at or above this are offered without qualification. */
export const GOOD_GRADES = new Set(["A", "A-", "B+", "B", "B-"]);

export const DEFAULT_VOICE = "af_heart";
