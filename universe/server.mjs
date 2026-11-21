import { createServer } from 'node:http';

const host = '127.0.0.1';
const port = 8767;
const statusLine = 'Universe launcher is running.\n';
const absoluteRootTarget = /^https?:\/\/[^/?#@\\\s]+\/?(?:\?(?:[a-z0-9._~!$&'()*+,;=:@/?-]|%[a-f0-9]{2})*)?$/i;

const server = createServer(
  /**
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   * @returns {void}
   */
  (request, response) => {
    const target = request.url;
    const originRoot = target.split('?', 1)[0] === '/';
    const absoluteRoot = absoluteRootTarget.test(target) && URL.canParse(target);
    if (!originRoot && !absoluteRoot) {
      response.writeHead(404);
      response.end();
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }

    response.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': Buffer.byteLength(statusLine),
    });
    response.end(request.method === 'HEAD' ? undefined : statusLine);
  },
);

server.on('error', (error) => {
  console.error(`Universe launcher failed to listen on ${host}:${port} (${error.code}).`);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`http://${host}:${port}/`);
});
