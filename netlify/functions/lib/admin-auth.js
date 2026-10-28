import { getStore } from "@netlify/blobs";
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";

function authStore() {
  return getStore({ name: "nsfdhr", consistency: "strong" });
}

function matchesPassword(password, record) {
  if (typeof password !== "string") return false;
  if (!record) return password === (process.env.NSFDHR_ADMIN_PASSWORD || "chlqudgns12!");
  const actual = scryptSync(password, record.salt, 64);
  const expected = Buffer.from(record.hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function makeRecord(password) {
  const salt = randomBytes(24).toString("hex");
  return { salt, hash: scryptSync(password, salt, 64).toString("hex"), secret: randomBytes(32).toString("hex") };
}

function sign(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function makeToken(record) {
  const payload = Buffer.from(JSON.stringify({ expires: Date.now() + 12 * 60 * 60 * 1000 })).toString("base64url");
  return `${payload}.${sign(payload, record.secret)}`;
}

export async function verifyAdmin(request) {
  const token = request.headers.get("x-admin-key") || "";
  if (!token || token.length > 2048) return false;
  const record = await authStore().get("admin-auth", { type: "json" });
  if (!record) return false;
  try {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra) return false;
    const expected = Buffer.from(sign(payload, record.secret));
    const actual = Buffer.from(signature);
    return actual.length === expected.length && timingSafeEqual(actual, expected)
      && JSON.parse(Buffer.from(payload, "base64url").toString()).expires > Date.now();
  } catch {
    return false;
  }
}

export async function handleAdminAction(request, action) {
  const store = authStore();
  if (action === "session") {
    const ok = await verifyAdmin(request);
    return { status: ok ? 200 : 401, body: { ok } };
  }
  let input;
  try { input = await request.json(); } catch { return { status: 400, body: { error: "입력 내용을 확인해주세요." } }; }
  if (typeof input?.password !== "string" || input.password.length > 256) {
    return { status: 400, body: { error: "비밀번호를 확인해주세요." } };
  }
  const record = await store.get("admin-auth", { type: "json" });
  if (action === "change-password" && !(await verifyAdmin(request))) {
    return { status: 401, body: { error: "다시 로그인해주세요." } };
  }
  if (!matchesPassword(input.password, record)) return { status: 401, body: { error: "비밀번호가 맞지 않습니다." } };
  if (action === "change-password") {
    if (typeof input.newPassword !== "string" || input.newPassword.length < 8 || input.newPassword.length > 128) {
      return { status: 400, body: { error: "새 비밀번호는 8~128자로 입력해주세요." } };
    }
    if (input.newPassword === input.password) return { status: 400, body: { error: "현재 비밀번호와 다른 비밀번호를 입력해주세요." } };
    await store.setJSON("admin-auth", makeRecord(input.newPassword));
    return { status: 200, body: { ok: true } };
  }
  const activeRecord = record || makeRecord(input.password);
  if (!record) await store.setJSON("admin-auth", activeRecord);
  return { status: 200, body: { ok: true, token: makeToken(activeRecord) } };
}
