import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { callJsonUpstream, proxyResponsesApi } from "../src/upstream.js";

test("upstream requests use HTTPS proxy dispatcher when configured", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = snapshotProxyEnv();
  let seenInit = null;

  globalThis.fetch = async (_url, init) => {
    seenInit = init;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    clearProxyEnv();
    process.env.HTTPS_PROXY = "http://127.0.0.1:7890";

    await callJsonUpstream(
      "https://api.openai.com/v1/chat/completions",
      {
        id: "gpt-5.5",
        api: "chat_completions",
        model: "gpt-5.5",
        apiKey: "test-key",
      },
      { model: "gpt-5.5" },
      {},
    );

    assert.ok(seenInit?.dispatcher, "expected fetch init to include proxy dispatcher");
  } finally {
    globalThis.fetch = originalFetch;
    restoreProxyEnv(originalEnv);
  }
});

test("upstream requests retry direct when proxy network fetch fails", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = snapshotProxyEnv();
  const calls = [];

  globalThis.fetch = async (_url, init) => {
    calls.push(Boolean(init?.dispatcher));
    if (init?.dispatcher) {
      const error = new TypeError("fetch failed");
      error.cause = { code: "UND_ERR_SOCKET" };
      throw error;
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    clearProxyEnv();
    process.env.HTTPS_PROXY = "http://127.0.0.1:7890";

    const response = await callJsonUpstream(
      "https://api.deepseek.com/v1/chat/completions",
      {
        id: "deepseek-v4-flash",
        api: "chat_completions",
        model: "deepseek-v4-flash",
        apiKey: "test-key",
      },
      { model: "deepseek-v4-flash" },
      {},
    );

    assert.deepEqual(calls, [true, false]);
    assert.deepEqual(response, { ok: true });
  } finally {
    globalThis.fetch = originalFetch;
    restoreProxyEnv(originalEnv);
  }
});

test("upstream requests ignore unsupported SOCKS proxy URLs", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = snapshotProxyEnv();
  let seenInit = null;

  globalThis.fetch = async (_url, init) => {
    seenInit = init;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    clearProxyEnv();
    process.env.HTTPS_PROXY = "socks5://127.0.0.1:10808";

    await callJsonUpstream(
      "https://api.deepseek.com/v1/chat/completions",
      {
        id: "deepseek-v4-flash",
        api: "chat_completions",
        model: "deepseek-v4-flash",
        apiKey: "test-key",
      },
      { model: "deepseek-v4-flash" },
      {},
    );

    assert.equal(Boolean(seenInit?.dispatcher), false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreProxyEnv(originalEnv);
  }
});

test("codex_openai responses use ChatGPT Codex backend and forward Codex headers", async () => {
  const originalBackend = process.env.CODEXBRIDGE_CHATGPT_CODEX_BASE_URL;
  let seenRequest = null;

  const upstream = httpServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    seenRequest = {
      url: req.url,
      headers: req.headers,
      body: Buffer.concat(chunks).toString("utf8"),
    };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "resp_subscription",
        object: "response",
        status: "completed",
        model: "gpt-5.5",
        output: [],
        output_text: "hello from subscription",
      }),
    );
  });

  try {
    await listen(upstream);
    process.env.CODEXBRIDGE_CHATGPT_CODEX_BASE_URL = `${serverUrl(upstream)}/backend-api/codex`;

    const res = collectResponse();
    await proxyResponsesApi(
      {
        model: "gpt-5.5",
        input: "hello",
        stream: true,
      },
      {
        id: "gpt-5.5",
        api: "responses",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.5",
        authMode: "codex_openai",
      },
      res,
      {
        clientAuth: {
          kind: "codex_openai",
          bearerToken: "codex-openai-token",
        },
        clientHeaders: {
          "chatgpt-account-id": "acct_123",
          "session-id": "sess_123",
          "thread-id": "thread_123",
          "x-codex-turn-state": "sticky_123",
          "x-codex-beta-features": "feature-a",
        },
      },
    );

    assert.equal(seenRequest.url, "/backend-api/codex/responses");
    assert.equal(seenRequest.headers.authorization, "Bearer codex-openai-token");
    assert.equal(seenRequest.headers.accept, "text/event-stream");
    assert.equal(seenRequest.headers["chatgpt-account-id"], "acct_123");
    assert.equal(seenRequest.headers["session-id"], "sess_123");
    assert.equal(seenRequest.headers["thread-id"], "thread_123");
    assert.equal(seenRequest.headers["x-codex-turn-state"], "sticky_123");
    assert.equal(seenRequest.headers["x-codex-beta-features"], "feature-a");
    assert.equal(JSON.parse(seenRequest.body).model, "gpt-5.5");
    assert.match(res.body(), /hello from subscription/);
  } finally {
    if (originalBackend === undefined) {
      delete process.env.CODEXBRIDGE_CHATGPT_CODEX_BASE_URL;
    } else {
      process.env.CODEXBRIDGE_CHATGPT_CODEX_BASE_URL = originalBackend;
    }
    await close(upstream);
  }
});

