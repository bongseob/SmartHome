const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const baseUrl = process.env.M16_WEB_URL || "http://127.0.0.1:5174";
const username = process.env.M16_E2E_USERNAME || "admin";
const password = process.env.M16_E2E_PASSWORD || "admin1234";
const code = `m16-ui-e2e-${Date.now()}`;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const consoleErrors = [];
  const requestFailures = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push({ message: message.text(), location: message.location() });
    }
  });
  page.on("requestfailed", (request) => {
    requestFailures.push({ url: request.url(), error: request.failure()?.errorText || "unknown" });
  });

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByLabel("아이디").fill(username);
    await page.getByLabel("비밀번호").fill(password);
    await page.getByRole("button", { name: "로그인" }).click();
    await page.getByRole("button", { name: "기기 관리" }).waitFor();
    await page.getByRole("button", { name: "기기 관리" }).click();
    await page.getByRole("heading", { name: "기기 등록/설정" }).waitFor();

    const createPanel = page.locator(".device-admin__create");
    await createPanel.getByPlaceholder("code (소문자-하이픈, 예: living-light-01)").fill(code);
    await createPanel.getByPlaceholder("이름 (필수)").fill("M16 UI E2E Device");
    await createPanel.getByPlaceholder("deviceType").fill("temperature");
    await createPanel.getByPlaceholder("manufacturer").fill("Playwright");
    await createPanel.getByPlaceholder("model").fill("UI-E2E-1");
    await createPanel.getByPlaceholder("firmwareVersion").fill("1.0.0");
    await createPanel.locator("select").nth(0).selectOption("SENSOR");
    await createPanel.locator("select").nth(1).selectOption({ index: 1 });
    await createPanel.getByRole("button", { name: "기기 생성" }).click();

    let row = page.locator("tr", { hasText: code });
    await row.waitFor();
    const rowTextAfterCreate = await row.innerText();
    if (!rowTextAfterCreate.includes(`/living-room/${code}`)) {
      throw new Error(`generated mqtt_topic is missing from UI: ${rowTextAfterCreate}`);
    }

    await row.getByRole("button", { name: "수정" }).click();
    await row.locator("td").nth(0).locator("input").fill("M16 UI E2E Device Updated");
    await row.getByRole("button", { name: "저장", exact: true }).click();
    await row.getByText("M16 UI E2E Device Updated", { exact: true }).waitFor();

    row = page.locator("tr", { hasText: code });
    await row.getByRole("button", { name: "연결 설정" }).click();
    const connectionPanel = page.locator(".device-admin__connection-row .connection-fields");
    await connectionPanel.waitFor();
    await connectionPanel.locator("select").selectOption("MODBUS_TCP");
    await connectionPanel.getByPlaceholder("host").fill("192.0.2.20");
    await connectionPanel.getByPlaceholder("port").fill("502");
    await connectionPanel.getByPlaceholder("unitId (0-247)").fill("11");
    await connectionPanel.getByRole("button", { name: "연결 설정 저장" }).click();
    await row.getByText("MODBUS_TCP", { exact: true }).waitFor();

    page.once("dialog", (dialog) => dialog.accept());
    await row.getByRole("button", { name: "폐기" }).click();
    await row.getByText("DECOMMISSIONED", { exact: true }).waitFor();
    if (await row.getByRole("button", { name: "수정" }).isEnabled()) {
      throw new Error("edit button remained enabled after decommission");
    }

    console.log(JSON.stringify({
      ok: true,
      code,
      mqttTopic: `enterprise/site1/bldg-a/2f/living-room/${code}`,
      finalLifecycle: "DECOMMISSIONED",
      consoleErrors,
      requestFailures,
    }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
