/**
 * app.js
 * 세방테크 주간 법규 준수 모니터링 시스템
 * 화면 상태관리, Rule Master 렌더링, 점검결과 제출 로직
 */

const state = {
        appConfig: null,
        rules: null,
        sites: [],
        selectedSite: null,
        currentTriggerId: null,
        triggerResults: {},
        baseAnswers: {},
        itemResults: {},
        badDetails: {},
      };
      const $ = (id) => document.getElementById(id);
      function showToast(message) {
        const el = $("toast");
        el.textContent = message;
        el.classList.add("show");
        setTimeout(() => el.classList.remove("show"), 4800);
      }
      async function init() {
        try {
          $("apiBadge").textContent = "API 연결 중";
          $("systemStatus").textContent = "API 연결 중입니다.";
          const health = await apiGet("healthCheck");
          if (!health.ok) throw new Error("healthCheck 실패");
          $("apiBadge").textContent = "API 정상";
          $("apiBadge").className = "api-badge ok";
          const configRes = await apiGet("getAppConfig");
          if (!configRes.ok)
            throw new Error(configRes.error?.message || "getAppConfig 실패");
          state.appConfig = configRes.data;
          state.sites = configRes.data.sites || [];
          renderWeek(configRes.data.currentWeek);
          renderSites();
          const ruleRes = await apiGet("getPublishedRules");
          if (!ruleRes.ok)
            throw new Error(ruleRes.error?.message || "getPublishedRules 실패");
          state.rules = ruleRes.data;
          $("ruleVersion").value = state.rules.ruleVersion || "";
          initializeStateFromRules();
          renderTriggerList();
          selectTrigger((state.rules.triggers[0] || {}).trigger_id);
          $("systemStatus").innerHTML =
            "API 연결 정상<br>Rule Version: " +
            escapeHtml(state.rules.ruleVersion || "") +
            "<br>트리거: " +
            (state.rules.triggers || []).length +
            "개<br>세부항목: " +
            (state.rules.items || []).length;
        } catch (err) {
          $("apiBadge").textContent = "API 오류";
          $("apiBadge").className = "api-badge fail";
          $("systemStatus").textContent = "초기화 오류: " + err.message;
          showToast("초기화 오류: " + err.message);
        }
      }
      function renderWeek(info) {
        if (!info) return;
        $("weekText").textContent =
          `${info.year}년 ${info.week}주차 (${info.week_start} ~ ${info.week_end})`;
      }
      function renderSites() {
        const sel = $("siteSelect");
        sel.innerHTML = "";
        state.sites.forEach((site) => {
          const opt = document.createElement("option");
          opt.value = site.site_id;
          opt.textContent = `${site.site_name} / ${site.division || ""} / ${site.contract_type || ""}`;
          sel.appendChild(opt);
        });
        state.selectedSite = state.sites[0] || null;
        sel.addEventListener("change", () => {
          state.selectedSite =
            state.sites.find((s) => s.site_id === sel.value) || null;
        });
      }
      function initializeStateFromRules() {
        (state.rules.triggers || []).forEach((t) => {
          state.triggerResults[t.trigger_id] = "";
          state.baseAnswers[t.trigger_id] = {};
          (state.rules.conditionMap?.[t.trigger_id] || []).forEach((c) => {
            if (c.input_type === "multicheck")
              state.baseAnswers[t.trigger_id][c.condition_key] = [];
            else
              state.baseAnswers[t.trigger_id][c.condition_key] =
                c.default_value || "";
          });
          (state.rules.itemMap?.[t.trigger_id] || []).forEach((item) => {
            state.itemResults[item.item_id] = "";
            state.badDetails[item.item_id] = {
              remark: "",
              corrective_action: "",
              due_date: "",
              responsible_person: "",
            };
          });
        });
      }
      function renderTriggerList() {
        const box = $("triggerList");
        box.innerHTML = "";
        (state.rules.triggers || []).forEach((t) => {
          const btn = document.createElement("button");
          btn.className =
            "trigger-btn" +
            (t.trigger_id === state.currentTriggerId ? " active" : "");
          btn.onclick = () => selectTrigger(t.trigger_id);
          const status = getTriggerStatus(t.trigger_id);
          btn.innerHTML = `<div class="trigger-icon">${escapeHtml(t.trigger_id)}</div><div style="flex:1;"><div class="trigger-title">${escapeHtml(t.short_title || t.trigger_title)}</div><div class="trigger-sub">${escapeHtml(status)}</div></div>`;
          box.appendChild(btn);
        });
      }
      function selectTrigger(triggerId) {
        if (!triggerId) return;
        state.currentTriggerId = triggerId;
        renderTriggerList();
        renderTriggerPanel();
        updateSummary();
      }
      function getTriggerStatus(triggerId) {
        const tr = state.triggerResults[triggerId];
        if (tr === "N") return "해당없음";
        if (tr !== "Y") return "미점검";
        const items = getActiveItemsForTrigger(triggerId);
        const statuses = items.map((i) => state.itemResults[i.item_id] || "");
        if (statuses.some((s) => s === "미이행")) return "미이행 있음";
        if (statuses.some((s) => !s)) return "진행 중";
        return "점검 완료";
      }
      function renderTriggerPanel() {
        const panel = $("triggerPanel");
        const trigger = (state.rules.triggers || []).find(
          (t) => t.trigger_id === state.currentTriggerId,
        );
        if (!trigger) {
          panel.innerHTML =
            '<div class="card trigger-card">표시할 트리거가 없습니다.</div>';
          return;
        }
        const tr = state.triggerResults[trigger.trigger_id] || "";
        const conditions = state.rules.conditionMap?.[trigger.trigger_id] || [];
        const activeItems = getActiveItemsForTrigger(trigger.trigger_id);
        panel.innerHTML = `<div class="card trigger-card"><div class="trigger-card-head"><div><h2>${escapeHtml(trigger.trigger_id)}. ${escapeHtml(trigger.trigger_title)}</h2><p>${escapeHtml(trigger.description || "")}</p></div><div class="segmented"><button class="${tr === "Y" ? "on y" : ""}" data-trigger-result="Y">해당됨</button><button class="${tr === "N" ? "on n" : ""}" data-trigger-result="N">해당없음</button></div></div><div id="baseBox"></div></div><div class="item-list" id="itemList"></div>`;
        panel.querySelectorAll("[data-trigger-result]").forEach((btn) => {
          btn.addEventListener("click", () => {
            state.triggerResults[trigger.trigger_id] =
              btn.dataset.triggerResult;
            if (btn.dataset.triggerResult === "N") {
              (state.rules.itemMap?.[trigger.trigger_id] || []).forEach(
                (item) => {
                  state.itemResults[item.item_id] = "해당없음";
                },
              );
            }
            renderTriggerPanel();
            renderTriggerList();
            updateSummary();
          });
        });
        renderBaseQuestions(trigger, conditions);
        renderItems(activeItems, trigger);
      }
      function renderBaseQuestions(trigger, conditions) {
        const box = $("baseBox");

        if (
          !conditions.length ||
          state.triggerResults[trigger.trigger_id] !== "Y"
        ) {
          box.innerHTML = "";
          return;
        }

        box.innerHTML = `
          <div class="base-question">
            <h3 class="section-title">기초질문</h3>
            <div class="base-grid">
              ${conditions
                .map((c) => renderConditionInput(trigger.trigger_id, c))
                .join("")}
            </div>
          </div>
        `;

        conditions.forEach((c) => {
          const key = c.condition_key;

          if (c.input_type === "multicheck") {
            box.querySelectorAll(`[data-multi="${key}"]`).forEach((chk) => {
              chk.addEventListener("change", () => {
                const values = [
                  ...box.querySelectorAll(`[data-multi="${key}"]:checked`),
                ].map((x) => x.value);

                state.baseAnswers[trigger.trigger_id][key] = values;

                // 체크박스는 선택 즉시 조건부 항목이 바뀌므로 화면을 다시 그린다.
                renderTriggerPanel();
                updateSummary();
              });
            });

            return;
          }

          const el = box.querySelector(`[data-input="${key}"]`);
          if (!el) return;

          let isComposing = false;

          el.addEventListener("compositionstart", () => {
            isComposing = true;
          });

          el.addEventListener("compositionend", () => {
            isComposing = false;
            state.baseAnswers[trigger.trigger_id][key] = el.value;
            updateSummary();
          });

          el.addEventListener("input", () => {
            // 한글 조합 중에는 화면 재렌더링을 하지 않는다.
            // 재렌더링을 하면 입력 포커스가 끊기고 글자가 뚝뚝 끊긴다.
            if (isComposing) return;

            state.baseAnswers[trigger.trigger_id][key] = el.value;
            updateSummary();
          });

          el.addEventListener("change", () => {
            state.baseAnswers[trigger.trigger_id][key] = el.value;

            // 숫자/선택값 확정 후에만 조건부 항목 표시를 다시 계산한다.
            renderTriggerPanel();
            updateSummary();
          });

          el.addEventListener("blur", () => {
            state.baseAnswers[trigger.trigger_id][key] = el.value;

            // 입력 중에는 건드리지 않고, 포커스가 빠졌을 때만 재렌더링한다.
            renderTriggerPanel();
            updateSummary();
          });
        });
      }
      function renderConditionInput(triggerId, c) {
        const key = c.condition_key;
        const val = state.baseAnswers[triggerId]?.[key] ?? "";
        const label = escapeHtml(c.condition_label || key);
        if (c.input_type === "yn")
          return `<div class="field"><label>${label}</label><select data-input="${escapeAttr(key)}"><option value="">선택</option><option value="Y" ${val === "Y" ? "selected" : ""}>예</option><option value="N" ${val === "N" ? "selected" : ""}>아니오</option></select></div>`;
        if (c.input_type === "multicheck") {
          const selected = Array.isArray(val) ? val : [];
          const opts = String(c.option_values || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          return `<div class="field" style="grid-column:1 / -1;"><label>${label}</label><div class="check-list">${opts.map((opt) => `<label class="chip"><input type="checkbox" data-multi="${escapeAttr(key)}" value="${escapeAttr(opt)}" ${selected.includes(opt) ? "checked" : ""}>${escapeHtml(opt)}</label>`).join("")}</div></div>`;
        }
        const type = c.input_type === "count" ? "number" : "text";
        return `<div class="field"><label>${label}</label><input type="${type}" data-input="${escapeAttr(key)}" value="${escapeAttr(val)}" placeholder="${escapeAttr(c.help_text || "")}"></div>`;
      }
      function renderItems(items, trigger) {
        const list = $("itemList");
        if (state.triggerResults[trigger.trigger_id] === "N") {
          list.innerHTML =
            '<div class="card trigger-card"><h2>이번 주 해당사항 없음</h2><p>해당 트리거의 세부항목은 해당없음으로 처리됩니다.</p></div>';
          return;
        }
        if (state.triggerResults[trigger.trigger_id] !== "Y") {
          list.innerHTML =
            '<div class="card trigger-card"><h2>해당 여부 선택 필요</h2><p>먼저 이번 주 해당 여부를 선택하십시오.</p></div>';
          return;
        }
        list.innerHTML = items
          .map((item) => renderItemCard(item, trigger))
          .join("");
        list.querySelectorAll("[data-result]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const itemId = btn.dataset.itemId;
            state.itemResults[itemId] = btn.dataset.result;
            renderTriggerPanel();
            renderTriggerList();
            updateSummary();
          });
        });
        list.querySelectorAll("[data-detail]").forEach((el) => {
          el.addEventListener("input", () => {
            const itemId = el.dataset.itemId;
            const field = el.dataset.detail;
            state.badDetails[itemId][field] = el.value;
          });
        });
      }
      function renderItemCard(item, trigger) {
        const status = state.itemResults[item.item_id] || "";
        const isBad = status === "미이행";
        const isUnchecked = !status;
        const law = state.rules.lawMap?.[item.law_id] || {};
        const text = renderItemText(
          item,
          state.baseAnswers[trigger.trigger_id] || {},
        );
        const details = state.badDetails[item.item_id] || {};
        return `<div class="item-card ${isBad ? "bad" : isUnchecked ? "unchecked" : ""}"><div class="item-row"><div class="item-main"><div class="item-meta"><span class="pill">ITEM ${escapeHtml(String(item.item_no || ""))}</span><span class="pill law">${escapeHtml((law.law_name || item.law_id || "") + " " + (law.article || ""))}</span>${String(item.required).toUpperCase() === "Y" ? '<span class="pill req">필수</span>' : '<span class="pill">권장</span>'}${item.evidence_required === "Y" ? '<span class="pill new">증빙필수</span>' : ""}</div><h3 class="item-title">${escapeHtml(item.item_title || "")}</h3><p class="item-text">${escapeHtml(text)}</p>${item.note ? `<p class="item-text" style="margin-top:6px;">비고: ${escapeHtml(item.note)}</p>` : ""}</div><div class="item-actions"><div class="segmented"><button class="${status === "이행" ? "on ok" : ""}" data-item-id="${escapeAttr(item.item_id)}" data-result="이행">이행</button><button class="${status === "미이행" ? "on bad" : ""}" data-item-id="${escapeAttr(item.item_id)}" data-result="미이행">미이행</button><button class="${status === "해당없음" ? "on na" : ""}" data-item-id="${escapeAttr(item.item_id)}" data-result="해당없음">해당없음</button></div></div></div>${isBad ? `<div class="bad-extra"><div class="field wide"><label>미이행 사유</label><textarea data-item-id="${escapeAttr(item.item_id)}" data-detail="remark">${escapeHtml(details.remark || "")}</textarea></div><div class="field wide"><label>시정조치계획</label><textarea data-item-id="${escapeAttr(item.item_id)}" data-detail="corrective_action">${escapeHtml(details.corrective_action || "")}</textarea></div><div class="field"><label>조치기한</label><input type="date" data-item-id="${escapeAttr(item.item_id)}" data-detail="due_date" value="${escapeAttr(details.due_date || "")}"></div><div class="field"><label>조치담당자</label><input data-item-id="${escapeAttr(item.item_id)}" data-detail="responsible_person" value="${escapeAttr(details.responsible_person || "")}"></div></div>` : ""}</div>`;
      }
      function getActiveItemsForTrigger(triggerId) {
        const allItems = state.rules.itemMap?.[triggerId] || [];
        const answers = state.baseAnswers[triggerId] || {};
        return allItems.filter((item) => isItemActive(item, answers));
      }
      function isItemActive(item, answers) {
        if (String(item.active || "Y").toUpperCase() !== "Y") {
          return false;
        }

        if (item.condition_type) {
          const selected = [];

          Object.values(answers).forEach((value) => {
            if (Array.isArray(value)) {
              selected.push(...value);
            }
          });

          return selected.includes(item.condition_type);
        }

        if (item.condition_key) {
          const value = answers[item.condition_key];
          const operator = String(item.condition_operator || "").trim();
          const target = item.condition_value;

          if (operator === "gt" || operator === ">") {
            return Number(value || 0) > Number(target || 0);
          }

          if (operator === "gte" || operator === ">=") {
            return Number(value || 0) >= Number(target || 0);
          }

          if (operator === "lt" || operator === "<") {
            return Number(value || 0) < Number(target || 0);
          }

          if (operator === "lte" || operator === "<=") {
            return Number(value || 0) <= Number(target || 0);
          }

          if (operator === "eq" || operator === "=") {
            return String(value) === String(target);
          }

          if (operator === "neq" || operator === "!=") {
            return String(value) !== String(target);
          }
        }

        return true;
      }
      function renderItemText(item, answers) {
        let text = item.item_text || "";
        const countKey = item.count_key;
        const value = countKey ? (answers[countKey] ?? "") : "";
        text = text
          .replaceAll("{N}", value || "0")
          .replaceAll("{M}", value || "0");
        return text;
      }
      function updateSummary() {
        const allActiveItems = [];
        (state.rules?.triggers || []).forEach((t) => {
          allActiveItems.push(...getActiveItemsForTrigger(t.trigger_id));
        });
        let ok = 0,
          bad = 0,
          un = 0,
          na = 0;
        const badItems = [];
        allActiveItems.forEach((item) => {
          const status = state.itemResults[item.item_id] || "";
          if (status === "이행") ok++;
          else if (status === "미이행") {
            bad++;
            badItems.push(item);
          } else if (status === "해당없음") na++;
          else un++;
        });
        const total = allActiveItems.length;
        const done = ok + bad + na;
        const pct = total ? Math.round((done / total) * 100) : 0;
        $("progressPercent").textContent = pct + "%";
        $("progressBar").style.width = pct + "%";
        $("miniOk").textContent = ok;
        $("miniBad").textContent = bad;
        $("miniUn").textContent = un;
        $("miniNa").textContent = na;
        $("sumTotal").textContent = total;
        $("sumOk").textContent = ok;
        $("sumBad").textContent = bad;
        $("sumUn").textContent = un;
        $("sumNa").textContent = na;
        if (un > 0)
          $("validationBox").textContent =
            `필수 확인: 미점검 항목 ${un}건이 남아 있습니다.`;
        else if (bad > 0)
          $("validationBox").textContent =
            `미이행 항목 ${bad}건이 있습니다. 미이행 사유와 시정조치계획을 확인하십시오.`;
        else
          $("validationBox").textContent = "모든 활성 항목이 점검되었습니다.";
        $("badList").innerHTML = badItems.length
          ? `<ul class="bad-list">${badItems.map((i) => `<li>${escapeHtml(i.item_id)} - ${escapeHtml(i.item_title || "")}</li>`).join("")}</ul>`
          : "미이행 항목이 없습니다.";
      }
      function buildSubmitPayload() {
        const site = state.selectedSite || {};
        const week = state.appConfig.currentWeek;
        const items = [];
        (state.rules.triggers || []).forEach((t) => {
          const triggerResult = state.triggerResults[t.trigger_id] || "";
          const activeItems = getActiveItemsForTrigger(t.trigger_id);
          const answers = state.baseAnswers[t.trigger_id] || {};
          activeItems.forEach((item) => {
            const law = state.rules.lawMap?.[item.law_id] || {};
            const result = state.itemResults[item.item_id] || "미점검";
            const detail = state.badDetails[item.item_id] || {};
            const answerValue = item.count_key
              ? answers[item.count_key] || ""
              : JSON.stringify(answers);
            items.push({
              trigger_id: t.trigger_id,
              trigger_title: t.short_title || t.trigger_title,
              trigger_result: triggerResult,
              item_id: item.item_id,
              item_no: item.item_no,
              apply_type: item.apply_type,
              law_id: item.law_id,
              law_name: law.law_name || "",
              law_article: law.article || "",
              item_title: item.item_title,
              item_text: renderItemText(item, answers),
              required: item.required,
              condition_key: item.condition_key,
              count_key: item.count_key,
              answer_value: answerValue,
              result_status: result,
              non_compliance_level: item.non_compliance_level || "",
              remark: result === "미이행" ? detail.remark || "" : "",
              corrective_action:
                result === "미이행" ? detail.corrective_action || "" : "",
              due_date: result === "미이행" ? detail.due_date || "" : "",
              responsible_person:
                result === "미이행" ? detail.responsible_person || "" : "",
              evidence_required: item.evidence_required || "N",
              evidence_count: 0,
            });
          });
        });
        return {
          inspection_year: week.year,
          inspection_week: week.week,
          week_start: week.week_start,
          week_end: week.week_end,
          site_id: site.site_id,
          site_name: site.site_name,
          division: site.division || "",
          contract_type: site.contract_type || "",
          contract_amount: site.contract_amount || "",
          manager_name: site.site_manager || "",
          manager_type: site.contract_type || "",
          submitter_name: $("submitterName").value.trim(),
          submitter_email: $("submitterEmail").value.trim(),
          rule_version: state.rules.ruleVersion,
          total_triggers: (state.rules.triggers || []).length,
          completed_triggers: Object.values(state.triggerResults).filter(
            (v) => v,
          ).length,
          items,
        };
      }
      function validateBeforeSubmit(payload) {
        const unchecked = payload.items.filter(
          (i) => !i.result_status || i.result_status === "미점검",
        );
        if (unchecked.length)
          return `미점검 항목 ${unchecked.length}건이 남아 있습니다.`;
        const badWithoutRemark = payload.items.filter(
          (i) => i.result_status === "미이행" && !i.remark,
        );
        if (badWithoutRemark.length)
          return `미이행 사유가 누락된 항목 ${badWithoutRemark.length}건이 있습니다.`;
        if (!payload.site_id) return "현장을 선택하십시오.";
        return "";
      }
      async function submitInspection() {
        const payload = buildSubmitPayload();
        const msg = validateBeforeSubmit(payload);
        if (msg) {
          showToast(msg);
          return;
        }
        if (!confirm("점검결과를 제출하시겠습니까?")) return;
        $("submitBtn").disabled = true;
        $("saveStatus").textContent = "제출 중입니다...";
        try {
          const res = await apiPost("submitInspection", payload);
          if (!res.ok) throw new Error(res.error?.message || "제출 실패");
          $("saveStatus").textContent = "제출 완료: " + res.data.submission_id;
          showToast("제출 완료: " + res.data.submission_id);
        } catch (err) {
          $("saveStatus").textContent = "제출 실패";
          showToast(
            "제출 오류: " +
              err.message +
              " / 웹앱 배포 버전 또는 CORS를 확인하십시오.",
          );
        } finally {
          $("submitBtn").disabled = false;
        }
      }
      function goNextTrigger() {
        const triggers = state.rules?.triggers || [];
        const idx = triggers.findIndex(
          (t) => t.trigger_id === state.currentTriggerId,
        );
        if (idx >= 0 && idx + 1 < triggers.length)
          selectTrigger(triggers[idx + 1].trigger_id);
        else showToast("마지막 트리거입니다.");
      }
      function escapeHtml(value) {
        return String(value ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#039;");
      }
      function escapeAttr(value) {
        return escapeHtml(value);
      }
      $("reloadBtn").addEventListener("click", () => location.reload());
      $("nextBtn").addEventListener("click", goNextTrigger);
      $("submitBtn").addEventListener("click", submitInspection);
      init();
