import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SourceTextModule, SyntheticModule, createContext, runInContext } from "node:vm";
import * as crypto from "node:crypto";

async function backend() {
  const stores = new Map();
  const getStore = (options) => {
    const name = typeof options === "string" ? options : options.name;
    if (!stores.has(name)) stores.set(name, new Map());
    const data = stores.get(name);
    return { get: async (key) => data.get(key) ?? null, setJSON: async (key, value) => data.set(key, structuredClone(value)),
      set: async (key, value) => data.set(key, value), delete: async (key) => data.delete(key) };
  };
  const context = createContext({ Buffer, process: { env: { NSFDHR_ADMIN_PASSWORD: "test-original-password" } }, Response, URL, Date });
  const modules = new Map();
  const blobs = new SyntheticModule(["getStore"], function () { this.setExport("getStore", getStore); }, { context });
  const nodeCrypto = new SyntheticModule(Object.keys(crypto), function () {
    for (const key of Object.keys(crypto)) this.setExport(key, crypto[key]);
  }, { context });
  async function moduleFor(url) {
    if (modules.has(url.href)) return modules.get(url.href);
    const module = new SourceTextModule(await readFile(url, "utf8"), { context, identifier: url.href });
    modules.set(url.href, module);
    await module.link((specifier, parent) => specifier === "@netlify/blobs" ? blobs
      : specifier === "node:crypto" ? nodeCrypto : moduleFor(new URL(specifier, parent.identifier)));
    return module;
  }
  const data = await moduleFor(new URL("../netlify/functions/hr-data.js", import.meta.url));
  await data.evaluate();
  const files = await moduleFor(new URL("../netlify/functions/daily-plan-file.js", import.meta.url));
  await files.evaluate();
  return { data: data.namespace.default, files: files.namespace.default, stores };
}

function request(action, body, token = "") {
  return new Request(`https://example.test/.netlify/functions/hr-data${action ? `?action=${action}` : ""}`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Admin-Key": token }, body: JSON.stringify(body),
  });
}

test("server login, password rotation and existing sessions across both functions", async () => {
  const { data, files, stores } = await backend();
  const password = "test-original-password";
  assert.equal((await data(request("login", { password: "wrong" }))).status, 401);
  const login = await (await data(request("login", { password }))).json();
  assert.ok(login.token);
  assert.equal((await data(request("session", {}, login.token))).status, 200);
  const employee = { id: "e1", name: "테스트", hireDate: "2024-07-01", manualAnnualSeasonStarts: ["2027-07-01"], annualLeaveAdjustments: { "2027-07-01": 5 }, exitDate: "2026-10-01" };
  assert.equal((await data(request("", { employees: [employee], customHolidays: { "2027-01-01": "신정" } }, login.token))).status, 200);
  const fileRequest = (token) => new Request("https://example.test/file?id=test&part=0", { method: "POST", headers: { "X-Admin-Key": token }, body: "test" });
  assert.equal((await files(fileRequest(login.token))).status, 200);
  assert.equal((await data(request("change-password", { password: "wrong", newPassword: "test-new-password" }, login.token))).status, 401);
  assert.equal((await data(request("change-password", { password, newPassword: "short" }, login.token))).status, 400);
  assert.equal((await data(request("change-password", { password, newPassword: "test-new-password" }, login.token))).status, 200);
  assert.equal((await data(request("session", {}, login.token))).status, 401);
  assert.equal((await data(request("", {}, login.token))).status, 401);
  assert.equal((await files(fileRequest(login.token))).status, 401);
  assert.equal((await data(request("login", { password }))).status, 401);
  const next = await (await data(request("login", { password: "test-new-password" }))).json();
  assert.equal((await data(request("session", {}, next.token))).status, 200);
  const shared = await (await data(new Request("https://example.test/data"))).json();
  assert.deepEqual(shared.employees[0], employee);
  assert.equal(shared.customHolidays["2027-01-01"], "신정");
  assert.equal(shared["admin-auth"], undefined);
  assert.ok(!JSON.stringify([...stores.get("nsfdhr").entries()]).includes("test-new-password"));
});

