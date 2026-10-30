// Run in a child process: a late decompressor error must not kill its server.
// argv[2] is the Express module resolved through the dependency tree under test.
const http = require('node:http');
const zlib = require('node:zlib');
const express = require(process.argv[2]);
const encoding = process.argv[3];
const payload = JSON.stringify({ fixture: 'compressed-request', count: 2 });
const frame = encoding === 'gzip' ? zlib.gzipSync(payload) : zlib.deflateSync(payload);
const first = Buffer.concat([frame, Buffer.from([0])]);
const tail = Buffer.alloc(128 * 1024, 0x58);
const parser = express.json();
let client;

const server = http.createServer((req, res) => {
  if (req.method === 'GET') return res.end('alive');
  parser(req, res, (error) => {
    if (error) {
      res.statusCode = error.status || 500;
      return res.end('parse-error');
    }
    if (encoding === 'deflate') client.end(tail);
    // Verify downstream middleware can still consume the rest of the request.
    req.on('end', () => res.end(JSON.stringify(req.body)));
    req.resume();
  });
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  client = http.request({
    host: '127.0.0.1', port, method: 'POST', agent: false,
    headers: {
      'content-type': 'application/json', 'content-encoding': encoding,
      'content-length': first.length + tail.length,
    },
  }, (res) => {
    let body = '';
    res.setEncoding('utf8').on('data', (chunk) => { body += chunk; });
    res.on('end', () => {
      if (res.statusCode !== 200 || body !== payload) process.exit(2);
      // Allow late decoder errors to surface before proving the process is alive.
      setTimeout(() => {
        http.get({ host: '127.0.0.1', port, agent: false }, (health) => {
          let result = '';
          health.setEncoding('utf8').on('data', (chunk) => { result += chunk; });
          health.on('end', () => {
            if (result !== 'alive') process.exit(3);
            server.close(() => process.stdout.write('compressed-body:ok\n'));
          });
        }).on('error', () => process.exit(4));
      }, 50);
    });
  });
  client.setTimeout(2000, () => process.exit(5));
  client.on('error', () => process.exit(6));
  if (encoding === 'gzip') client.end(Buffer.concat([first, tail]));
  else client.write(first);
});
setTimeout(() => process.exit(7), 4000).unref();
