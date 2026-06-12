/**
 * api.js
 * 세방테크 주간 법규 준수 모니터링 시스템
 * Apps Script Web App API 통신 모듈
 */

const API_BASE_URL = "https://script.google.com/macros/s/AKfycbyw7Cd-tYPSsV9nuzXHcwcn3oUyB93ydEQW9Z31vAT5iyWad_8mrhoYjd5U8_90BBg/exec";

async function apiGet(action, params = {}) {
  const url = new URL(API_BASE_URL);
  url.searchParams.set("action", action);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetch(url.toString());

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
