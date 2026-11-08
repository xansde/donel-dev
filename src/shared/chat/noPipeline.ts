// Homologação, item 9 (08/11) — a message from another session or from the app is not a request of the owner: it
// carries the tag the Seazone pipeline router (plugin `esteira`) already honors, so the receiving session is not told
// to "invoke /prototipo" on every notice and does not spend lines explaining why it will not.

/** The tag the `esteira` router skips (`esteira_router.py`: `"#sem-esteira" in texto.lower()`). */
export const NO_PIPELINE_TAG = '#sem-esteira';

/** The text with the tag at the end; unchanged when it already carries it. */
export function withNoPipelineTag(text: string): string {
  if (text.toLowerCase().includes(NO_PIPELINE_TAG)) return text;
  return `${text.replace(/\s+$/, '')} ${NO_PIPELINE_TAG}`;
}
