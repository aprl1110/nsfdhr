import { getStore } from "@netlify/blobs";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
const adminWriteKey = "chlqudgns12!";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

function normalizePayload(payload) {
  const dailyPlan =
    payload.dailyPlan === null ||
    (payload.dailyPlan && typeof payload.dailyPlan === "object" && !Array.isArray(payload.dailyPlan))
      ? payload.dailyPlan
      : null;
  const dailyPlans = Array.isArray(payload.dailyPlans) ? payload.dailyPlans.filter(Boolean) : [];

  return {
    employees: Array.isArray(payload.employees) ? payload.employees.filter(Boolean) : [],
    events: Array.isArray(payload.events) ? payload.events : [],
    shiftOverrides:
      payload.shiftOverrides && typeof payload.shiftOverrides === "object" && !Array.isArray(payload.shiftOverrides)
        ? payload.shiftOverrides
        : {},
    importedRosterOnly: Boolean(payload.importedRosterOnly),
    importedRosterYear: payload.importedRosterYear ?? null,
    lastImportedMonths: Array.isArray(payload.lastImportedMonths) ? payload.lastImportedMonths : [],
    dailyPlan,
    dailyPlans,
    updatedAt: new Date().toISOString(),
  };
}

export default async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("", { status: 204, headers });
  }

  const store = getStore("nsfdhr");

  if (request.method === "GET") {
    const data = await store.get("shared-data", { type: "json" });
    return jsonResponse(data || {});
  }

  if (request.method === "POST") {
    if (request.headers.get("x-admin-key") !== adminWriteKey) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    let payload;

    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }

    const data = normalizePayload(payload || {});
    await store.setJSON("shared-data", data);

    return jsonResponse({ ok: true, updatedAt: data.updatedAt });
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
};
