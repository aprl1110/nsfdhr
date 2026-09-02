import { getStore } from "@netlify/blobs";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key, X-File-Name, X-File-Type, X-Part-Count",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Cache-Control": "no-store",
};
const adminWriteKey = "chlqudgns12!";
const maxChunkSize = 4 * 1024 * 1024;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}

function getPartKey(url) {
  const id = url.searchParams.get("id");
  const part = url.searchParams.get("part");

  if (!id || !/^[a-zA-Z0-9._-]+$/.test(id) || !/^\d+$/.test(part || "")) {
    return "";
  }

  return `daily-plan/${id}/${part}`;
}

export default async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("", { status: 204, headers });
  }

  const url = new URL(request.url);
  const key = getPartKey(url);
  if (!key) {
    return jsonResponse({ error: "Invalid file part" }, 400);
  }

  const store = getStore("nsfdhr-files");

  if (request.method === "GET") {
    const data = await store.get(key, { type: "arrayBuffer" });
    if (!data) {
      return jsonResponse({ error: "Not found" }, 404);
    }

    return new Response(data, {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": "application/octet-stream",
      },
    });
  }

  if (request.method === "POST") {
    if (request.headers.get("x-admin-key") !== adminWriteKey) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const data = await request.arrayBuffer();
    if (data.byteLength > maxChunkSize) {
      return jsonResponse({ error: "File part too large" }, 413);
    }

    await store.set(key, data, {
      metadata: {
        name: request.headers.get("x-file-name") || "",
        type: request.headers.get("x-file-type") || "application/octet-stream",
        partCount: request.headers.get("x-part-count") || "",
      },
    });

    return jsonResponse({ ok: true });
  }

  if (request.method === "DELETE") {
    if (request.headers.get("x-admin-key") !== adminWriteKey) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    await store.delete(key);
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
};
