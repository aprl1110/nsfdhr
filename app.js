const employeeColors = [
  "#146c68",
  "#3578b8",
  "#8461b8",
  "#c5862d",
  "#4f7f52",
  "#9a5f8f",
  "#bd5a47",
  "#50768d",
  "#7b6b39",
  "#9a4f64",
];

const defaultEmployees = [
  { id: "e01", name: "황예슬", role: "FD", color: "#146c68" },
  { id: "e02", name: "최병훈", role: "FD", color: "#3578b8" },
  { id: "e03", name: "진주성", role: "FD", color: "#8461b8" },
  { id: "e04", name: "김지현", role: "FD", color: "#c5862d" },
  { id: "e05", name: "김현수", role: "FD", color: "#4f7f52" },
  { id: "e06", name: "문주현", role: "FD", color: "#9a5f8f" },
  { id: "e07", name: "최은지", role: "FD", color: "#bd5a47" },
  { id: "e08", name: "한다빈", role: "FD", color: "#50768d" },
  { id: "e09", name: "안병주", role: "FD", color: "#7b6b39" },
  { id: "e10", name: "박다연", role: "FD", color: "#9a4f64" },
];

const defaultAnnualLeaveTotal = 15;

let employees = normalizeEmployees(loadStoredData("hrEmployees", defaultEmployees));

const eventTypes = {
  annual: "연차",
  monthly: "월차",
  substitute: "대휴",
  sick: "병가",
};

let events = [
  { id: 1, employeeId: "e02", type: "annual", date: "2026-06-03", memo: "오후 반차" },
  { id: 2, employeeId: "e05", type: "monthly", date: "2026-06-04", memo: "개인 일정" },
  { id: 3, employeeId: "e07", type: "substitute", date: "2026-06-05", memo: "주말 근무 대체" },
  { id: 4, employeeId: "e03", type: "sick", date: "2026-06-08", memo: "병원 진료" },
  { id: 5, employeeId: "e04", type: "annual", date: "2026-06-12", memo: "연차" },
  { id: 6, employeeId: "e06", type: "monthly", date: "2026-06-12", memo: "월차" },
  { id: 7, employeeId: "e10", type: "substitute", date: "2026-06-16", memo: "대휴" },
  { id: 8, employeeId: "e08", type: "annual", date: "2026-06-22", memo: "가족 일정" },
  { id: 9, employeeId: "e01", type: "sick", date: "2026-06-24", memo: "오전 병가" },
  { id: 10, employeeId: "e09", type: "substitute", date: "2026-06-27", memo: "마감 지원 대체" },
];

let shiftOverrides = {};
let importedRosterOnly = false;
let importedRosterYear = null;
let dailyPlan = null;
let dailyPlans = [];
events = loadStoredData("hrEvents", events);
shiftOverrides = loadStoredData("hrShiftOverrides", {});
importedRosterOnly = loadStoredData("hrImportedRosterOnly", false);
importedRosterYear = loadStoredData("hrImportedRosterYear", null);
dailyPlan = loadStoredData("hrDailyPlan", null);
dailyPlans = loadStoredData("hrDailyPlans", dailyPlan ? [dailyPlan] : []);
dailyPlan = dailyPlans[0] || dailyPlan;

const isLocalPreview =
  window.location.protocol === "file:" || ["", "127.0.0.1", "localhost"].includes(window.location.hostname);
const isNetlifyHost = window.location.hostname.endsWith("netlify.app");
const remoteDataEndpoint = isNetlifyHost
  ? "/.netlify/functions/hr-data"
  : isLocalPreview
    ? "https://nsfdhr.netlify.app/.netlify/functions/hr-data"
    : "/api/hr-data";
const adminPassword = "chlqudgns12!";
const adminSessionKey = "hrAdminMode";
const dailyPlanFileEndpoint = isNetlifyHost
  ? "/.netlify/functions/daily-plan-file"
  : isLocalPreview
    ? "https://nsfdhr.netlify.app/.netlify/functions/daily-plan-file"
    : "/api/daily-plan-file";
const dailyPlanChunkSize = 3 * 1024 * 1024;
const dailyPlanUploadConcurrency = 3;
const dailyPlanMaxSize = 60 * 1024 * 1024;
const dailyPlanFeatureEnabled = false;
const sharedStorageKeys = new Set([
  "hrEmployees",
  "hrEvents",
  "hrShiftOverrides",
  "hrImportedRosterOnly",
  "hrImportedRosterYear",
  "hrLastImportedMonths",
  "hrDailyPlan",
  "hrDailyPlans",
]);
let remoteSaveTimer = null;
let isApplyingRemoteData = false;
let isAdmin = sessionStorage.getItem(adminSessionKey) === "true";
let activePage = "home";
let lastShownDailyPlanStamp = "";
let dailyPlanAutoShown = false;
const dailyPlanObjectUrls = new Map();
let dailyPlanViewIndex = 0;
let dailyPlanPreviewToken = 0;
let pullRefreshStartY = 0;
let pullRefreshDistance = 0;
let isPullRefreshActive = false;
let isPullRefreshing = false;

function normalizeEmployees(employeeList = []) {
  const seen = new Set();
  return employeeList
    .filter((employee) => employee && employee.id && employee.name)
    .map((employee, index) => ({
      id: String(employee.id),
      name: String(employee.name).trim(),
      role: employee.role || "FD",
      color: employee.color || employeeColors[index % employeeColors.length],
      hireDate: employee.hireDate || "",
      exitDate: employee.exitDate || "",
      order: Number.isFinite(Number(employee.order)) ? Number(employee.order) : index,
      annualLeaveTotal: Number.isFinite(Number(employee.annualLeaveTotal))
        ? Number(employee.annualLeaveTotal)
        : defaultAnnualLeaveTotal,
      substituteEarnedDates: normalizeDateList(employee.substituteEarnedDates),
      substituteEarnedRemovedDates: normalizeDateList(employee.substituteEarnedRemovedDates),
    }))
    .filter((employee) => {
      if (seen.has(employee.id)) return false;
      seen.add(employee.id);
      return true;
    });
}

function isEmployeeActive(employee) {
  return !employee.exitDate;
}

function getEmployeeStatusText(employee) {
  if (employee.exitDate) return `퇴사 ${employee.exitDate}`;
  if (employee.hireDate) return `입사 ${employee.hireDate}`;
  return "재직";
}

function normalizeDateList(value) {
  const dateValues = Array.isArray(value) ? value : [];
  return Array.from(
    new Set(
      dateValues
        .map((item) => (typeof item === "string" ? item : item?.date))
        .filter((dateKey) => /^\d{4}-\d{2}-\d{2}$/.test(dateKey || "")),
    ),
  ).sort();
}

const holidays = {
  "2026-01-01": "신정",
  "2026-02-16": "설날 연휴",
  "2026-02-17": "설날",
  "2026-02-18": "설날 연휴",
  "2026-03-01": "삼일절",
  "2026-03-02": "삼일절 대체공휴일",
  "2026-05-01": "근로자의 날",
  "2026-05-05": "어린이날",
  "2026-05-24": "부처님오신날",
  "2026-05-25": "부처님오신날 대체공휴일",
  "2026-06-03": "지방선거일",
  "2026-06-06": "현충일",
  "2026-07-17": "제헌절",
  "2026-08-15": "광복절",
  "2026-08-17": "광복절 대체공휴일",
  "2026-09-24": "추석 연휴",
  "2026-09-25": "추석",
  "2026-09-26": "추석 연휴",
  "2026-10-03": "개천절",
  "2026-10-05": "개천절 대체공휴일",
  "2026-10-09": "한글날",
  "2026-12-25": "성탄절",
};

const weekdayShiftPositions = ["첫방", "둘방", "오전상근", "티컴", "오후상근", "막전", "막방"];
const weekendShiftPositions = ["첫방", "둘방", "주말상근", "막전", "막방"];

function getShiftPositions(date) {
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
  return isWeekend ? weekendShiftPositions : weekdayShiftPositions;
}

function getDefaultShiftEmployees(date) {
  const positions = getShiftPositions(date);
  const daySeed = Math.floor(date.getTime() / 86400000);
  const activeEmployees = employees.filter(isEmployeeActive);
  const availableEmployees = activeEmployees.length > 0 ? activeEmployees : employees;
  if (availableEmployees.length === 0) {
    return positions.map(() => null);
  }
  const startIndex = daySeed % availableEmployees.length;

  return Array.from({ length: positions.length }, (_, index) => {
    return availableEmployees[(startIndex + index) % availableEmployees.length];
  });
}

function getShiftAssignments(date) {
  const dateKey = toDateKey(date);
  const positions = getShiftPositions(date);
  const defaults = getDefaultShiftEmployees(date);
  const overrides = shiftOverrides[dateKey] || {};

  return positions.map((position, index) => ({
    employee: getEmployee(overrides[position]) || (importedRosterOnly ? null : defaults[index]),
    position,
  }));
}

const today = new Date();
let currentDate = new Date(today.getFullYear(), today.getMonth(), 1);
let selectedDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
let selectedEmployeeId = "all";
let selectedVacationEmployeeId = "";

const calendarGrid = document.querySelector("#calendarGrid");
const monthTitle = document.querySelector("#monthTitle");
const filterLabel = document.querySelector("#filterLabel");
const todayLabel = document.querySelector("#todayLabel");
const selectedDateTitle = document.querySelector("#selectedDateTitle");
const selectedDateBadge = document.querySelector("#selectedDateBadge");
const dayEvents = document.querySelector("#dayEvents");
const employeeList = document.querySelector("#employeeList");
const employeeInput = document.querySelector("#employeeInput");
const typeInput = document.querySelector("#typeInput");
const dateInput = document.querySelector("#dateInput");
const memoInput = document.querySelector("#memoInput");
const requestForm = document.querySelector("#requestForm");
const toggleRequestBtn = document.querySelector("#toggleRequestBtn");
const workingCount = document.querySelector("#workingCount");
const awayCount = document.querySelector("#awayCount");
const pendingCount = document.querySelector("#pendingCount");
const eventTemplate = document.querySelector("#eventTemplate");
const shiftDialog = document.querySelector("#shiftDialog");
const shiftDialogTitle = document.querySelector("#shiftDialogTitle");
const shiftSettingsDate = document.querySelector("#shiftSettingsDate");
const applyShiftDate = document.querySelector("#applyShiftDate");
const shiftSettingsRows = document.querySelector("#shiftSettingsRows");
const shiftSettingsForm = document.querySelector("#shiftSettingsForm");
const closeShiftDialog = document.querySelector("#closeShiftDialog");
const cancelShiftSettings = document.querySelector("#cancelShiftSettings");
const editRosterBtn = document.querySelector("#editRosterBtn");
const rosterDialog = document.querySelector("#rosterDialog");
const rosterForm = document.querySelector("#rosterForm");
const rosterDialogTitle = document.querySelector("#rosterDialogTitle");
const rosterTableHead = document.querySelector("#rosterTableHead");
const rosterTableBody = document.querySelector("#rosterTableBody");
const closeRosterDialog = document.querySelector("#closeRosterDialog");
const cancelRosterEdit = document.querySelector("#cancelRosterEdit");
const prevRosterMonth = document.querySelector("#prevRosterMonth");
const nextRosterMonth = document.querySelector("#nextRosterMonth");
const importAnnualRoster = document.querySelector("#importAnnualRoster");
const calendarPageBtn = document.querySelector("#calendarPageBtn");
const rosterPageBtn = document.querySelector("#rosterPageBtn");
const vacationPageBtn = document.querySelector("#vacationPageBtn");
const homeLogoBtn = document.querySelector("#homeLogoBtn");
const homeRosterBtn = document.querySelector("#homeRosterBtn");
const homeCalendarBtn = document.querySelector("#homeCalendarBtn");
const homeVacationBtn = document.querySelector("#homeVacationBtn");
const vacationEmployeeButtons = document.querySelector("#vacationEmployeeButtons");
const vacationDetail = document.querySelector("#vacationDetail");
const pullRefreshIndicator = document.querySelector("#pullRefreshIndicator");
const employeeManageBtn = document.querySelector("#employeeManageBtn");
const employeeManageDialog = document.querySelector("#employeeManageDialog");
const employeeManageForm = document.querySelector("#employeeManageForm");
const employeeManageList = document.querySelector("#employeeManageList");
const closeEmployeeManageDialog = document.querySelector("#closeEmployeeManageDialog");
const newEmployeeName = document.querySelector("#newEmployeeName");
const newEmployeeHireDate = document.querySelector("#newEmployeeHireDate");
const addEmployeeBtn = document.querySelector("#addEmployeeBtn");
const adminLoginBtn = document.querySelector("#adminLoginBtn");
const adminLogoutBtn = document.querySelector("#adminLogoutBtn");
const dailyPlanInput = document.querySelector("#dailyPlanInput");
const dailyPlanDialog = document.querySelector("#dailyPlanDialog");
const dailyPlanTitle = document.querySelector("#dailyPlanTitle");
const dailyPlanCounter = document.querySelector("#dailyPlanCounter");
const dailyPlanPreview = document.querySelector("#dailyPlanPreview");
const dailyPlanDownload = document.querySelector("#dailyPlanDownload");
const closeDailyPlanDialog = document.querySelector("#closeDailyPlanDialog");
const prevDailyPlan = document.querySelector("#prevDailyPlan");
const nextDailyPlan = document.querySelector("#nextDailyPlan");
const dailyPlanListBtn = document.querySelector("#dailyPlanListBtn");
const dailyPlanListDialog = document.querySelector("#dailyPlanListDialog");
const dailyPlanList = document.querySelector("#dailyPlanList");
const closeDailyPlanListDialog = document.querySelector("#closeDailyPlanListDialog");
const dailyPlanUploadProgress = document.querySelector("#dailyPlanUploadProgress");
const dailyPlanUploadText = document.querySelector("#dailyPlanUploadText");
const dailyPlanUploadPercent = document.querySelector("#dailyPlanUploadPercent");
const dailyPlanUploadBar = document.querySelector("#dailyPlanUploadBar");

