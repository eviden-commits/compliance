# 세방테크 주간 법규 준수 모니터링 시스템 Web MVP v2

## 구성 파일

- index.html: 화면 구조
- style.css: 디자인 및 반응형 레이아웃
- api.js: Apps Script Web App API 통신
- app.js: 화면 상태관리, Rule Master 렌더링, 점검결과 제출 로직

## 이번 버전 핵심

- Rule Master T1~T3 조회 정상
- 현장 목록 조회 정상
- 한글/숫자 입력 끊김 개선
- 입력 중 화면 전체 재렌더링 제거
- compositionstart / compositionend 기반 한글 조합 입력 대응
- condition_operator gt / eq / neq 계열 대응

## GitHub Pages 적용 방법

기존 compliance 폴더의 index.html을 포함하여 아래 4개 파일로 교체합니다.

- index.html
- style.css
- api.js
- app.js

## 주의

Apps Script Web App 배포 URL이 변경되면 api.js의 API_BASE_URL 값을 수정해야 합니다.
