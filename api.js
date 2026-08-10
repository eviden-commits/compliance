/**
 * api.js
 * 세방테크 주간 법규 준수 모니터링 시스템
 * Apps Script Web App API 통신 모듈
 */

const API_BASE_URL = "https://script.google.com/macros/s/AKfycbyw7Cd-tYPSsV9nuzXHcwcn3oUyB93ydEQW9Z31vAT5iyWad_8mrhoYjd5U8_90BBg/exec";

// Apps Script 웹앱은 script.google.com -> script.googleusercontent.com으로
// 302 리다이렉트되는데, 배포 직후/휴지 후 재시작(cold start) 시 구글 쪽에서
// 이 리다이렉트 중간에 CORS 헤더가 없는 응답을 순간적으로 돌려줄 때가 있다
// ("Failed to fetch"). 우리 쪽 코드로 근본 원인은 고칠 수 없으므로,
// 네트워크 레벨 실패(fetch가 throw하는 TypeError)에 한해 짧게 대기 후 자동
// 재시도한다. 서버가 정상 응답(200/4xx/5xx)을 준 경우는 재시도하지 않는다.
// GET(조회)만 재시도한다 — POST(제출/추가/변경 등)는 요청이 서버에 실제로
// 도달했는지 확신할 수 없는 상태에서 재시도하면 중복 처리될 위험이 있어
// 자동 재시도 대상에서 제외한다.
async function fetchWithRetry_(url, options, retries = 2, delayMs = 400) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function apiGet(action, params = {}) {
  const url = new URL(API_BASE_URL);
  url.searchParams.set("action", action);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetchWithRetry_(url.toString());

  if (!response.ok) {
    throw new Error("API GET 실패: " + response.status);
  }

  return await response.json();
}

async function apiPost(action, payload) {
  const response = await fetch(API_BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify({
      action,
      payload
    })
  });

  if (!response.ok) {
    throw new Error("API POST 실패: " + response.status);
  }

  return await response.json();
}