let rosterEditDate = new Date(currentDate);

const formatter = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long" });
const fullDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "long",
  day: "numeric",
  weekday: "short",
});

function setActivePage(page) {
  activePage = page;
  document.querySelectorAll("[data-page-panel]").forEach((panel) => {
    panel.hidden = !panel.dataset.pagePanel.split(" ").includes(page);
  });

  calendarPageBtn.classList.toggle("active", page === "calendar");
  rosterPageBtn.classList.toggle("active", page === "roster");
  vacationPageBtn.classList.toggle("active", page === "vacation");
  if (page === "vacation") {
    renderVacationPage();
  }
  showDailyPlanOnHome();
}

function updateAdminUi() {
  document.body.classList.toggle("admin-mode", isAdmin);
  document.body.classList.toggle("viewer-mode", !isAdmin);

  if (adminLoginBtn) {
    adminLoginBtn.hidden = isAdmin;
  }

  if (adminLogoutBtn) {
    adminLogoutBtn.hidden = !isAdmin;
  }
}

function requireAdmin(message = "관리자만 사용할 수 있습니다.") {
  if (isAdmin) return true;
  alert(message);
  return false;
}

function setAdminMode(nextValue) {
  isAdmin = nextValue;
  if (isAdmin) {
    sessionStorage.setItem(adminSessionKey, "true");
  } else {
    sessionStorage.removeItem(adminSessionKey);
  }
  updateAdminUi();
  render();
  if (!rosterDialog.hidden) {
    renderRosterEditor();
    scrollToRosterToday();
  }
}

function setDailyPlanUploadProgress(doneParts, totalParts, statusText = "업로드 중") {
  const safeTotal = Math.max(totalParts, 1);
  const percent = Math.round((doneParts / safeTotal) * 100);

  dailyPlanUploadProgress.hidden = false;
  dailyPlanUploadText.textContent = `${statusText} (${doneParts}/${safeTotal})`;
  dailyPlanUploadPercent.textContent = `${percent}%`;
  dailyPlanUploadBar.style.width = `${percent}%`;
}

function hideDailyPlanUploadProgress(delay = 900) {
  window.setTimeout(() => {
    dailyPlanUploadProgress.hidden = true;
    dailyPlanUploadBar.style.width = "0%";
    dailyPlanUploadPercent.textContent = "0%";
    dailyPlanUploadText.textContent = "업로드 준비 중";
  }, delay);
}

function getBroadcastDateKey(date = new Date(), mode = "current") {
  const broadcastDate = new Date(date);
  if (mode === "upload" && broadcastDate.getHours() >= 16) {
    broadcastDate.setDate(broadcastDate.getDate() + 1);
  } else if (broadcastDate.getHours() < 4) {
    broadcastDate.setDate(broadcastDate.getDate() - 1);
  }
  return toDateKey(broadcastDate);
}

function getDailyPlanFileDateLabel(fileName = "") {
  const match = String(fileName).match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (!match) return "";

  const month = Number(match[1]);
  const day = Number(match[2]);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return "";
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";

  return `${month}월 ${day}일`;
}

function getDailyPlanDateLabel(plan) {
  return plan?.fileDateLabel || getDailyPlanFileDateLabel(plan?.name) || "";
}

function sortDailyPlans(plans) {
  const hasManualOrder = plans.some((plan) => Number.isFinite(Number(plan.displayOrder)));
  return [...plans].sort((first, second) => {
    if (hasManualOrder) {
      const firstOrder = Number.isFinite(Number(first.displayOrder)) ? Number(first.displayOrder) : 999;
      const secondOrder = Number.isFinite(Number(second.displayOrder)) ? Number(second.displayOrder) : 999;
      if (firstOrder !== secondOrder) return firstOrder - secondOrder;
    }

    const firstKey = `${first.broadcastDate || ""}-${first.updatedAt || ""}`;
    const secondKey = `${second.broadcastDate || ""}-${second.updatedAt || ""}`;
    return secondKey.localeCompare(firstKey);
  });
}

function normalizeDailyPlanOrder(plans) {
  return plans.map((plan, index) => ({ ...plan, displayOrder: index }));
}

function sortDailyPlansByDate(plans) {
  return [...plans].sort((first, second) => {
    const firstKey = `${first.broadcastDate || ""}-${first.updatedAt || ""}`;
    const secondKey = `${second.broadcastDate || ""}-${second.updatedAt || ""}`;
    return secondKey.localeCompare(firstKey);
  });
}

function getDailyPlanList(plans = dailyPlans) {
  return sortDailyPlans(plans.filter(Boolean));
}

function getDailyPlanKey(plan) {
  return plan?.fileId || `${plan?.broadcastDate || ""}|${plan?.updatedAt || ""}|${plan?.name || ""}`;
}

function selectDailyPlan(plans = dailyPlans) {
  return getDailyPlanList(plans)[0] || null;
}

function setDailyPlanViewToSelected() {
  const sortedPlans = getDailyPlanList();
  dailyPlanViewIndex = 0;
  dailyPlan = sortedPlans[dailyPlanViewIndex] || null;
}

function updateDailyPlanList(nextPlan) {
  const previousPlans = getDailyPlanList();
  const mergedPlans = [
    nextPlan,
    ...previousPlans.filter((plan) => getDailyPlanKey(plan) !== getDailyPlanKey(nextPlan)),
  ];
  return normalizeDailyPlanOrder(mergedPlans);
}

async function deleteDailyPlanFile(plan) {
  if (!plan?.fileId || !plan?.partCount) return;

  for (let partIndex = 0; partIndex < plan.partCount; partIndex += 1) {
    try {
      await fetch(`${dailyPlanFileEndpoint}?id=${encodeURIComponent(plan.fileId)}&part=${partIndex}`, {
        method: "DELETE",
        headers: { "X-Admin-Key": adminPassword },
      });
    } catch (error) {
      console.warn("Daily plan delete failed", error);
    }
  }
}

