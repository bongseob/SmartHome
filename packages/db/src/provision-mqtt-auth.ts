import { pbkdf2Sync, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, query } from "./pool.js";

/**
 * MQTT 브로커 인증 프로비저닝(PROJECT_RULES §5, CLAUDE.md "기기: MQTT ID/PW").
 *
 * 지금까지 개발 브로커는 allow_anonymous라 누구나 아무 토픽에나 붙을 수 있었다 — 감시장비
 * (ESP32 보드) 자격증명이 보드마다 분리돼 있지 않으면, 보드 하나가 뚫려도 계정을 개별
 * 폐기할 수 없고 ACL로 "이 보드는 자기 토픽만" 을 강제할 수도 없다. 그래서:
 *  - 보드(device_role='MONITORING_EQUIPMENT')마다 별도 계정을 발급하고, ACL로 그 보드
 *    자신의 state 토픽 + 그 보드에 딸린 채널(parent_device_id)의 토픽만 허용한다.
 *  - api/gateway/scheduler/device-simulator(4개 백엔드 프로세스)는 물리적으로 분리된
 *    공격 표면이 아니라 같은 신뢰 경계 안의 프로세스라, 계정 관리 부담을 줄이기 위해
 *    공용 계정(svc-backend) 하나를 쓰고 enterprise/# 전체에 readwrite를 준다.
 *
 * 비밀번호는 발급 시점에만 평문으로 존재한다(콘솔에 1회 출력) — DB(device_credential)에는
 * 검증 불가능한 단방향 해시만 남긴다(mosquitto 자체 인증은 mosquitto_passwd가 만드는
 * passwd 파일이 별도로 담당). 이미 발급된 자격증명은 재실행해도 건드리지 않는다(멱등) —
 * 강제로 새로 발급하려면 --rotate <boardCode> 로 그 보드만 지정해서 돌린다.
 */

const SERVICE_ACCOUNT = "svc-backend";

const MOSQUITTO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../infra/mosquitto");
const PASSWD_PATH = path.join(MOSQUITTO_DIR, "passwd");
const ACL_PATH = path.join(MOSQUITTO_DIR, "acl");
const ENV_PATH = path.resolve(MOSQUITTO_DIR, "../../.env");

interface BoardRow {
  board_id: string;
  board_code: string;
  board_topic: string;
  child_code: string | null;
  child_topic: string | null;
}

interface Board {
  id: string;
  code: string;
  topic: string;
  children: { code: string; topic: string }[];
}

function hashSecret(secret: string): string {
  const salt = randomBytes(16).toString("base64url");
  const iterations = 120000;
  const hash = pbkdf2Sync(secret, salt, iterations, 32, "sha256").toString("base64url");
  return `pbkdf2$sha256$${iterations}$${salt}$${hash}`;
}

function genPassword(): string {
  return randomBytes(18).toString("base64url");
}

async function loadBoards(): Promise<Board[]> {
  const r = await query<BoardRow>(
    `SELECT b.id::text AS board_id, b.code AS board_code, b.mqtt_topic AS board_topic,
            c.code AS child_code, c.mqtt_topic AS child_topic
     FROM device b
     LEFT JOIN device c ON c.parent_device_id = b.id
     WHERE b.device_role = 'MONITORING_EQUIPMENT'
     ORDER BY b.code, c.code`,
  );
  const boards = new Map<string, Board>();
  for (const row of r.rows) {
    let board = boards.get(row.board_id);
    if (!board) {
      board = { id: row.board_id, code: row.board_code, topic: row.board_topic, children: [] };
      boards.set(row.board_id, board);
    }
    if (row.child_code && row.child_topic) {
      board.children.push({ code: row.child_code, topic: row.child_topic });
    }
  }
  return [...boards.values()];
}

async function getActiveCredentialId(deviceId: string): Promise<string | null> {
  const r = await query<{ id: string }>(
    `SELECT id::text AS id FROM device_credential
     WHERE device_id = $1 AND cred_type = 'MQTT_PASSWORD' AND status = 'ACTIVE'
     ORDER BY issued_at DESC LIMIT 1`,
    [deviceId],
  );
  return r.rows[0]?.id ?? null;
}

async function revokeCredential(credentialId: string): Promise<void> {
  await query(`UPDATE device_credential SET status = 'REVOKED' WHERE id = $1`, [credentialId]);
}

async function insertCredential(deviceId: string, secretHash: string): Promise<void> {
  await query(
    `INSERT INTO device_credential (device_id, cred_type, secret_hash, status)
     VALUES ($1, 'MQTT_PASSWORD', $2, 'ACTIVE')`,
    [deviceId, secretHash],
  );
}