test("manual seasons merge with anniversaries without duplicate leave and preserve use history", async () => {
  const element = () => ({ addEventListener() {}, querySelectorAll: () => [], classList: { toggle() {}, add() {}, remove() {} }, value: "", hidden: true });
  const context = createContext({
    console, URL, Blob, TextEncoder, TextDecoder, Intl, Date, Set, Map,
    window: { location: { protocol: "file:", hostname: "" }, addEventListener() {}, clearTimeout() {}, setTimeout() {} },
    document: { querySelector: element, querySelectorAll: () => [], addEventListener() {}, body: element() },
    localStorage: { getItem: () => null }, sessionStorage: { getItem: () => null },
  });
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
  runInContext(source.slice(0, source.lastIndexOf("\ndateInput.value =")), context);
  const employee = { id: "test", name: "테스트", hireDate: "2024-07-01", manualAnnualSeasonStarts: ["2027-07-01"], annualLeaveAdjustments: { "2027-07-01": 5 }, hiddenVacationItems: [] };
  context.employee = employee;
  runInContext(`events = [{ id: 1, employeeId: "test", type: "annual", date: "2028-10-01", leaveSeasonStart: "2027-07-01" }];`, context);
  const before = runInContext('getLeaveSeasons(employee, new Date(2026, 9, 28))', context);
  assert.equal(before.filter((season) => season.startKey === "2027-07-01").length, 1);
  assert.equal(before.find((season) => season.startKey === "2027-07-01").annualTotal, 20);
  assert.equal(before.find((season) => season.startKey === "2027-07-01").annualRemaining, 19);
  assert.equal(before.find((season) => season.startKey === "2026-07-01").annualTotal, 15);
  const after = runInContext('getLeaveSeasons(employee, new Date(2028, 9, 28))', context);
  assert.equal(after.filter((season) => season.startKey === "2027-07-01").length, 1);
  assert.equal(after.find((season) => season.startKey === "2027-07-01").annualTotal, 20);
  assert.equal(after.find((season) => season.startKey === "2028-07-01").annualTotal, 15);
  assert.equal(after[0].monthlyTotal, 11);
  assert.equal(after.slice(1).every((season) => season.monthlyTotal === 0), true);
  const normalized = runInContext('normalizeEmployees([{ ...employee, exitDate: "2026-10-01" }])[0]', context);
  assert.deepEqual([...normalized.manualAnnualSeasonStarts], ["2027-07-01"]);
  assert.equal(normalized.exitDate, "2026-10-01");
  context.employee = normalized;
  runInContext('employees = [employee]; isAdmin = false;', context);
  assert.equal(runInContext("getVacationVisibleEmployees().length", context), 0);
  runInContext("isAdmin = true;", context);
  assert.equal(runInContext("getVacationVisibleEmployees().length", context), 0);
  runInContext('employee = { ...employee, manualAnnualSeasonStarts: [], annualLeaveAdjustments: {} };', context);
  const retiredSeasons = runInContext('getLeaveSeasons(employee, new Date(2030, 9, 28))', context);
  assert.equal(retiredSeasons.filter((season) => season.seasonIndex > 0).length, 2);
  assert.equal(retiredSeasons.reduce((total, season) => total + season.annualTotal, 0), 30);
  const firstYearRetired = runInContext('getLeaveSeasons({ ...employee, exitDate: "2024-10-01" }, new Date(2030, 9, 28))', context);
  assert.equal(firstYearRetired.length, 1);
  assert.equal(firstYearRetired[0].monthlyTotal, 3);
  runInContext(`
    let savedEmployeeId;
    const useButton = { dataset: { saveSubstituteUse: "2026-01-01" }, addEventListener(type, callback) { this.click = callback; } };
    vacationHistoryBody.querySelectorAll = (selector) => selector === "[data-save-substitute-use]" ? [useButton] : [];
    vacationHistoryBody.querySelector = (selector) => selector.startsWith(".substitute-use-picker") ? { value: "2026-02-01" } : null;
    vacationHistoryDialog.close = () => {};
    vacationHistoryDialog.showModal = () => {};
    saveSubstituteUse = (employeeId) => { savedEmployeeId = employeeId; };
    selectedVacationEmployeeId = "another-active-employee";
    openVacationHistoryDialog({ employeeId: "retired-employee", eyebrow: "", title: "", period: "", bodyHtml: "" });
    useButton.click();
  `, context);
  assert.equal(runInContext("savedEmployeeId", context), "retired-employee");
});