async function uploadDailyPlanFile(file) {
  const fileId =
    window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const partCount = Math.ceil(file.size / dailyPlanChunkSize);
  let uploadedParts = 0;
  setDailyPlanUploadProgress(0, partCount, "업로드 중");

  async function uploadPart(partIndex) {
    const start = partIndex * dailyPlanChunkSize;
    const chunk = file.slice(start, Math.min(start + dailyPlanChunkSize, file.size));
    const response = await fetch(`${dailyPlanFileEndpoint}?id=${encodeURIComponent(fileId)}&part=${partIndex}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Admin-Key": adminPassword,
        "X-File-Name": encodeURIComponent(file.name),
        "X-File-Type": file.type || "application/octet-stream",
        "X-Part-Count": String(partCount),
      },
      body: chunk,
    });

    if (!response.ok) {
      throw new Error(`Daily plan upload failed with ${response.status}`);
    }

    uploadedParts += 1;
    setDailyPlanUploadProgress(uploadedParts, partCount, "업로드 중");
  }

  let nextPartIndex = 0;
  const workers = Array.from({ length: Math.min(dailyPlanUploadConcurrency, partCount) }, async () => {
    while (nextPartIndex < partCount) {
      const partIndex = nextPartIndex;
      nextPartIndex += 1;
      await uploadPart(partIndex);
    }
  });

  await Promise.all(workers);

  setDailyPlanUploadProgress(partCount, partCount, "서버 저장 완료");

  return {
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    fileId,
    partCount,
    broadcastDate: getBroadcastDateKey(new Date(), "upload"),
    fileDateLabel: getDailyPlanFileDateLabel(file.name),
    updatedAt: new Date().toISOString(),
  };
}

async function getDailyPlanUrl() {
  if (dailyPlan.dataUrl) return dailyPlan.dataUrl;
  if (dailyPlanObjectUrls.has(dailyPlan.fileId)) return dailyPlanObjectUrls.get(dailyPlan.fileId);
  if (!dailyPlan.fileId || !dailyPlan.partCount) return "";

  const partIndexes = Array.from({ length: dailyPlan.partCount }, (_, index) => index);
  const chunks = await Promise.all(
    partIndexes.map(async (partIndex) => {
    const response = await fetch(
      `${dailyPlanFileEndpoint}?id=${encodeURIComponent(dailyPlan.fileId)}&part=${partIndex}`,
      { cache: "no-store" },
    );

    if (!response.ok) {
      throw new Error(`Daily plan download failed with ${response.status}`);
    }

      return response.blob();
    }),
  );

  const planUrl = URL.createObjectURL(new Blob(chunks, { type: dailyPlan.type || "application/octet-stream" }));
  dailyPlanObjectUrls.set(dailyPlan.fileId, planUrl);
  return planUrl;
}

async function renderDailyPlanPdf(planUrl, previewToken) {
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib) {
    const pdfViewUrl = `${planUrl}#toolbar=0&navpanes=0&scrollbar=1&view=FitH&zoom=page-width`;
    dailyPlanPreview.innerHTML = `<iframe src="${pdfViewUrl}" title="일일운영계획서"></iframe>`;
    return;
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    pdfjsLib.GlobalWorkerOptions.workerSrc ||
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  dailyPlanPreview.innerHTML = `
    <div class="daily-plan-file">
      <strong>${dailyPlan.name || "운영계획서 파일"}</strong>
      <span>모바일 화면에 맞춰 불러오는 중입니다.</span>
    </div>
  `;

  const pdf = await pdfjsLib.getDocument({ url: planUrl }).promise;
  if (previewToken !== dailyPlanPreviewToken) return;

  const pages = document.createElement("div");
  pages.className = "daily-plan-pdf-pages";
  dailyPlanPreview.innerHTML = "";
  dailyPlanPreview.appendChild(pages);

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    if (previewToken !== dailyPlanPreviewToken) return;

    const pageShell = document.createElement("div");
    pageShell.className = "daily-plan-pdf-page";
    pageShell.textContent = `${pageNumber}페이지 불러오는 중`;
    pages.appendChild(pageShell);

    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const availableWidth = Math.max(260, (dailyPlanPreview.clientWidth || Math.min(window.innerWidth - 24, 960)) - 18);
    const cssScale = availableWidth / viewport.width;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const renderViewport = page.getViewport({ scale: cssScale * pixelRatio });

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(renderViewport.width);
    canvas.height = Math.floor(renderViewport.height);
    canvas.style.width = `${Math.floor(viewport.width * cssScale)}px`;
    canvas.style.height = `${Math.floor(viewport.height * cssScale)}px`;

    const context = canvas.getContext("2d");
    await page.render({ canvasContext: context, viewport: renderViewport }).promise;
    if (previewToken !== dailyPlanPreviewToken) return;

    pageShell.textContent = "";
    pageShell.appendChild(canvas);
  }
}

function renderDailyPlanPreview() {
  const previewToken = (dailyPlanPreviewToken += 1);
  const sortedPlans = getDailyPlanList();
  dailyPlanViewIndex = Math.min(Math.max(dailyPlanViewIndex, 0), Math.max(sortedPlans.length - 1, 0));
  dailyPlan = sortedPlans[dailyPlanViewIndex] || null;
  if (!dailyPlan) return false;

  const fileDateLabel = getDailyPlanDateLabel(dailyPlan);
  const planDateLabel = fileDateLabel
    ? `${fileDateLabel} 방송`
    : dailyPlan.broadcastDate
      ? `${dailyPlan.broadcastDate} 방송`
      : "오늘의 운영계획서";
  dailyPlanTitle.textContent = `${planDateLabel}`;
  dailyPlanDownload.removeAttribute("href");
  dailyPlanDownload.download = dailyPlan.name || "daily-plan";
  dailyPlanDownload.setAttribute("aria-disabled", "true");
  if (dailyPlanCounter) {
    dailyPlanCounter.textContent = `${dailyPlanViewIndex + 1} / ${sortedPlans.length}`;
  }
  prevDailyPlan.disabled = dailyPlanViewIndex >= sortedPlans.length - 1;
  nextDailyPlan.disabled = dailyPlanViewIndex <= 0;
  dailyPlanPreview.innerHTML = `
    <div class="daily-plan-file">
      <strong>${dailyPlan.name || "운영계획서 파일"}</strong>
      <span>파일을 빠르게 불러오는 중입니다.</span>
    </div>
  `;

  getDailyPlanUrl()
    .then((planUrl) => {
      dailyPlanDownload.href = planUrl;
      dailyPlanDownload.setAttribute("aria-disabled", "false");

      if (dailyPlan.type?.startsWith("image/")) {
        if (previewToken !== dailyPlanPreviewToken) return;
        dailyPlanPreview.innerHTML = `<img src="${planUrl}" alt="일일운영계획서" />`;
      } else if (dailyPlan.type === "application/pdf") {
        renderDailyPlanPdf(planUrl, previewToken).catch(() => {
          if (previewToken !== dailyPlanPreviewToken) return;
          dailyPlanPreview.innerHTML = `
            <div class="daily-plan-file">
              <strong>${dailyPlan.name || "운영계획서 파일"}</strong>
              <span>PDF를 불러오지 못했습니다. 파일 열기로 확인해주세요.</span>
            </div>
          `;
        });
      } else {
        if (previewToken !== dailyPlanPreviewToken) return;
        dailyPlanPreview.innerHTML = `
          <div class="daily-plan-file">
            <strong>${dailyPlan.name || "운영계획서 파일"}</strong>
            <span>이 파일은 팝업 안에서 미리보기 대신 파일 열기로 확인해주세요.</span>
          </div>
        `;
      }
    })
    .catch(() => {
      dailyPlanPreview.innerHTML = `
        <div class="daily-plan-file">
          <strong>${dailyPlan.name || "운영계획서 파일"}</strong>
          <span>운영계획서를 불러오지 못했습니다. 잠시 후 다시 열어주세요.</span>
        </div>
      `;
    });

  return true;
}

function removeDailyPlan(planToRemove) {
  const sortedPlans = getDailyPlanList();
  const removeKey = getDailyPlanKey(planToRemove);
  dailyPlans = normalizeDailyPlanOrder(sortedPlans.filter((plan) => getDailyPlanKey(plan) !== removeKey));
  dailyPlanViewIndex = Math.min(dailyPlanViewIndex, Math.max(dailyPlans.length - 1, 0));
  dailyPlan = getDailyPlanList()[dailyPlanViewIndex] || null;
  saveStoredData("hrDailyPlans", dailyPlans);
  saveStoredData("hrDailyPlan", dailyPlan);

  if (planToRemove.fileId && dailyPlanObjectUrls.has(planToRemove.fileId)) {
    URL.revokeObjectURL(dailyPlanObjectUrls.get(planToRemove.fileId));
    dailyPlanObjectUrls.delete(planToRemove.fileId);
  }

  deleteDailyPlanFile(planToRemove);
  saveRemoteData();
}

function saveDailyPlanOrder(nextPlans) {
  dailyPlans = normalizeDailyPlanOrder(nextPlans);
  dailyPlanViewIndex = Math.min(dailyPlanViewIndex, Math.max(dailyPlans.length - 1, 0));
  dailyPlan = getDailyPlanList()[dailyPlanViewIndex] || null;
  saveStoredData("hrDailyPlans", dailyPlans);
  saveStoredData("hrDailyPlan", dailyPlan);
  saveRemoteData();
}

function renderDailyPlanList() {
  const sortedPlans = getDailyPlanList();

  if (sortedPlans.length === 0) {
    dailyPlanList.innerHTML = '<div class="empty-state">등록된 운영계획서가 없습니다.</div>';
    return;
  }

  dailyPlanList.innerHTML = "";
  sortedPlans.forEach((plan, index) => {
    const item = document.createElement("div");
    item.className = "daily-plan-list-item";
    if (getDailyPlanKey(plan) === getDailyPlanKey(dailyPlan)) {
      item.classList.add("active");
    }
    const listDateLabel = getDailyPlanDateLabel(plan) || plan.broadcastDate || "방송일 미지정";
    item.innerHTML = `
      <div>
        <strong>${listDateLabel}</strong>
        <span>${plan.name || "운영계획서 파일"}</span>
      </div>
      <div class="daily-plan-list-actions">
        <button class="icon-button" type="button" data-action="up" ${index === 0 ? "disabled" : ""} aria-label="위로">
          <span aria-hidden="true">↑</span>
        </button>
        <button class="icon-button" type="button" data-action="down" ${
          index === sortedPlans.length - 1 ? "disabled" : ""
        } aria-label="아래로">
          <span aria-hidden="true">↓</span>
        </button>
        <button class="secondary-button" type="button" data-action="view">보기</button>
        <button class="danger-button" type="button" data-action="delete">삭제</button>
      </div>
    `;

    item.querySelector('[data-action="up"]')?.addEventListener("click", () => {
      const nextPlans = [...sortedPlans];
      [nextPlans[index - 1], nextPlans[index]] = [nextPlans[index], nextPlans[index - 1]];
      saveDailyPlanOrder(nextPlans);
      renderDailyPlanList();
      renderDailyPlanPreview();
    });

    item.querySelector('[data-action="down"]')?.addEventListener("click", () => {
      const nextPlans = [...sortedPlans];
      [nextPlans[index], nextPlans[index + 1]] = [nextPlans[index + 1], nextPlans[index]];
      saveDailyPlanOrder(nextPlans);
      renderDailyPlanList();
      renderDailyPlanPreview();
    });

    item.querySelector('[data-action="view"]')?.addEventListener("click", () => {
      dailyPlanViewIndex = index;
      dailyPlan = sortedPlans[index];
      if (dailyPlanListDialog.open) dailyPlanListDialog.close();
      openDailyPlanDialog(true);
    });

    item.querySelector('[data-action="delete"]')?.addEventListener("click", () => {
      const confirmDelete = window.confirm(`${plan.broadcastDate || ""} 운영계획서를 삭제할까요?`);
      if (!confirmDelete) return;

      removeDailyPlan(plan);
      dailyPlanViewIndex = Math.min(dailyPlanViewIndex, Math.max(dailyPlans.length - 1, 0));
      renderDailyPlanList();
      if (dailyPlanDialog.open) {
        const deletedOpenPlan = getDailyPlanKey(dailyPlan) === getDailyPlanKey(plan);
        if (dailyPlan && !deletedOpenPlan) {
          renderDailyPlanPreview();
        } else {
          dailyPlanDialog.close();
        }
      }
      alert("운영계획서를 삭제했습니다.");
    });

    dailyPlanList.appendChild(item);
  });
}

function openDailyPlanDialog(force = false) {
  if (!dailyPlan || !renderDailyPlanPreview()) return false;

  const planStamp = dailyPlan.updatedAt || dailyPlan.name || "";
  if (!force && lastShownDailyPlanStamp === planStamp) return false;
  lastShownDailyPlanStamp = planStamp;
  if (dailyPlanDialog.open) return true;

  if (typeof dailyPlanDialog.showModal === "function") {
    dailyPlanDialog.showModal();
  } else {
    dailyPlanDialog.setAttribute("open", "");
  }
  return true;
}

function showDailyPlanOnHome() {
  if (!dailyPlanFeatureEnabled) return;
  if (activePage === "home" && !dailyPlanAutoShown && !dailyPlanDialog.open && !dailyPlanListDialog.open) {
    window.setTimeout(() => {
      setDailyPlanViewToSelected();
      dailyPlanAutoShown = openDailyPlanDialog(false);
    }, 120);
  }
}

function resetPullRefreshIndicator() {
  pullRefreshDistance = 0;
  isPullRefreshActive = false;
  document.body.classList.remove("pull-refresh-active", "pull-refresh-ready", "pull-refreshing");
  if (pullRefreshIndicator) {
    pullRefreshIndicator.style.transform = "";
    pullRefreshIndicator.textContent = "새로고침";
  }
}

function updatePullRefreshIndicator(distance) {
  const visibleDistance = Math.min(distance, 96);
  const isReady = distance >= 82;
  pullRefreshDistance = distance;
  document.body.classList.add("pull-refresh-active");
  document.body.classList.toggle("pull-refresh-ready", isReady);
  if (pullRefreshIndicator) {
    pullRefreshIndicator.style.transform = `translate(-50%, ${visibleDistance}px)`;
    pullRefreshIndicator.textContent = isReady ? "놓으면 새로고침" : "새로고침";
  }
}

function refreshHomePage() {
  if (isPullRefreshing) return;
  isPullRefreshing = true;
  document.body.classList.add("pull-refreshing");
  if (pullRefreshIndicator) {
    pullRefreshIndicator.style.transform = "translate(-50%, 88px)";
    pullRefreshIndicator.textContent = "새로고침 중";
  }
  window.setTimeout(() => window.location.reload(), 180);
}

function canStartPullRefresh() {
  return activePage === "home" && window.scrollY <= 0 && !dailyPlanDialog.open && !dailyPlanListDialog.open;
}

function scrollToCalendarToday() {
  window.setTimeout(() => {
    const todayCell = calendarGrid.querySelector(".calendar-day.today");
    const target = todayCell || document.querySelector(".calendar-page.main");
    if (!target) return;

    const rect = target.getBoundingClientRect();
    const nextTop = window.scrollY + rect.top - window.innerHeight / 2 + rect.height / 2;
    window.scrollTo({ top: Math.max(0, nextTop), behavior: "auto" });
  }, 0);
}

function scrollToRosterToday() {
  window.setTimeout(() => {
    const todayKey = toDateKey(today);
    const todayHeader = rosterTableHead.querySelector(`th[data-date="${todayKey}"]`);
    const tableWrap = document.querySelector(".roster-table-wrap");

    document.querySelector(".roster-page")?.scrollIntoView({ block: "start", behavior: "auto" });

    if (!todayHeader || !tableWrap) return;

    const headerLeft = todayHeader.offsetLeft;
    const centeredLeft = headerLeft - tableWrap.clientWidth / 2 + todayHeader.offsetWidth / 2;
    tableWrap.scrollLeft = Math.max(0, centeredLeft);
  }, 0);
}

function openCalendarToday() {
  setActivePage("calendar");
  currentDate = new Date(today.getFullYear(), today.getMonth(), 1);
  selectedDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  dateInput.value = toDateKey(selectedDate);
  render();
  scrollToCalendarToday();
  loadRemoteData().then(scrollToCalendarToday);
}

function loadStoredData(key, fallback) {
  try {
    const storedValue = localStorage.getItem(key);
    return storedValue ? JSON.parse(storedValue) : fallback;
  } catch {
    return fallback;
  }
}

function saveStoredData(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn("Local save failed", error);
  }

  if (!isApplyingRemoteData && sharedStorageKeys.has(key)) {
    queueRemoteSave();
  }
}

function getSharedDataPayload() {
  return {
    employees,
    events,
    shiftOverrides,
    importedRosterOnly,
    importedRosterYear,
    lastImportedMonths: loadStoredData("hrLastImportedMonths", []),
    dailyPlan: selectDailyPlan(),
    dailyPlans: sortDailyPlans(dailyPlans),
    updatedAt: new Date().toISOString(),
  };
}

function applySharedDataPayload(payload) {
  if (!payload || typeof payload !== "object") return false;

  const hasSharedData =
    Array.isArray(payload.employees) ||
    Array.isArray(payload.events) ||
    (payload.shiftOverrides && typeof payload.shiftOverrides === "object") ||
    typeof payload.importedRosterOnly === "boolean" ||
    payload.importedRosterYear !== undefined ||
    payload.dailyPlan !== undefined ||
    Array.isArray(payload.dailyPlans);

  if (!hasSharedData) return false;

  isApplyingRemoteData = true;

  if (Array.isArray(payload.employees)) {
    employees = normalizeEmployees(payload.employees);
    saveStoredData("hrEmployees", employees);
  }

  if (Array.isArray(payload.events)) {
    events = payload.events;
    saveStoredData("hrEvents", events);
  }

  if (payload.shiftOverrides && typeof payload.shiftOverrides === "object" && !Array.isArray(payload.shiftOverrides)) {
    shiftOverrides = payload.shiftOverrides;
    saveStoredData("hrShiftOverrides", shiftOverrides);
  }

  if (typeof payload.importedRosterOnly === "boolean") {
    importedRosterOnly = payload.importedRosterOnly;
    saveStoredData("hrImportedRosterOnly", importedRosterOnly);
  }

  if (payload.importedRosterYear === null || Number.isFinite(Number(payload.importedRosterYear))) {
    importedRosterYear = payload.importedRosterYear === null ? null : Number(payload.importedRosterYear);
    saveStoredData("hrImportedRosterYear", importedRosterYear);
  }

  if (Array.isArray(payload.lastImportedMonths)) {
    saveStoredData("hrLastImportedMonths", payload.lastImportedMonths);
  }

  if (Array.isArray(payload.dailyPlans)) {
    dailyPlans = sortDailyPlans(payload.dailyPlans.filter(Boolean));
    setDailyPlanViewToSelected();
    saveStoredData("hrDailyPlans", dailyPlans);
    saveStoredData("hrDailyPlan", dailyPlan);
  } else if (
    payload.dailyPlan === null ||
    (payload.dailyPlan && typeof payload.dailyPlan === "object" && !Array.isArray(payload.dailyPlan))
  ) {
    dailyPlans = payload.dailyPlan ? [payload.dailyPlan] : [];
    setDailyPlanViewToSelected();
    saveStoredData("hrDailyPlans", dailyPlans);
    saveStoredData("hrDailyPlan", dailyPlan);
  }

  isApplyingRemoteData = false;
  render();
  if (!rosterDialog.hidden) {
    renderRosterEditor();
    scrollToRosterToday();
  }
  showDailyPlanOnHome();
  return true;
}

