import { useEffect, useState } from "react";
import { getSystemName } from "./api";

const DEFAULT_SYSTEM_NAME = "SmartHome 관제";

/** 로그인 화면·상단 헤더·브라우저 탭 제목이 공유하는 시스템 표시 이름(2026-07-15, 관리자 설정 가능). */
export function useSystemName(): string {
  const [name, setName] = useState(DEFAULT_SYSTEM_NAME);

  useEffect(() => {
    getSystemName()
      .then(setName)
      .catch(() => undefined); // 조회 실패 시 기본값 유지
  }, []);

  useEffect(() => {
    document.title = name;
  }, [name]);

  return name;
}