test("responses stream logs token usage from completed SSE event", async () => {
  const originalBackend = process.env.CODEXBRIDGE_CHATGPT_CODEX_BASE_URL;
  const originalLog = console.log;
  const logs = [];

  const upstream = httpServer(async (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
    res.write("event: response.completed\n");
    res.write(
      `data: ${JSON.stringify({
        type: "response.completed",
        response: {
          id: "resp_with_usage",
          usage: {
            input_tokens: 12,
            output_tokens: 34,
            total_tokens: 46,
          },
        },
      })}\n\n`,
    );
    res.end("data: [DONE]\n\n");
  });

  try {
    await listen(upstream);
    process.env.CODEXBRIDGE_CHATGPT_CODEX_BASE_URL = `${serverUrl(upstream)}/backend-api/codex`;
    console.log = (line) => logs.push(String(line));

    const res = collectResponse();
    await proxyResponsesApi(
      {
        model: "gpt-5.5",
        input: "hello",
        stream: true,
      },
      {
        id: "gpt-5.5",
        api: "responses",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.5",
        authMode: "codex_openai",
      },
      res,
      {
        requestId: "req_usage",
        clientAuth: {
          kind: "codex_openai",
          bearerToken: "codex-openai-token",
        },
      },
    );

    assert.match(res.body(), /response.completed/);
    assert.ok(
      logs.some((line) =>
        line.includes("req_usage <- upstream route=gpt-5.5 usage prompt=12 completion=34 total=46"),
      ),
      "expected Responses SSE usage to be logged",
    );
  } finally {
    console.log = originalLog;
    if (originalBackend === undefined) {
      delete process.env.CODEXBRIDGE_CHATGPT_CODEX_BASE_URL;
    } else {
      process.env.CODEXBRIDGE_CHATGPT_CODEX_BASE_URL = originalBackend;
    }
    await close(upstream);
  }
});

function snapshotProxyEnv() {
  const keys = proxyEnvKeys();
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function clearProxyEnv() {
  for (const key of proxyEnvKeys()) {
    delete process.env[key];
  }
}

function restoreProxyEnv(snapshot) {
  clearProxyEnv();
  for (const [key, value] of Object.entries(snapshot)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
}

function proxyEnvKeys() {
  return [
    "CODEXBRIDGE_HTTPS_PROXY",
    "CODEXBRIDGE_HTTP_PROXY",
    "CODEXBRIDGE_ALL_PROXY",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "ALL_PROXY",
    "https_proxy",
    "http_proxy",
    "all_proxy",
    "NO_PROXY",
    "no_proxy",
  ];
}

function httpServer(handler) {
  return http.createServer(handler);
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function serverUrl(server) {
  const address = server.address();
  return `http://${address.address}:${address.port}`;
}

function collectResponse() {
  const chunks = [];
  return {
    statusCode: null,
    headers: null,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    write(chunk) {
      chunks.push(Buffer.from(chunk));
    },
    end(chunk) {
      if (chunk) {
        chunks.push(Buffer.from(chunk));
      }
    },
    body() {
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}