function queueRemoteSave() {
  window.clearTimeout(remoteSaveTimer);
  remoteSaveTimer = window.setTimeout(saveRemoteData, 100);
}

async function saveRemoteData() {
  window.clearTimeout(remoteSaveTimer);
  remoteSaveTimer = null;

  try {
    const response = await fetch(remoteDataEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Key": adminPassword },
      body: JSON.stringify(getSharedDataPayload()),
    });

    if (!response.ok) {
      throw new Error(`Remote save failed with ${response.status}`);
    }
    return true;
  } catch (error) {
    console.warn("Remote save failed", error);
    return false;
  }
}

function saveRemoteDataInBackground(failureMessage = "서버 저장에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 저장해주세요.") {
  saveRemoteData().then((savedRemote) => {
    if (!savedRemote) {
      alert(failureMessage);
    }
  });
}

async function loadRemoteData() {
  try {
    const response = await fetch(remoteDataEndpoint, { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    applySharedDataPayload(payload);
  } catch (error) {
    console.warn("Remote load failed", error);
  }
}

function populateShiftSettings() {
  const dateKey = toDateKey(selectedDate);
  const shiftAssignments = getShiftAssignments(selectedDate);
  const dayEventsForDate = getEventsForDate(dateKey);
  const vacationEmployeeIds = new Set(dayEventsForDate.map((event) => event.employeeId));

  shiftDialogTitle.textContent = fullDateFormatter.format(selectedDate);
  shiftSettingsDate.value = dateKey;
  shiftSettingsRows.innerHTML = shiftAssignments
    .map(
      (assignment) =>
        `<label class="shift-settings-row">
          <span>${assignment.position}</span>
          <select data-position="${assignment.position}">
            ${employees
              .map(
                (employee) =>
                  `<option value="${employee.id}" ${employee.id === assignment.employee?.id ? "selected" : ""}>
                    ${employee.name}${vacationEmployeeIds.has(employee.id) ? " · 휴가" : ""}
                  </option>`,
              )
              .join("")}
          </select>
        </label>`,
      )
    .join("");
}

function openShiftSettings() {
  if (!requireAdmin()) return;
  populateShiftSettings();
  if (typeof shiftDialog.showModal === "function") {
    shiftDialog.showModal();
  } else {
    shiftDialog.setAttribute("open", "");
  }
}

function getDaysInMonth(date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const days = [];
  const lastDate = new Date(year, month + 1, 0).getDate();

  for (let day = 1; day <= lastDate; day += 1) {
    days.push(new Date(year, month, day));
  }

  return days;
}

function buildEmployeeOptions(selectedEmployeeId, vacationEmployeeIds = new Set()) {
  const blankOption = `<option value="" ${selectedEmployeeId ? "" : "selected"}>미지정</option>`;
  const optionEmployees = employees.filter((employee) => isEmployeeActive(employee) || employee.id === selectedEmployeeId);
  return (
    blankOption +
    optionEmployees
    .map(
      (employee) =>
        `<option value="${employee.id}" ${employee.id === selectedEmployeeId ? "selected" : ""}>
          ${employee.name}${employee.exitDate ? " · 퇴사" : ""}${vacationEmployeeIds.has(employee.id) ? " · 휴가" : ""}
        </option>`,
    )
      .join("")
  );
}

function renderRosterEditor() {
  rosterDialogTitle.textContent = formatter.format(rosterEditDate);
  const monthDays = getDaysInMonth(rosterEditDate);
  const rosterRows = [
    { label: "첫방", weekdayPosition: "첫방", weekendPosition: "첫방" },
    { label: "둘방", weekdayPosition: "둘방", weekendPosition: "둘방" },
    { label: "오전상근", weekdayPosition: "오전상근", weekendPosition: null },
    { label: "티컴/주말상근", weekdayPosition: "티컴", weekendPosition: "주말상근" },
    { label: "오후상근", weekdayPosition: "오후상근", weekendPosition: null },
    { label: "막전", weekdayPosition: "막전", weekendPosition: "막전" },
    { label: "막방", weekdayPosition: "막방", weekendPosition: "막방" },
  ];

  rosterTableHead.innerHTML = `
    <tr>
      <th>구분</th>
      ${monthDays
        .map((date) => {
          const dateKey = toDateKey(date);
          const holidayName = holidays[dateKey];
          const isToday = dateKey === toDateKey(today);
          return `<th data-date="${dateKey}" class="${[holidayName ? "holiday-column" : "", isToday ? "today-column" : ""]
            .filter(Boolean)
            .join(" ")}">
            <span>${date.getDate()}일</span>
            <small>${["일", "월", "화", "수", "목", "금", "토"][date.getDay()]}</small>
            ${holidayName ? `<em>${holidayName}</em>` : ""}
          </th>`;
        })
        .join("")}
    </tr>
  `;
  rosterTableBody.innerHTML = "";

  rosterRows.forEach((rosterRow) => {
    const row = document.createElement("tr");

    const labelCell = document.createElement("th");
    labelCell.scope = "row";
    labelCell.textContent = rosterRow.label;
    row.appendChild(labelCell);

    monthDays.forEach((date) => {
      const dateKey = toDateKey(date);
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      const holidayName = holidays[dateKey];
      const position = isWeekend ? rosterRow.weekendPosition : rosterRow.weekdayPosition;
      const cell = document.createElement("td");
      const isToday = dateKey === toDateKey(today);
      cell.dataset.date = dateKey;
      cell.className = [
        isWeekend ? "weekend-cell" : "",
        holidayName ? "holiday-cell" : "",
        isToday ? "today-cell" : "",
      ]
        .filter(Boolean)
        .join(" ");

      if (position) {
        const assignments = getShiftAssignments(date);
        const assignment = assignments.find((item) => item.position === position);
        const dayEventsForDate = events.filter((event) => event.date === dateKey);
        const vacationEmployeeIds = new Set(dayEventsForDate.map((event) => event.employeeId));
        cell.innerHTML = `
          <select data-date="${dateKey}" data-position="${position}" ${isAdmin ? "" : "disabled"}>
            ${buildEmployeeOptions(assignment?.employee?.id, vacationEmployeeIds)}
          </select>
        `;
      } else {
        cell.className = ["disabled-cell", isToday ? "today-cell" : ""].filter(Boolean).join(" ");
        cell.textContent = "-";
      }
      row.appendChild(cell);
    });

    rosterTableBody.appendChild(row);
  });
}

function openRosterEditor() {
  rosterEditDate = new Date(today.getFullYear(), today.getMonth(), 1);
  renderRosterEditor();
  setActivePage("roster");
  scrollToRosterToday();
}

function collectRosterEditorOverrides() {
  const nextOverrides = { ...shiftOverrides };
  rosterTableBody.querySelectorAll("select[data-date][data-position]").forEach((select) => {
    const nextDateOverrides = { ...(nextOverrides[select.dataset.date] || {}) };
    if (select.value) {
      nextDateOverrides[select.dataset.position] = select.value;
    } else {
      delete nextDateOverrides[select.dataset.position];
    }
    nextOverrides[select.dataset.date] = nextDateOverrides;
  });
  return nextOverrides;
}

function escapeExcelText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildAnnualRosterExcel(year) {
  const weekdayNames = ["일", "월", "화", "수", "목", "금", "토"];
  const rosterRows = [
    { code: "D1", weekdayPosition: "첫방", weekendPosition: "첫방" },
    { code: "D2", weekdayPosition: "둘방", weekendPosition: "둘방" },
    { code: "D3", weekdayPosition: "오전상근", weekendPosition: null },
    { code: "TC", weekdayPosition: "티컴", weekendPosition: "주말상근" },
    { code: "N3", weekdayPosition: "오후상근", weekendPosition: null },
    { code: "N1", weekdayPosition: "막전", weekendPosition: "막전" },
    { code: "N2", weekdayPosition: "막방", weekendPosition: "막방" },
  ];
  const dates = [];

  for (let month = 0; month < 12; month += 1) {
    const lastDate = new Date(year, month + 1, 0).getDate();

    for (let day = 1; day <= lastDate; day += 1) {
      dates.push(new Date(year, month, day));
    }
  }

  const blocks = [];
  for (let start = 0; start < dates.length; start += 28) {
    blocks.push(dates.slice(start, start + 28));
  }

  const blockTables = blocks
    .map((blockDates, blockIndex) => {
      const paddedDates = [...blockDates, ...Array.from({ length: 28 - blockDates.length }, () => null)];
      const startDate = blockDates[0];
      const endDate = blockDates[blockDates.length - 1];
      const title = `${blockIndex + 1}구간 (${toDateKey(startDate)} ~ ${toDateKey(endDate)})`;
      const weekdayRow = paddedDates
        .map((date) => `<th>${date ? weekdayNames[date.getDay()] : ""}</th>`)
        .join("");
      const dateRow = paddedDates
        .map((date) => {
          if (!date) return "<td></td>";
          const dateKey = toDateKey(date);
          return `<td>
            <span>${dateKey}</span>
            ${holidays[dateKey] ? `<small>${escapeExcelText(holidays[dateKey])}</small>` : ""}
          </td>`;
        })
        .join("");
      const assignmentRows = rosterRows
        .map((rosterRow) => {
          const cells = paddedDates
            .map((date) => {
              if (!date) return "<td></td>";
              const isWeekend = date.getDay() === 0 || date.getDay() === 6;
              const position = isWeekend ? rosterRow.weekendPosition : rosterRow.weekdayPosition;
              if (!position) return '<td class="off-cell"></td>';
              const assignment = getShiftAssignments(date).find((item) => item.position === position);
              return `<td>${escapeExcelText(assignment?.employee?.name || "")}</td>`;
            })
            .join("");

          return `<tr>
            <th></th>
            <th>${rosterRow.code}</th>
            ${cells}
          </tr>`;
        })
        .join("");

      return `
        <tr class="block-title">
          <th>${blockIndex + 1}</th>
          <th colspan="29">${escapeExcelText(title)}</th>
        </tr>
        <tr class="weekday-row">
          <th></th>
          <th></th>
          ${weekdayRow}
        </tr>
        <tr class="date-row">
          <th></th>
          <th></th>
          ${dateRow}
        </tr>
        ${assignmentRows}
        <tr class="spacer-row"><td colspan="30"></td></tr>
      `;
    })
    .join("");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: Malgun Gothic, Arial, sans-serif; }
      table { border-collapse: collapse; }
      th, td { border: 1px solid #999; padding: 6px 8px; white-space: nowrap; text-align: center; }
      th { background: #e8f1ef; font-weight: 700; }
      .title th { background: #146c68; color: #fff; font-size: 18px; text-align: left; }
      .block-title th { background: #dff0ed; text-align: left; }
      .weekday-row th { background: #f4f6f3; }
      .date-row td { background: #fbfcfb; font-size: 12px; }
      .date-row small { display: block; color: #d13d3d; font-size: 11px; }
      .off-cell { background: #f3f3f3; color: #aaa; }
      .spacer-row td { border: none; height: 12px; }
    </style>
  </head>
  <body>
    <table>
      <tr class="title"><th colspan="30">${year}년 연간 근무표</th></tr>
      ${blockTables}
    </table>
  </body>
</html>`;
}

function downloadAnnualRosterExcelFile() {
  const year = rosterEditDate.getFullYear();
  const workbookHtml = buildAnnualRosterExcel(year);
  const blob = new Blob(["\ufeff", workbookHtml], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `${year}년_연간근무표.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

window.__testBuildAnnualRosterExcel = buildAnnualRosterExcel;

function getEmployeeIdByName(name) {
  const normalizedName = String(name || "").trim();
  return employees.find((employee) => employee.name === normalizedName)?.id;
}

function getRosterPositionFromCode(code, date) {
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
  const positionMap = {
    D1: "첫방",
    D2: "둘방",
    D3: isWeekend ? null : "오전상근",
    TC: isWeekend ? "주말상근" : "티컴",
    N3: isWeekend ? null : "오후상근",
    N1: "막전",
    N2: "막방",
  };

  return positionMap[code] || null;
}

function extractCellText(cell) {
  return String(cell?.textContent || "").replace(/\s+/g, " ").trim();
}

function importAnnualRosterHtml(htmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, "text/html");
  const rows = [...doc.querySelectorAll("tr")];
  const nextOverrides = {};
  let importedCount = 0;
  const rosterCodes = new Set(["D1", "D2", "D3", "TC", "N3", "N1", "N2"]);
  const importedMonths = new Set();

  rows.forEach((row, rowIndex) => {
    const cells = [...row.children];
    const codeIndex = cells.findIndex((cell) => rosterCodes.has(extractCellText(cell)));
    const code = codeIndex >= 0 ? extractCellText(cells[codeIndex]) : "";

    if (!rosterCodes.has(code)) return;

    let dateRow = null;
    for (let scanIndex = rowIndex - 1; scanIndex >= 0; scanIndex -= 1) {
      const candidateCells = [...rows[scanIndex].children].map(extractCellText);
      if (candidateCells.some((value) => /^\d{4}-\d{2}-\d{2}/.test(value))) {
        dateRow = rows[scanIndex];
        break;
      }
      if (candidateCells.some((value) => /^[1-9]\d*구간/.test(value))) break;
    }

    if (!dateRow) return;

    const dateCells = expandDateCells([...dateRow.children].map(extractCellText));
    for (let cellIndex = codeIndex + 1; cellIndex < cells.length; cellIndex += 1) {
      const dateKey = dateCells[cellIndex];
      const employeeName = extractCellText(cells[cellIndex]);

      if (!dateKey || !employeeName) continue;

      const date = fromDateKey(dateKey);
      const position = getRosterPositionFromCode(code, date);
      const employeeId = getEmployeeIdByName(employeeName);

      if (!position || !employeeId) continue;

      nextOverrides[dateKey] = {
        ...(nextOverrides[dateKey] || {}),
        [position]: employeeId,
      };
      importedMonths.add(dateKey.slice(0, 7));
      importedCount += 1;
    }
  });

  shiftOverrides = nextOverrides;
  importedRosterOnly = true;
  importedRosterYear = importedMonths.size > 0 ? Number([...importedMonths][0].slice(0, 4)) : rosterEditDate.getFullYear();
  saveStoredData("hrShiftOverrides", shiftOverrides);
  saveStoredData("hrImportedRosterOnly", importedRosterOnly);
  saveStoredData("hrImportedRosterYear", importedRosterYear);
  saveStoredData("hrLastImportedMonths", [...importedMonths].sort());
  render();
  if (!rosterDialog.hidden) {
    renderRosterEditor();
  }

  return { importedCount, importedMonths: [...importedMonths].sort() };
}

function columnNameToIndex(cellRef) {
  const columnName = String(cellRef || "").match(/[A-Z]+/)?.[0] || "";
  return [...columnName].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function excelSerialToDateKey(serial) {
  const serialNumber = Number(serial);
  if (!Number.isFinite(serialNumber)) return null;

  const date = new Date(Date.UTC(1899, 11, 30) + Math.round(serialNumber) * 86400000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate(),
  ).padStart(2, "0")}`;
}

function parseDateKeyFromSheetValue(value, fallbackYear = rosterEditDate.getFullYear()) {
  const text = String(value || "").trim();
  const dateMatch = text.match(/\d{4}-\d{2}-\d{2}/);
  if (dateMatch) return dateMatch[0];
  const dottedDateMatch = text.match(/(\d{4})[./년\s-]+(\d{1,2})[./월\s-]+(\d{1,2})/);
  if (dottedDateMatch) {
    return `${dottedDateMatch[1]}-${String(Number(dottedDateMatch[2])).padStart(2, "0")}-${String(
      Number(dottedDateMatch[3]),
    ).padStart(2, "0")}`;
  }
  const shortDateMatch = text.match(/^(\d{1,2})[./](\d{1,2})$/);
  if (shortDateMatch) {
    return `${fallbackYear}-${String(Number(shortDateMatch[1])).padStart(2, "0")}-${String(
      Number(shortDateMatch[2]),
    ).padStart(2, "0")}`;
  }
  if (/^\d{5}(\.\d+)?$/.test(text)) return excelSerialToDateKey(text);
  return null;
}

function addDaysToDateKey(dateKey, dayOffset) {
  const date = fromDateKey(dateKey);
  date.setDate(date.getDate() + dayOffset);
  return toDateKey(date);
}

function expandDateCells(rawDateCells, fallbackYear = rosterEditDate.getFullYear()) {
  const dateCells = rawDateCells.map((value) => parseDateKeyFromSheetValue(value, fallbackYear));
  const knownIndexes = dateCells
    .map((dateKey, index) => (dateKey ? index : null))
    .filter((index) => index !== null);

  if (knownIndexes.length === 0) return dateCells;

  const anchorIndex = knownIndexes[0];
  const anchorDateKey = dateCells[anchorIndex];
  return dateCells.map((dateKey, index) => dateKey || addDaysToDateKey(anchorDateKey, index - anchorIndex));
}

async function inflateZipEntry(bytes, method) {
  if (method === 0) return bytes;
  if (method !== 8) throw new Error("Unsupported zip compression");

  const stream = new Blob([bytes]).stream();
  try {
    return new Uint8Array(await new Response(stream.pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
  } catch {
    return new Uint8Array(
      await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer(),
    );
  }
}

async function readZipEntries(arrayBuffer) {
  const data = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  let eocdOffset = -1;

  for (let offset = data.length - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }

  if (eocdOffset < 0) throw new Error("Invalid xlsx file");

  const entryCount = view.getUint16(eocdOffset + 10, true);
  let centralOffset = view.getUint32(eocdOffset + 16, true);
  const decoder = new TextDecoder();
  const entries = {};

  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (view.getUint32(centralOffset, true) !== 0x02014b50) break;

    const method = view.getUint16(centralOffset + 10, true);
    const compressedSize = view.getUint32(centralOffset + 20, true);
    const fileNameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const commentLength = view.getUint16(centralOffset + 32, true);
    const localOffset = view.getUint32(centralOffset + 42, true);
    const fileName = decoder.decode(data.slice(centralOffset + 46, centralOffset + 46 + fileNameLength));

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressedBytes = data.slice(dataStart, dataStart + compressedSize);
    entries[fileName] = await inflateZipEntry(compressedBytes, method);

    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function parseSharedStrings(xmlText) {
  if (!xmlText) return [];

  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  return [...doc.querySelectorAll("si")].map((item) => item.textContent || "");
}

function parseWorksheetMatrix(xmlText, sharedStrings) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const rows = [];

  doc.querySelectorAll("sheetData row").forEach((rowNode) => {
    const rowIndex = Number(rowNode.getAttribute("r")) - 1;
    rows[rowIndex] = rows[rowIndex] || [];

    rowNode.querySelectorAll("c").forEach((cellNode) => {
      const columnIndex = columnNameToIndex(cellNode.getAttribute("r"));
      const type = cellNode.getAttribute("t");
      const valueNode = cellNode.querySelector("v");
      const inlineText = cellNode.querySelector("is t")?.textContent;
      let value = valueNode?.textContent ?? inlineText ?? "";

      if (type === "s") {
        value = sharedStrings[Number(value)] || "";
      }

      rows[rowIndex][columnIndex] = value;
    });
  });

  return rows.map((row) => row || []);
}

async function importAnnualRosterXlsx(file) {
  const entries = await readZipEntries(await file.arrayBuffer());
  const decoder = new TextDecoder();
  const sharedStrings = parseSharedStrings(entries["xl/sharedStrings.xml"] ? decoder.decode(entries["xl/sharedStrings.xml"]) : "");
  const worksheetPaths = Object.keys(entries)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const nextOverrides = {};
  const rosterCodes = new Set(["D1", "D2", "D3", "TC", "N3", "N1", "N2"]);
  let importedCount = 0;
  const importedMonths = new Set();

  worksheetPaths.forEach((worksheetPath) => {
    const rows = parseWorksheetMatrix(decoder.decode(entries[worksheetPath]), sharedStrings);
    const dateRowsByIndex = new Map();

    rows.forEach((row, rowIndex) => {
      const dateCells = expandDateCells(row);
      if (dateCells.filter(Boolean).length >= 3) {
        dateRowsByIndex.set(rowIndex, dateCells);
      }
    });

    rows.forEach((row, rowIndex) => {
      const codeIndex = row.findIndex((value) => rosterCodes.has(String(value || "").trim()));
      if (codeIndex < 0) return;

      const code = String(row[codeIndex]).trim();
      let dateCells = null;
      for (let scanIndex = rowIndex - 1; scanIndex >= 0; scanIndex -= 1) {
        if (dateRowsByIndex.has(scanIndex)) {
          dateCells = dateRowsByIndex.get(scanIndex);
          break;
        }
      }

      if (!dateCells) return;

      for (let cellIndex = codeIndex + 1; cellIndex < row.length; cellIndex += 1) {
        const dateKey = dateCells[cellIndex];
        const employeeId = getEmployeeIdByName(row[cellIndex]);

        if (!dateKey || !employeeId) continue;

        const position = getRosterPositionFromCode(code, fromDateKey(dateKey));
        if (!position) continue;

        nextOverrides[dateKey] = {
          ...(nextOverrides[dateKey] || {}),
          [position]: employeeId,
        };
        importedMonths.add(dateKey.slice(0, 7));
        importedCount += 1;
      }
    });
  });

  shiftOverrides = nextOverrides;
  importedRosterOnly = true;
  importedRosterYear = importedMonths.size > 0 ? Number([...importedMonths][0].slice(0, 4)) : rosterEditDate.getFullYear();
  saveStoredData("hrShiftOverrides", shiftOverrides);
  saveStoredData("hrImportedRosterOnly", importedRosterOnly);
  saveStoredData("hrImportedRosterYear", importedRosterYear);
  saveStoredData("hrLastImportedMonths", [...importedMonths].sort());
  render();
  if (!rosterDialog.hidden) {
    renderRosterEditor();
  }

  return { importedCount, importedMonths: [...importedMonths].sort() };
}

function refreshShiftSettingsForDate(dateKey) {
  selectedDate = fromDateKey(dateKey);
  dateInput.value = dateKey;
  currentDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  populateShiftSettings();
  render();
  populateShiftSettings();
  window.setTimeout(populateShiftSettings, 0);
  if (!shiftDialog.open && typeof shiftDialog.showModal === "function") {
    shiftDialog.showModal();
  } else if (!shiftDialog.open) {
    shiftDialog.setAttribute("open", "");
  }
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function getEmployee(employeeId) {
  return employees.find((employee) => employee.id === employeeId);
}

function getFilteredEvents() {
  if (selectedEmployeeId === "all") {
    return events;
  }

  return events.filter((event) => event.employeeId === selectedEmployeeId);
}

function getEventsForDate(dateKey) {
  return getFilteredEvents().filter((event) => event.date === dateKey);
}

function getNextEmployeeId() {
  const maxNumber = employees.reduce((max, employee) => {
    const number = Number(String(employee.id).replace(/\D/g, ""));
    return Number.isFinite(number) ? Math.max(max, number) : max;
  }, 0);
  return `e${String(maxNumber + 1).padStart(2, "0")}`;
}

function sortEmployeesWithInactiveLast(employeeList) {
  return [...employeeList].sort((a, b) => {
    const activeScore = Number(isEmployeeActive(b)) - Number(isEmployeeActive(a));
    if (activeScore !== 0) return activeScore;
    const orderScore = (Number(a.order) || 0) - (Number(b.order) || 0);
    if (orderScore !== 0) return orderScore;
    return a.name.localeCompare(b.name, "ko");
  });
}

function normalizeEmployeeOrder() {
  const activeEmployees = sortEmployeesWithInactiveLast(employees.filter(isEmployeeActive));
  const inactiveEmployees = sortEmployeesWithInactiveLast(employees.filter((employee) => !isEmployeeActive(employee)));
  employees = [...activeEmployees, ...inactiveEmployees].map((employee, index) => ({
    ...employee,
    order: index,
  }));
}

function moveEmployeeOrder(employeeId, direction) {
  if (!requireAdmin("직원 순서 변경은 관리자만 사용할 수 있습니다.")) return;
  normalizeEmployeeOrder();
  const orderedEmployees = sortEmployeesWithInactiveLast(employees);
  const currentIndex = orderedEmployees.findIndex((employee) => employee.id === employeeId);
  if (currentIndex < 0) return;

  const currentEmployee = orderedEmployees[currentIndex];
  const targetIndex = currentIndex + direction;
  const targetEmployee = orderedEmployees[targetIndex];
  if (!targetEmployee || isEmployeeActive(currentEmployee) !== isEmployeeActive(targetEmployee)) return;

  const currentOrder = currentEmployee.order;
  currentEmployee.order = targetEmployee.order;
  targetEmployee.order = currentOrder;
  saveEmployees();
}

function getVacationVisibleEmployees() {
  const visibleEmployees = isAdmin ? employees : employees.filter(isEmployeeActive);
  return sortEmployeesWithInactiveLast(visibleEmployees);
}

function saveEmployees() {
  employees = normalizeEmployees(employees);
  normalizeEmployeeOrder();
  saveStoredData("hrEmployees", employees);
  render();
  if (employeeManageDialog?.open) {
    renderEmployeeManagement();
  }
  if (activePage === "vacation") {
    renderVacationPage();
  }
  saveRemoteDataInBackground("직원 정보는 이 기기에는 반영됐지만 서버 저장에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 저장해주세요.");
}

function getAnnualLeaveTotal(employee) {
  const annualLeaveTotal = Number(employee?.annualLeaveTotal);
  return Number.isFinite(annualLeaveTotal) ? annualLeaveTotal : defaultAnnualLeaveTotal;
}

function getEmployeeVacationEvents(employeeId, type) {
  return events
    .filter((event) => event.employeeId === employeeId && event.type === type && event.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function getHolidayWorkDates(employeeId) {
  const employee = getEmployee(employeeId);
  const removedDates = new Set(employee?.substituteEarnedRemovedDates || []);
  const earnedDates = new Map();

  Object.keys(holidays)
    .filter((dateKey) => {
      if (removedDates.has(dateKey)) return false;
      const workedEmployeeIds = new Set(
        getShiftAssignments(fromDateKey(dateKey))
          .map((assignment) => assignment.employee?.id)
          .filter(Boolean),
      );
      return workedEmployeeIds.has(employeeId);
    })
    .forEach((dateKey) => {
      earnedDates.set(dateKey, {
        date: dateKey,
        holidayName: holidays[dateKey],
        source: "roster",
      });
    });

  (employee?.substituteEarnedDates || []).forEach((dateKey) => {
    earnedDates.set(dateKey, {
      date: dateKey,
      holidayName: holidays[dateKey] || "공휴일",
      source: "manual",
    });
  });

  return Array.from(earnedDates.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function saveVacationEvents(nextEvents) {
  events = nextEvents;
  saveStoredData("hrEvents", events);
  render();
  saveRemoteDataInBackground("휴가 정보는 이 기기에는 반영됐지만 서버 저장에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 저장해주세요.");
}

function addVacationUse(employeeId, type, dateKey) {
  if (!requireAdmin("휴가 저장은 관리자만 사용할 수 있습니다.")) return;
  if (!employeeId || !dateKey) {
    alert("직원과 날짜를 확인해주세요.");
    return;
  }

  const isDuplicate = events.some((event) => event.employeeId === employeeId && event.type === type && event.date === dateKey);
  if (isDuplicate) {
    alert("이미 등록된 날짜입니다.");
    return;
  }

  saveVacationEvents([
    ...events,
    {
      id: Date.now() + Math.floor(Math.random() * 1000),
      employeeId,
      type,
      date: dateKey,
      memo: type === "annual" ? "휴가 메뉴 연차 등록" : "휴가 메뉴 대체휴무 등록",
    },
  ]);
}

function removeVacationUse(eventId) {
  if (!requireAdmin("휴가 삭제는 관리자만 사용할 수 있습니다.")) return;
  saveVacationEvents(events.filter((event) => String(event.id) !== String(eventId)));
}

function getHolidayOptionsForSelect(employee) {
  const earnedDates = new Set(getHolidayWorkDates(employee.id).map((workDate) => workDate.date));
  return Object.keys(holidays)
    .sort()
    .map((dateKey) => ({
      date: dateKey,
      name: holidays[dateKey],
      isAdded: earnedDates.has(dateKey),
    }));
}

function addSubstituteEarnedDate(employeeId, dateKey) {
  if (!requireAdmin("대체휴무 발생 날짜 추가는 관리자만 사용할 수 있습니다.")) return;
  const employee = getEmployee(employeeId);
  if (!employee || !dateKey) {
    alert("추가할 공휴일을 선택해주세요.");
    return;
  }

  const autoEarnedDates = new Set(
    Object.keys(holidays).filter((holidayKey) => {
      const workedEmployeeIds = new Set(
        getShiftAssignments(fromDateKey(holidayKey))
          .map((assignment) => assignment.employee?.id)
          .filter(Boolean),
      );
      return workedEmployeeIds.has(employeeId);
    }),
  );

  employee.substituteEarnedRemovedDates = normalizeDateList(employee.substituteEarnedRemovedDates).filter(
    (removedDate) => removedDate !== dateKey,
  );

  if (!autoEarnedDates.has(dateKey)) {
    employee.substituteEarnedDates = normalizeDateList([...(employee.substituteEarnedDates || []), dateKey]);
  }

  saveEmployees();
}

function removeSubstituteEarnedDate(employeeId, dateKey) {
  if (!requireAdmin("대체휴무 발생 날짜 삭제는 관리자만 사용할 수 있습니다.")) return;
  const employee = getEmployee(employeeId);
  if (!employee || !dateKey) return;

  employee.substituteEarnedDates = normalizeDateList(employee.substituteEarnedDates).filter((earnedDate) => earnedDate !== dateKey);
  employee.substituteEarnedRemovedDates = normalizeDateList([...(employee.substituteEarnedRemovedDates || []), dateKey]);
  events = events.filter(
    (event) => !(event.employeeId === employeeId && event.type === "substitute" && event.earnedDate === dateKey),
  );
  saveStoredData("hrEvents", events);
  saveEmployees();
}

function getSubstituteUsesByEarnedDate(employeeId) {
  const usesByEarnedDate = new Map();
  getEmployeeVacationEvents(employeeId, "substitute").forEach((event) => {
    if (event.earnedDate) {
      usesByEarnedDate.set(event.earnedDate, event);
    }
  });
  return usesByEarnedDate;
}

function saveSubstituteUse(employeeId, earnedDate, useDate) {
  if (!requireAdmin("대체휴무 저장은 관리자만 사용할 수 있습니다.")) return;
  if (!employeeId || !earnedDate || !useDate) {
    alert("대체휴무 발생 날짜와 사용 날짜를 확인해주세요.");
    return;
  }

  const existingEvent = events.find(
    (event) => event.employeeId === employeeId && event.type === "substitute" && event.earnedDate === earnedDate,
  );

  if (existingEvent) {
    saveVacationEvents(
      events.map((event) =>
        String(event.id) === String(existingEvent.id)
          ? {
              ...event,
              date: useDate,
              memo: `${earnedDate} 공휴일 근무 대체휴무`,
            }
          : event,
      ),
    );
    return;
  }

  saveVacationEvents([
    ...events,
    {
      id: Date.now() + Math.floor(Math.random() * 1000),
      employeeId,
      type: "substitute",
      date: useDate,
      earnedDate,
      memo: `${earnedDate} 공휴일 근무 대체휴무`,
    },
  ]);
}

function renderVacationDateList(items, options = {}) {
  const { emptyText = "등록된 날짜가 없습니다.", removable = false, showHoliday = false } = options;
  if (!items.length) {
    return `<p class="vacation-empty">${emptyText}</p>`;
  }

  return `
    <div class="vacation-date-list">
      ${items
        .map((item) => {
          const dateKey = typeof item === "string" ? item : item.date;
          const label = showHoliday && item.holidayName ? `${dateKey} · ${item.holidayName}` : dateKey;
          const removeButton =
            removable && isAdmin
              ? `<button class="vacation-date-remove admin-only" type="button" data-remove-vacation="${item.id}">삭제</button>`
              : "";
          return `<span class="vacation-date-chip">${escapeExcelText(label)}${removeButton}</span>`;
        })
        .join("")}
    </div>
  `;
}

function renderSubstituteEarnedDateButtons(holidayWorks, substituteUsesByEarnedDate) {
  if (!holidayWorks.length) {
    return `<p class="vacation-empty">공휴일 근무 날짜가 없습니다.</p>`;
  }

  return `
    <div class="substitute-earned-list">
      ${holidayWorks
        .map((workDate) => {
          const usedEvent = substituteUsesByEarnedDate.get(workDate.date);
          const usedClass = usedEvent ? " used" : "";
          const buttonLabel = `${workDate.date} · ${workDate.holidayName}`;
          const usedText = usedEvent ? `<small>사용 ${escapeExcelText(usedEvent.date)}</small>` : "<small>미사용</small>";
          const dateInput = isAdmin
            ? `<input class="substitute-use-picker admin-only" type="date" value="${usedEvent?.date || ""}" data-earned-date="${workDate.date}" aria-label="${workDate.date} 대체휴무 사용 날짜" />`
            : "";

          return `
            <span class="substitute-earned-item${usedClass}">
              <button class="substitute-earned-button${usedClass}" type="button" data-earned-date="${workDate.date}">
                <span>${escapeExcelText(buttonLabel)}</span>
                ${usedText}
              </button>
              ${
                isAdmin
                  ? `<button class="substitute-earned-remove admin-only" type="button" data-remove-earned-date="${workDate.date}" aria-label="${workDate.date} 대체휴무 발생 삭제">삭제</button>`
                  : ""
              }
              ${dateInput}
            </span>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderVacationPage() {
  if (!vacationEmployeeButtons || !vacationDetail) return;

  const visibleEmployees = getVacationVisibleEmployees();
  if (
    !selectedVacationEmployeeId ||
    !visibleEmployees.some((employee) => employee.id === selectedVacationEmployeeId)
  ) {
    selectedVacationEmployeeId = visibleEmployees[0]?.id || "";
  }

  vacationEmployeeButtons.innerHTML = "";
  visibleEmployees.forEach((employee) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `vacation-employee-button${employee.id === selectedVacationEmployeeId ? " active" : ""}${
      isEmployeeActive(employee) ? "" : " inactive"
    }`;
    button.innerHTML = `
      <span class="avatar" style="background:${employee.color}">${escapeExcelText(employee.name.slice(0, 1))}</span>
      <span>
        <strong>${escapeExcelText(employee.name)}</strong>
        <small>${escapeExcelText(getEmployeeStatusText(employee))}</small>
      </span>
    `;
    button.addEventListener("click", () => {
      selectedVacationEmployeeId = employee.id;
      renderVacationPage();
    });
    vacationEmployeeButtons.appendChild(button);
  });

  const selectedEmployee = getEmployee(selectedVacationEmployeeId);
  if (!selectedEmployee) {
    vacationDetail.innerHTML = `<p class="vacation-empty">직원을 먼저 등록해주세요.</p>`;
    return;
  }

  const annualUses = getEmployeeVacationEvents(selectedEmployee.id, "annual");
  const holidayWorks = getHolidayWorkDates(selectedEmployee.id);
  const holidayOptions = getHolidayOptionsForSelect(selectedEmployee);
  const substituteUsesByEarnedDate = getSubstituteUsesByEarnedDate(selectedEmployee.id);
  const substituteUseCount = Array.from(substituteUsesByEarnedDate.keys()).filter((earnedDate) =>
    holidayWorks.some((workDate) => workDate.date === earnedDate),
  ).length;
  const annualTotal = getAnnualLeaveTotal(selectedEmployee);
  const annualRemaining = Math.max(annualTotal - annualUses.length, 0);
  const substituteRemaining = Math.max(holidayWorks.length - substituteUseCount, 0);

  vacationDetail.innerHTML = `
    <div class="vacation-detail-header">
      <div>
        <p class="eyebrow">직원별 휴가 현황</p>
        <h3>${escapeExcelText(selectedEmployee.name)}</h3>
        <span>${escapeExcelText(getEmployeeStatusText(selectedEmployee))}</span>
      </div>
    </div>

    <div class="vacation-stats">
      <div class="vacation-stat"><span>연차 총개수</span><strong>${annualTotal}</strong></div>
      <div class="vacation-stat"><span>연차 사용</span><strong>${annualUses.length}</strong></div>
      <div class="vacation-stat"><span>연차 남음</span><strong>${annualRemaining}</strong></div>
      <div class="vacation-stat"><span>대체휴무 발생</span><strong>${holidayWorks.length}</strong></div>
      <div class="vacation-stat"><span>대체휴무 사용</span><strong>${substituteUseCount}</strong></div>
      <div class="vacation-stat"><span>대체휴무 남음</span><strong>${substituteRemaining}</strong></div>
    </div>

    <div class="vacation-admin-tools admin-only">
      <label>
        연차 총개수
        <span>
          <input id="annualLeaveTotalInput" type="number" min="0" step="0.5" value="${annualTotal}" />
          <button id="saveAnnualLeaveTotal" class="secondary-button" type="button">저장</button>
        </span>
      </label>
      <label>
        연차 사용 날짜
        <span>
          <input id="annualUseDateInput" type="date" />
          <button id="addAnnualUse" class="primary-button" type="button">추가</button>
        </span>
      </label>
      <label>
        대체휴무 발생 공휴일
        <span>
          <select id="substituteEarnedHolidayInput">
            <option value="">공휴일 선택</option>
            ${holidayOptions
              .map(
                (holidayOption) =>
                  `<option value="${holidayOption.date}">${holidayOption.date} · ${escapeExcelText(holidayOption.name)}${
                    holidayOption.isAdded ? " · 추가됨" : ""
                  }</option>`,
              )
              .join("")}
          </select>
          <button id="addSubstituteEarnedDate" class="primary-button" type="button">발생일 추가</button>
        </span>
      </label>
    </div>

    <section class="vacation-section">
      <h4>연차 사용된 날짜</h4>
      ${renderVacationDateList(annualUses, { removable: true })}
    </section>

    <section class="vacation-section">
      <h4>대체휴무 발생 날짜</h4>
      ${renderSubstituteEarnedDateButtons(holidayWorks, substituteUsesByEarnedDate)}
    </section>
  `;

  vacationDetail.querySelector("#saveAnnualLeaveTotal")?.addEventListener("click", () => {
    if (!requireAdmin("연차 총개수 저장은 관리자만 사용할 수 있습니다.")) return;
    const nextTotal = Number(vacationDetail.querySelector("#annualLeaveTotalInput")?.value);
    selectedEmployee.annualLeaveTotal = Number.isFinite(nextTotal) ? nextTotal : defaultAnnualLeaveTotal;
    saveEmployees();
  });

  vacationDetail.querySelector("#addAnnualUse")?.addEventListener("click", () => {
    addVacationUse(selectedEmployee.id, "annual", vacationDetail.querySelector("#annualUseDateInput")?.value);
  });

  vacationDetail.querySelector("#addSubstituteEarnedDate")?.addEventListener("click", () => {
    addSubstituteEarnedDate(selectedEmployee.id, vacationDetail.querySelector("#substituteEarnedHolidayInput")?.value);
  });

  vacationDetail.querySelectorAll("[data-remove-vacation]").forEach((button) => {
    button.addEventListener("click", () => removeVacationUse(button.dataset.removeVacation));
  });

  vacationDetail.querySelectorAll("[data-remove-earned-date]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      removeSubstituteEarnedDate(selectedEmployee.id, button.dataset.removeEarnedDate);
    });
  });

  vacationDetail.querySelectorAll(".substitute-earned-button").forEach((button) => {
    button.addEventListener("click", () => {
      if (!requireAdmin("대체휴무 사용 날짜 지정은 관리자만 사용할 수 있습니다.")) return;
      const picker = vacationDetail.querySelector(`.substitute-use-picker[data-earned-date="${button.dataset.earnedDate}"]`);
      if (!picker) return;
      if (typeof picker.showPicker === "function") {
        picker.showPicker();
      } else {
        picker.focus();
        picker.click();
      }
    });
  });

  vacationDetail.querySelectorAll(".substitute-use-picker").forEach((input) => {
    input.addEventListener("change", () => {
      saveSubstituteUse(selectedEmployee.id, input.dataset.earnedDate, input.value);
    });
  });
}

function renderEmployeeManagement() {
  if (!employeeManageList) return;

  employeeManageList.innerHTML = "";
  sortEmployeesWithInactiveLast(employees).forEach((employee) => {
    const orderedEmployees = sortEmployeesWithInactiveLast(employees);
    const employeeIndex = orderedEmployees.findIndex((orderedEmployee) => orderedEmployee.id === employee.id);
    const prevEmployee = orderedEmployees[employeeIndex - 1];
    const nextEmployee = orderedEmployees[employeeIndex + 1];
    const canMoveUp = prevEmployee && isEmployeeActive(prevEmployee) === isEmployeeActive(employee);
    const canMoveDown = nextEmployee && isEmployeeActive(nextEmployee) === isEmployeeActive(employee);
    const item = document.createElement("div");
    item.className = `employee-manage-item${isEmployeeActive(employee) ? "" : " inactive"}`;
    item.innerHTML = `
      <div class="employee-manage-person">
        <span class="avatar" style="background:${employee.color}">${escapeExcelText(employee.name.slice(0, 1))}</span>
        <span>
          <strong>${escapeExcelText(employee.name)}</strong>
          <small>${escapeExcelText(employee.role)} · ${escapeExcelText(getEmployeeStatusText(employee))}</small>
        </span>
      </div>
      <div class="employee-manage-fields">
        <label>
          입사 날짜
          <input type="date" data-field="hireDate" value="${employee.hireDate || ""}" />
        </label>
        <label>
          퇴사 날짜
          <input type="date" data-field="exitDate" value="${employee.exitDate || ""}" />
        </label>
      </div>
      <div class="employee-manage-actions">
        <button class="secondary-button employee-order-button" type="button" data-action="up" ${canMoveUp ? "" : "disabled"}>위</button>
        <button class="secondary-button employee-order-button" type="button" data-action="down" ${canMoveDown ? "" : "disabled"}>아래</button>
        <button class="secondary-button" type="button" data-action="save">저장</button>
        <button class="danger-button" type="button" data-action="exit">퇴사 처리</button>
      </div>
    `;

    item.querySelector('[data-action="up"]')?.addEventListener("click", () => {
      moveEmployeeOrder(employee.id, -1);
    });

    item.querySelector('[data-action="down"]')?.addEventListener("click", () => {
      moveEmployeeOrder(employee.id, 1);
    });

    item.querySelector('[data-action="save"]')?.addEventListener("click", () => {
      employee.hireDate = item.querySelector('[data-field="hireDate"]')?.value || "";
      employee.exitDate = item.querySelector('[data-field="exitDate"]')?.value || "";
      saveEmployees();
    });

    item.querySelector('[data-action="exit"]')?.addEventListener("click", () => {
      employee.hireDate = item.querySelector('[data-field="hireDate"]')?.value || employee.hireDate || "";
      employee.exitDate = item.querySelector('[data-field="exitDate"]')?.value || toDateKey(new Date());
      saveEmployees();
    });

    employeeManageList.appendChild(item);
  });
}

function openEmployeeManagement() {
  if (!requireAdmin()) return;
  renderEmployeeManagement();
  if (typeof employeeManageDialog.showModal === "function") {
    employeeManageDialog.showModal();
  } else {
    employeeManageDialog.setAttribute("open", "");
  }
}

function addEmployee() {
  const name = newEmployeeName.value.trim();
  if (!name) {
    alert("입사 처리할 직원 이름을 입력해주세요.");
    return;
  }

  employees = [
    ...employees,
    {
      id: getNextEmployeeId(),
      name,
      role: "FD",
      color: employeeColors[employees.length % employeeColors.length],
      hireDate: newEmployeeHireDate.value || toDateKey(new Date()),
      exitDate: "",
      order: employees.length,
      annualLeaveTotal: defaultAnnualLeaveTotal,
    },
  ];
  newEmployeeName.value = "";
  newEmployeeHireDate.value = "";
  saveEmployees();
  alert("입사 처리했습니다.");
}

function renderEmployees() {
  employeeList.innerHTML = "";
  employeeInput.innerHTML = "";

  const activeEmployees = employees.filter(isEmployeeActive);
  const visibleEmployees = activeEmployees.length > 0 ? activeEmployees : employees;

  visibleEmployees.forEach((employee) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `employee-item ${selectedEmployeeId === employee.id ? "active" : ""}`;
    button.innerHTML = `
      <span class="avatar" style="background:${employee.color}">${employee.name.slice(0, 1)}</span>
      <span>
        <span class="employee-name">${employee.name}</span>
        <span class="employee-role">${employee.role}</span>
      </span>
      <span class="employee-count">${events.filter((event) => event.employeeId === employee.id).length}</span>
    `;
    button.addEventListener("click", () => {
      selectedEmployeeId = employee.id;
      render();
    });
    employeeList.appendChild(button);

    const option = document.createElement("option");
    option.value = employee.id;
    option.textContent = `${employee.name} · ${employee.role}`;
    employeeInput.appendChild(option);
  });
}

function renderCalendar() {
  calendarGrid.innerHTML = "";
  monthTitle.textContent = formatter.format(currentDate);

  const selectedEmployee = getEmployee(selectedEmployeeId);
  filterLabel.textContent = selectedEmployee ? `${selectedEmployee.name} 일정만 보기` : "전체 직원 일정";

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const startDate = new Date(year, month, 1 - startOffset);

  for (let i = 0; i < 42; i += 1) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);

    const dateKey = toDateKey(date);
    const dayEventsForDate = getEventsForDate(dateKey);
    const holidayName = holidays[dateKey];
    const shiftAssignments = getShiftAssignments(date);
    const day = document.createElement("article");
    const isCurrentMonth = date.getMonth() === month;
    const isToday = dateKey === toDateKey(today);
    const isSelected = dateKey === toDateKey(selectedDate);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;

    day.className = [
      "calendar-day",
      isCurrentMonth ? "" : "muted",
      isToday ? "today" : "",
      isSelected ? "selected" : "",
      holidayName ? "holiday" : "",
    ]
      .filter(Boolean)
      .join(" ");
    day.dataset.date = dateKey;

    const dayButton = document.createElement("button");
    dayButton.type = "button";
    dayButton.className = `day-button ${isWeekend ? "weekend" : ""}`;
    dayButton.innerHTML = `<span>${date.getDate()}</span><span>${holidayName || dayEventsForDate.length || ""}</span>`;
    dayButton.addEventListener("click", () => {
      selectedDate = date;
      dateInput.value = dateKey;
      render();
    });

    const eventList = document.createElement("div");
    eventList.className = "event-list";

    const shiftSummary = document.createElement("div");
    shiftSummary.className = "shift-summary";
    shiftSummary.innerHTML = `
      <div class="worker-strip">
        ${shiftAssignments
          .filter((assignment) => assignment.employee)
          .slice(0, 3)
          .map((assignment) => `<span class="worker-chip">${assignment.employee.name}</span>`)
          .join("")}
        ${
          shiftAssignments.filter((assignment) => assignment.employee).length > 3
            ? `<span class="worker-more">+${shiftAssignments.filter((assignment) => assignment.employee).length - 3}</span>`
            : ""
        }
      </div>
    `;
    eventList.appendChild(shiftSummary);

    dayEventsForDate.slice(0, 3).forEach((event) => {
      const employee = getEmployee(event.employeeId);
      const pill = eventTemplate.content.firstElementChild.cloneNode(true);
      pill.classList.add(event.type);
      pill.querySelector(".event-text").textContent = `${employee.name} ${eventTypes[event.type]}`;
      pill.addEventListener("click", () => {
        selectedDate = fromDateKey(event.date);
        render();
      });
      eventList.appendChild(pill);
    });

    const visibleEventCount = 3;
    if (dayEventsForDate.length > visibleEventCount) {
      const more = document.createElement("span");
      more.className = "more-events";
      more.textContent = `+${dayEventsForDate.length - visibleEventCount}개 더`;
      eventList.appendChild(more);
    }

    day.append(dayButton, eventList);
    calendarGrid.appendChild(day);
  }
}

function renderSelectedDay() {
  const dateKey = toDateKey(selectedDate);
  const dayEventsForDate = getEventsForDate(dateKey);
  const holidayName = holidays[dateKey];
  const shiftAssignments = getShiftAssignments(selectedDate);
  const vacationEmployeeIds = new Set(dayEventsForDate.map((event) => event.employeeId));

  selectedDateTitle.textContent = "근무자 명단";
  selectedDateBadge.textContent = holidayName
    ? `${fullDateFormatter.format(selectedDate)} · ${holidayName}`
    : fullDateFormatter.format(selectedDate);
  dayEvents.innerHTML = "";
  dayEvents.classList.remove("empty-state");

  const shift = document.createElement("div");
  shift.className = "day-event shift-detail";
  shift.innerHTML = `
    <div class="day-event-title">
      <span>
        <span class="event-dot shift-dot"></span>
        근무 편성
      </span>
      ${isAdmin ? '<button class="text-button shift-settings-button" type="button">설정</button>' : ""}
    </div>
    <div class="worker-list">
      ${shiftAssignments
        .filter((assignment) => assignment.employee)
        .map(
          (assignment) =>
            `<span class="worker-name"><b>${assignment.position}</b> ${assignment.employee.name}</span>`,
        )
        .join("")}
      ${
        shiftAssignments.some((assignment) => assignment.employee)
          ? ""
          : '<span class="empty-state">근무자가 지정되지 않았습니다.</span>'
      }
    </div>
  `;
  dayEvents.appendChild(shift);

  shift.querySelector(".shift-settings-button")?.addEventListener("click", openShiftSettings);

  if (dayEventsForDate.length === 0 && !holidayName) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "등록된 휴가 일정이 없습니다.";
    dayEvents.appendChild(empty);
    return;
  }

  dayEventsForDate.forEach((event) => {
    const employee = getEmployee(event.employeeId);
    const item = document.createElement("div");
    item.className = "day-event";
    item.innerHTML = `
      <div class="day-event-title">
        <span class="event-dot ${event.type}"></span>
        <span>${employee.name} · ${eventTypes[event.type]}</span>
      </div>
      <div class="day-event-meta">${employee.role} · ${event.memo || "메모 없음"}</div>
    `;
    dayEvents.appendChild(item);
  });
}

function renderStatus() {
  const todayKey = toDateKey(today);
  const todayEvents = events.filter((event) => event.date === todayKey);
  const todayShiftEmployees = getShiftAssignments(today)
    .map((assignment) => assignment.employee)
    .filter(Boolean);
  const todayShiftIds = new Set(todayShiftEmployees.map((employee) => employee.id));
  const awayTypes = new Set(["annual", "monthly", "substitute", "sick"]);
  const awayEmployees = new Set(
    todayEvents
      .filter((event) => awayTypes.has(event.type) && todayShiftIds.has(event.employeeId))
      .map((event) => event.employeeId),
  );

  todayLabel.textContent = fullDateFormatter.format(today);
  workingCount.textContent = todayShiftEmployees.length - awayEmployees.size;
  awayCount.textContent = awayEmployees.size;
  pendingCount.textContent = events.filter((event) => event.type === "annual").length;
}

function render() {
  renderEmployees();
  renderCalendar();
  renderSelectedDay();
  renderStatus();
  if (activePage === "vacation") {
    renderVacationPage();
  }
}

document.querySelector("#prevMonth").addEventListener("click", () => {
  currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
  render();
});

document.querySelector("#nextMonth").addEventListener("click", () => {
  currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
  render();
});

document.querySelector("#todayBtn").addEventListener("click", () => {
  currentDate = new Date(today.getFullYear(), today.getMonth(), 1);
  selectedDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  dateInput.value = toDateKey(selectedDate);
  render();
  scrollToCalendarToday();
});

document.querySelector("#showAllBtn").addEventListener("click", () => {
  selectedEmployeeId = "all";
  render();
});

document.querySelector("#newEventBtn").addEventListener("click", () => {
  if (!requireAdmin()) return;
  requestForm.classList.remove("collapsed");
  toggleRequestBtn.setAttribute("aria-expanded", "true");
  toggleRequestBtn.querySelector("span").textContent = "-";
  dateInput.focus();
});

toggleRequestBtn.addEventListener("click", () => {
  const isCollapsed = requestForm.classList.toggle("collapsed");
  toggleRequestBtn.setAttribute("aria-expanded", String(!isCollapsed));
  toggleRequestBtn.querySelector("span").textContent = isCollapsed ? "+" : "-";
});

closeShiftDialog.addEventListener("click", () => {
  shiftDialog.close();
});

cancelShiftSettings.addEventListener("click", () => {
  shiftDialog.close();
});

function handleShiftSettingsDateChange() {
  if (shiftSettingsDate.value) {
    refreshShiftSettingsForDate(shiftSettingsDate.value);
  }
}

shiftSettingsDate.addEventListener("change", handleShiftSettingsDateChange);
applyShiftDate.addEventListener("click", handleShiftSettingsDateChange);

shiftSettingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!requireAdmin()) return;

  const selectedKey = shiftSettingsDate.value || toDateKey(selectedDate);
  selectedDate = fromDateKey(selectedKey);
  dateInput.value = selectedKey;
  currentDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  const nextOverrides = {};
  shiftSettingsRows.querySelectorAll("select[data-position]").forEach((select) => {
    nextOverrides[select.dataset.position] = select.value;
  });

  shiftOverrides = {
    ...shiftOverrides,
    [selectedKey]: nextOverrides,
  };
  saveStoredData("hrShiftOverrides", shiftOverrides);
  shiftDialog.close();
  render();
  saveRemoteDataInBackground("근무자 설정은 이 기기에는 반영됐지만 서버 저장에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 저장해주세요.");
});

editRosterBtn.addEventListener("click", openRosterEditor);
homeLogoBtn.addEventListener("click", () => setActivePage("home"));
homeCalendarBtn.addEventListener("click", openCalendarToday);
homeRosterBtn.addEventListener("click", openRosterEditor);
homeVacationBtn.addEventListener("click", () => {
  setActivePage("vacation");
  loadRemoteData();
});
calendarPageBtn.addEventListener("click", openCalendarToday);
rosterPageBtn.addEventListener("click", openRosterEditor);
vacationPageBtn.addEventListener("click", () => {
  setActivePage("vacation");
  loadRemoteData();
});

closeRosterDialog.addEventListener("click", () => {
  setActivePage("calendar");
});

cancelRosterEdit.addEventListener("click", () => {
  setActivePage("calendar");
});

prevRosterMonth.addEventListener("click", () => {
  rosterEditDate = new Date(rosterEditDate.getFullYear(), rosterEditDate.getMonth() - 1, 1);
  renderRosterEditor();
});

nextRosterMonth.addEventListener("click", () => {
  rosterEditDate = new Date(rosterEditDate.getFullYear(), rosterEditDate.getMonth() + 1, 1);
  renderRosterEditor();
});

importAnnualRoster.addEventListener("change", async () => {
  if (!requireAdmin("엑셀 반영은 관리자만 사용할 수 있습니다.")) {
    importAnnualRoster.value = "";
    return;
  }

  const file = importAnnualRoster.files?.[0];
  if (!file) return;

  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!["xls", "xlsx", "html", "htm"].includes(extension)) {
    alert("앱에서 내려받은 .xls 파일이나 같은 양식의 .xlsx 파일을 선택해주세요.");
    importAnnualRoster.value = "";
    return;
  }

  try {
    const importResult =
      extension === "xlsx" ? await importAnnualRosterXlsx(file) : importAnnualRosterHtml(await file.text());
    const { importedCount, importedMonths } =
      typeof importResult === "number" ? { importedCount: importResult, importedMonths: [] } : importResult;

    if (importedCount === 0) {
      alert("반영할 근무표 데이터를 찾지 못했습니다. 앱에서 내려받은 4주 블록형 파일인지 확인해주세요.");
    } else {
      const monthSummary =
        importedMonths.length > 0 ? `\n반영 월: ${importedMonths[0]} ~ ${importedMonths[importedMonths.length - 1]}` : "";
      alert(`${importedCount}개 근무 칸을 반영했습니다.${monthSummary}`);
      saveRemoteDataInBackground("근무표는 이 기기에는 반영됐지만 서버 저장에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 저장해주세요.");
    }
  } catch (error) {
    alert("엑셀 파일을 읽는 중 문제가 발생했습니다.");
  } finally {
    importAnnualRoster.value = "";
  }
});

rosterForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!requireAdmin("근무표 저장은 관리자만 사용할 수 있습니다.")) return;

  shiftOverrides = collectRosterEditorOverrides();
  saveStoredData("hrShiftOverrides", shiftOverrides);
  currentDate = new Date(rosterEditDate);
  selectedDate = new Date(rosterEditDate);
  dateInput.value = toDateKey(selectedDate);
  setActivePage("calendar");
  render();
  alert("근무표를 저장했습니다.");
  saveRemoteDataInBackground("근무표는 이 기기에는 반영됐지만 서버 저장에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 저장해주세요.");
});

requestForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!requireAdmin()) return;

  events = [
    ...events,
    {
      id: Date.now(),
      employeeId: employeeInput.value,
      type: typeInput.value,
      date: dateInput.value,
      memo: memoInput.value.trim(),
    },
  ];
  saveStoredData("hrEvents", events);

  selectedDate = fromDateKey(dateInput.value);
  currentDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  memoInput.value = "";
  render();
  saveRemoteDataInBackground("휴가 신청은 이 기기에는 반영됐지만 서버 저장에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 저장해주세요.");
});

adminLoginBtn.addEventListener("click", () => {
  const password = window.prompt("관리자 비밀번호를 입력해주세요.");
  if (password === null) return;

  if (password === adminPassword) {
    setAdminMode(true);
    alert("관리자 모드로 전환했습니다.");
    return;
  }

  alert("비밀번호가 맞지 않습니다.");
});

adminLogoutBtn.addEventListener("click", () => {
  setAdminMode(false);
  alert("로그아웃했습니다.");
});

dailyPlanInput.addEventListener("change", async () => {
  if (!requireAdmin("일일운영계획서 등록은 관리자만 사용할 수 있습니다.")) {
    dailyPlanInput.value = "";
    return;
  }

  const file = dailyPlanInput.files?.[0];
  if (!file) return;

  if (file.size > dailyPlanMaxSize) {
    alert("운영계획서 파일은 60MB 이하로 올려주세요.");
    dailyPlanInput.value = "";
    return;
  }

  try {
    const uploadedPlan = await uploadDailyPlanFile(file);
    dailyPlans = updateDailyPlanList(uploadedPlan);
    const sortedPlans = getDailyPlanList();
    dailyPlanViewIndex = Math.max(0, sortedPlans.findIndex((plan) => plan.fileId === uploadedPlan.fileId));
    dailyPlan = sortedPlans[dailyPlanViewIndex] || null;
    saveStoredData("hrDailyPlan", dailyPlan);
    saveStoredData("hrDailyPlans", dailyPlans);
    setDailyPlanUploadProgress(1, 1, "목록 저장 중");
    const savedRemote = await saveRemoteData();
    if (!savedRemote) {
      throw new Error("Daily plan list save failed");
    }
    if (dailyPlanListDialog.open) {
      dailyPlanListDialog.close();
    }
    openDailyPlanDialog(true);
    hideDailyPlanUploadProgress();
    alert("일일운영계획서를 등록했습니다.");
  } catch (error) {
    setDailyPlanUploadProgress(0, 1, "업로드 실패");
    hideDailyPlanUploadProgress(1800);
    alert("운영계획서 파일을 읽는 중 문제가 발생했습니다.");
  } finally {
    dailyPlanInput.value = "";
  }
});

prevDailyPlan.addEventListener("click", () => {
  const sortedPlans = getDailyPlanList();
  if (dailyPlanViewIndex < sortedPlans.length - 1) {
    dailyPlanViewIndex += 1;
    renderDailyPlanPreview();
  }
});

nextDailyPlan.addEventListener("click", () => {
  if (dailyPlanViewIndex > 0) {
    dailyPlanViewIndex -= 1;
    renderDailyPlanPreview();
  }
});

dailyPlanListBtn.addEventListener("click", () => {
  if (!requireAdmin()) return;
  renderDailyPlanList();
  if (typeof dailyPlanListDialog.showModal === "function") {
    dailyPlanListDialog.showModal();
  } else {
    dailyPlanListDialog.setAttribute("open", "");
  }
});

employeeManageBtn.addEventListener("click", openEmployeeManagement);
addEmployeeBtn.addEventListener("click", addEmployee);
employeeManageForm.addEventListener("submit", (event) => event.preventDefault());
closeEmployeeManageDialog.addEventListener("click", () => {
  if (employeeManageDialog.open) {
    employeeManageDialog.close();
  } else {
    employeeManageDialog.removeAttribute("open");
  }
});

closeDailyPlanListDialog.addEventListener("click", () => {
  if (dailyPlanListDialog.open) {
    dailyPlanListDialog.close();
  } else {
    dailyPlanListDialog.removeAttribute("open");
  }
});

closeDailyPlanDialog.addEventListener("click", () => {
  if (dailyPlanDialog.open) {
    dailyPlanDialog.close();
  } else {
    dailyPlanDialog.removeAttribute("open");
  }
});

window.addEventListener(
  "touchstart",
  (event) => {
    if (!canStartPullRefresh() || event.touches.length !== 1 || isPullRefreshing) return;
    pullRefreshStartY = event.touches[0].clientY;
    isPullRefreshActive = true;
  },
  { passive: true },
);

window.addEventListener(
  "touchmove",
  (event) => {
    if (!isPullRefreshActive || event.touches.length !== 1) return;

    const distance = event.touches[0].clientY - pullRefreshStartY;
    if (distance <= 0) {
      resetPullRefreshIndicator();
      return;
    }

    if (!canStartPullRefresh()) {
      resetPullRefreshIndicator();
      return;
    }

    event.preventDefault();
    updatePullRefreshIndicator(distance * 0.55);
  },
  { passive: false },
);

window.addEventListener(
  "touchend",
  () => {
    if (!isPullRefreshActive) return;
    if (pullRefreshDistance >= 82) {
      refreshHomePage();
    } else {
      resetPullRefreshIndicator();
    }
  },
  { passive: true },
);

window.addEventListener("touchcancel", resetPullRefreshIndicator, { passive: true });

dateInput.value = toDateKey(selectedDate);
updateAdminUi();
render();
setActivePage("home");
loadRemoteData();

window.addEventListener("focus", loadRemoteData);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    loadRemoteData();
  }
});