function readPasswdFile(): string {
  return existsSync(PASSWD_PATH) ? readFileSync(PASSWD_PATH, "utf8") : "";
}

function passwdHasUser(username: string): boolean {
  const text = readPasswdFile();
  return text.split("\n").some((line) => line.startsWith(`${username}:`));
}

/** mosquitto_passwd는 브로커 컨테이너 안에서만 돈다 — 실행 중인 mosquitto 컨테이너에 그대로 docker exec. */
function addToMosquittoPasswdFile(username: string, password: string): void {
  const needsCreate = !existsSync(PASSWD_PATH);
  const args = ["exec", "mosquitto", "mosquitto_passwd"];
  if (needsCreate) args.push("-c");
  args.push("-b", "/mosquitto/config/passwd", username, password);
  execFileSync("docker", args, { stdio: "pipe" });
}

function buildAclContent(boards: Board[]): string {
  const lines: string[] = [
    `user ${SERVICE_ACCOUNT}`,
    `topic readwrite enterprise/#`,
    `topic readwrite platform/service/#`,
    "",
  ];
  for (const board of boards) {
    lines.push(`user ${board.code}`);
    lines.push(`topic readwrite ${board.topic}/#`);
    for (const child of board.children) {
      lines.push(`topic readwrite ${child.topic}/#`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** .env에 서비스 계정 값이 없으면 추가한다(있으면 그대로 둔다 — 이미 쓰고 있는 값을 덮어쓰지 않는다). */
function ensureEnvHasServiceCreds(username: string, password: string): boolean {
  const text = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  if (/^MQTT_USERNAME=/m.test(text)) return false;
  const addition = `\n# provision:mqtt-auth 가 발급한 백엔드 공용 MQTT 계정(api/gateway/scheduler/device-simulator 공용)\nMQTT_USERNAME=${username}\nMQTT_PASSWORD=${password}\n`;
  writeFileSync(ENV_PATH, text + addition);
  return true;
}

function reloadMosquitto(): void {
  execFileSync("docker", ["kill", "-s", "HUP", "mosquitto"], { stdio: "pipe" });
}

async function main(): Promise<void> {
  const rotateOnly = process.argv.includes("--rotate") ? process.argv[process.argv.indexOf("--rotate") + 1] : null;

  const boards = await loadBoards();
  const issued: { username: string; password: string }[] = [];

  // ── 백엔드 공용 계정 ──────────────────────────────────────────────
  if (!rotateOnly && !passwdHasUser(SERVICE_ACCOUNT)) {
    const password = genPassword();
    addToMosquittoPasswdFile(SERVICE_ACCOUNT, password);
    const wroteEnv = ensureEnvHasServiceCreds(SERVICE_ACCOUNT, password);
    issued.push({ username: SERVICE_ACCOUNT, password });
    console.log(
      `[provision] ${SERVICE_ACCOUNT} 발급${wroteEnv ? " — .env에 MQTT_USERNAME/MQTT_PASSWORD 추가함" : " (.env에 이미 MQTT_USERNAME이 있어 건드리지 않음 — 위 비밀번호를 직접 반영할 것)"}`,
    );
  } else if (!rotateOnly) {
    console.log(`[provision] ${SERVICE_ACCOUNT} 이미 발급됨 — 건너뜀`);
  }

  // ── 보드(감시장비)별 계정 ─────────────────────────────────────────
  for (const board of boards) {
    if (rotateOnly && rotateOnly !== board.code) continue;

    const existingCredId = await getActiveCredentialId(board.id);
    const alreadyInPasswdFile = passwdHasUser(board.code);
    if (existingCredId && alreadyInPasswdFile && !rotateOnly) {
      console.log(`[provision] ${board.code} 이미 발급됨 — 건너뜀`);
      continue;
    }

    if (existingCredId) {
      await revokeCredential(existingCredId);
    }
    const password = genPassword();
    await insertCredential(board.id, hashSecret(password));
    addToMosquittoPasswdFile(board.code, password);
    issued.push({ username: board.code, password });
    console.log(`[provision] ${board.code} ${existingCredId ? "재발급(rotate)" : "신규 발급"} — 채널 ${board.children.length}개`);
  }

  writeFileSync(ACL_PATH, buildAclContent(boards));
  reloadMosquitto();

  console.log(`\n[provision] 완료 — 보드 ${boards.length}개, 이번에 새로 발급된 계정 ${issued.length}개`);
  if (issued.length > 0) {
    console.log("[provision] 아래 비밀번호는 이번 한 번만 출력된다 — 각 보드 config.h / .env에 지금 반영할 것:");
    for (const { username, password } of issued) {
      console.log(`  ${username} : ${password}`);
    }
  }
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("[provision] 오류:", err);
    process.exit(1);
  });
