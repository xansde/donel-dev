// Minimal HTTP capture server for T002 spike (Claude Code hooks -> localhost POST).
// Listens on 127.0.0.1:PORT, logs every POST with a high-resolution timestamp
// and the raw body, and appends JSON lines to server.log for later analysis.
//
// Usage: node server.mjs [port]
// Health check: GET /health -> 200 "ok"
// Hook endpoint: POST /hook -> 200 "received"

import http from 'node:http';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORT = Number(process.argv[2] || 8765);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = path.join(__dirname, 'server.log');

const startedAtEpochMs = Date.now();
const startedAtHrNs = process.hrtime.bigint();

function hrNowMs() {
  // high-resolution ms since server start, monotonic
  const deltaNs = process.hrtime.bigint() - startedAtHrNs;
  return Number(deltaNs) / 1e6;
}

const server = http.createServer((req, res) => {
  const receivedAtEpochMs = Date.now();
  const receivedAtHrMs = hrNowMs();

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (req.method === 'POST' && req.url === '/hook') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      let parsed = null;
      let parseError = null;
      try {
        parsed = JSON.parse(body);
      } catch (e) {
        parseError = String(e && e.message ? e.message : e);
      }

      const record = {
        received_at_epoch_ms: receivedAtEpochMs,
        received_at_hr_ms_since_server_start: Number(receivedAtHrMs.toFixed(3)),
        remote: req.socket.remoteAddress,
        headers_content_length: req.headers['content-length'] || null,
        header_donel_tab_id: req.headers['x-donel-tab-id'] || null,
        header_spike_event_label: req.headers['x-spike-event-label'] || null,
        parse_error: parseError,
        body_raw: parseError ? body : undefined,
        payload: parsed,
      };

      const line = JSON.stringify(record);
      console.log(
        `[${new Date(receivedAtEpochMs).toISOString()}] POST /hook event=${
          parsed && parsed.hook_event_name ? parsed.hook_event_name : '?'
        } session_id=${parsed && parsed.session_id ? parsed.session_id : '?'} donel_tab_id=${
          parsed && parsed.donel_tab_id ? parsed.donel_tab_id : '-'
        }`
      );
      appendFileSync(LOG_PATH, line + '\n', 'utf8');

      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('received');
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `[t002] capture server listening on http://127.0.0.1:${PORT}/hook (started ${new Date(
      startedAtEpochMs
    ).toISOString()})`
  );
  console.log(`[t002] logging to ${LOG_PATH}`);
});
