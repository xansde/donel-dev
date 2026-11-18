/// <reference types="vite/client" />

// Novidades geradas do git log no build (`patchnotes/gitNotes.ts`).
declare module 'virtual:donel-git-notes' {
  const notes: Readonly<Record<string, { readonly title: string; readonly text: string }>>;
  export default notes;
}
