/** Runs once when the server starts: begin watching the asset folder for new images. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startLibraryWatcher } = await import('./lib/ingest');
    startLibraryWatcher();
  }
}
