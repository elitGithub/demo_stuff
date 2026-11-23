export const ReplyRetrySettings = Object.freeze({
  Endpoint: '/api/backends/chat-completions/generate',
  DelaysMs: Object.freeze([2_000, 5_000, 10_000]),
  RetryStatuses: Object.freeze([408, 429, 500, 502, 503, 504]),
  RetryReasons: Object.freeze([
    'Too Many Requests', 'Request Timeout', 'Internal Server Error', 'Bad Gateway', 'Service Unavailable', 'Gateway Timeout',
  ]),
});
