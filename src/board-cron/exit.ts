// The board-cron's way out (sobra da t-1e354d15, 20/11): `process.exit` drops what stdout still holds when it is a pipe
// (`semear --seco | tee`, the crontab's log), so the end of the plan never reached the file. Exits only after every
// stream wrote what it had (an empty write's callback runs after the ones before it).

/** The part of a stream this needs: a write whose callback runs once what came before it is out. */
export interface Flushable {
  write(chunk: string, done: () => void): unknown;
}

export async function exitAfterFlush(code: number, streams: readonly Flushable[] = [process.stdout, process.stderr], exit: (code: number) => void = (c) => process.exit(c)): Promise<void> {
  // a closed pipe (`| head`) calls back with an error: that is out too
  await Promise.all(streams.map((stream) => new Promise<void>((done) => void stream.write('', () => done()))));
  exit(code);
}
