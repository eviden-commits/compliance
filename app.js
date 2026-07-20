/**
 * app.js
 * 세방테크 주간 법규 준수 모니터링 시스템
 * 화면 상태관리, Rule Master 렌더링, 점검결과 제출 로직
 */

// 비밀번호는 여기 두지 않는다. 서버(Auth.gs의 verifyLogin)에서만 대조한다.
      // 트리거 진입 전 전역으로 묻고, 해당 트리거의 기초질문에서는 숨기는 조건 키
      const GLOBAL_CONDITION_KEYS = ["n_workers"];

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
        siteContext: {
          avg_workers: "",
          new_workers: "",
          contract_type_confirm: "",
          has_foreign_workers: false,
        },
        triggerNotes: {},
        adminSites: [],
        adminRules: null,
        deleteSiteTarget: null,
        editRuleItemTarget: null,
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
          selectTrigger((getVisibleTriggers()[0] || {}).trigger_id);
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
        syncContractTypeConfirmToSelectedSite();
        sel.addEventListener("change", () => {
          state.selectedSite =
            state.sites.find((s) => s.site_id === sel.value) || null;
          syncContractTypeConfirmToSelectedSite();
          // 계약구분(원청/하도급)에 따라 노출되는 항목이 달라지므로 다시 그린다.
          renderTriggerPanel();
          renderTriggerList();
          updateSummary();
        });
      }
      function syncContractTypeConfirmToSelectedSite() {
        const value = state.selectedSite?.contract_type || "";
        state.siteContext.contract_type_confirm = value;
        document
          .querySelectorAll('input[name="siteContractTypeConfirm"]')
          .forEach((el) => {
            el.checked = el.value === value;
          });
      }
      function wireSiteConfirmBox() {
        document
          .querySelectorAll('input[name="siteContractTypeConfirm"]')
          .forEach((el) => {
            el.addEventListener("change", () => {
              state.siteContext.contract_type_confirm = el.value;
              renderTriggerList();
              renderTriggerPanel();
              updateSummary();
            });
          });
        $("hasForeignWorkers").addEventListener("change", (e) => {
          const checked = e.target.checked;
          state.siteContext.has_foreign_workers = checked;
          state.triggerResults["T2"] = checked ? "Y" : "N";
          if (!checked) {
            (state.rules.itemMap?.["T2"] || []).forEach((item) => {
              state.itemResults[item.item_id] = "해당없음";
            });
          }
          renderTriggerList();
          renderTriggerPanel();
          updateSummary();
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
      function getVisibleTriggers() {
        const contractType = state.siteContext.contract_type_confirm || "";
        return (state.rules?.triggers || []).filter((t) => {
          // 원청 전용 트리거는 계약구분이 원청으로 확인된 경우에만 노출한다.
          if (t.apply_type === "원청" && contractType !== "원청") return false;
          return true;
        });
      }
      function renderTriggerList() {
        const box = $("triggerList");
        box.innerHTML = "";
        const visibleTriggers = getVisibleTriggers();
        if (
          state.currentTriggerId &&
          !visibleTriggers.some((t) => t.trigger_id === state.currentTriggerId)
        ) {
          state.currentTriggerId = (visibleTriggers[0] || {}).trigger_id || null;
        }
        visibleTriggers.forEach((t) => {
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
        const allItems = state.rules.itemMap?.[trigger.trigger_id] || [];
        const activeItems = getActiveItemsForTrigger(trigger.trigger_id);
        const skippedByCycleCount = allItems.filter(
          (item) => !isItemDueThisWeek(item),
        ).length;
        panel.innerHTML = `<div class="card trigger-card"><div class="trigger-card-head"><div><h2>${escapeHtml(trigger.trigger_id)}. ${escapeHtml(trigger.trigger_title)}</h2><p>${escapeHtml(trigger.description || "")}</p></div><div class="segmented"><button class="${tr === "Y" ? "on y" : ""}" data-trigger-result="Y">해당됨</button><button class="${tr === "N" ? "on n" : ""}" data-trigger-result="N">해당없음</button></div></div><div id="baseBox"></div>${
          skippedByCycleCount
            ? `<p class="muted" style="margin-top:10px;font-size:12px;">정기점검 주기가 아직 도래하지 않은 항목 ${skippedByCycleCount}건은 이번 주 목록에서 제외되었습니다.</p>`
            : ""
        }${
          tr === "Y"
            ? `<div class="base-question" style="margin-top:14px;"><h3 class="section-title">확인 메모 (선택)</h3><textarea id="triggerNoteInput" placeholder="이번 주 이 트리거와 관련해서 무엇을 확인했는지 자유롭게 적어주십시오. (예: 현장 게시판 육안 확인, 서류철 대조 확인 등)">${escapeHtml(state.triggerNotes[trigger.trigger_id] || "")}</textarea></div>`
            : ""
        }</div><div class="item-list" id="itemList"></div>`;
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
        wireTriggerNoteInput(trigger.trigger_id);
        renderBaseQuestions(trigger, conditions);
        renderItems(activeItems, trigger);
      }
      function wireTriggerNoteInput(triggerId) {
        const el = $("triggerNoteInput");
        if (!el) return;

        let isComposing = false;
        el.addEventListener("compositionstart", () => {
          isComposing = true;
        });
        el.addEventListener("compositionend", () => {
          isComposing = false;
          state.triggerNotes[triggerId] = el.value;
        });
        el.addEventListener("input", () => {
          if (isComposing) return;
          state.triggerNotes[triggerId] = el.value;
        });
      }
      function renderBaseQuestions(trigger, allConditions) {
        const box = $("baseBox");
        // n_workers 등은 트리거 진입 전 "현장 인력 현황" 박스에서 이미 물었으므로
        // 트리거 안에서는 다시 묻지 않는다.
        const conditions = allConditions.filter(
          (c) => !GLOBAL_CONDITION_KEYS.includes(c.condition_key),
        );

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
        list.querySelectorAll("[data-law-id]").forEach((el) => {
          el.addEventListener("click", () => openLawModal(el.dataset.lawId));
          el.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openLawModal(el.dataset.lawId);
            }
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
        const lawLabel = escapeHtml(
          (law.law_name || item.law_id || "") + " " + (law.article || ""),
        );
        const lawPill = law.law_name
          ? `<span class="pill law clickable" data-law-id="${escapeAttr(item.law_id)}" role="button" tabindex="0" title="법규 원문 보기">${lawLabel} 🔍</span>`
          : `<span class="pill law">${lawLabel}</span>`;
        return `<div class="item-card ${isBad ? "bad" : isUnchecked ? "unchecked" : ""}"><div class="item-row"><div class="item-main"><div class="item-meta"><span class="pill">ITEM ${escapeHtml(String(item.item_no || ""))}</span>${lawPill}${String(item.required).toUpperCase() === "Y" ? '<span class="pill req">필수</span>' : '<span class="pill">권장</span>'}${item.evidence_required === "Y" ? '<span class="pill new">증빙필수</span>' : ""}</div><h3 class="item-title">${escapeHtml(item.item_title || "")}</h3><p class="item-text">${escapeHtml(text)}</p>${item.note ? `<p class="item-text" style="margin-top:6px;">비고: ${escapeHtml(item.note)}</p>` : ""}</div><div class="item-actions"><div class="segmented"><button class="${status === "이행" ? "on ok" : ""}" data-item-id="${escapeAttr(item.item_id)}" data-result="이행">이행</button><button class="${status === "미이행" ? "on bad" : ""}" data-item-id="${escapeAttr(item.item_id)}" data-result="미이행">미이행</button><button class="${status === "해당없음" ? "on na" : ""}" data-item-id="${escapeAttr(item.item_id)}" data-result="해당없음">해당없음</button></div></div></div>${isBad ? `<div class="bad-extra"><div class="field wide"><label>미이행 사유</label><textarea data-item-id="${escapeAttr(item.item_id)}" data-detail="remark">${escapeHtml(details.remark || "")}</textarea></div><div class="field wide"><label>시정조치계획</label><textarea data-item-id="${escapeAttr(item.item_id)}" data-detail="corrective_action">${escapeHtml(details.corrective_action || "")}</textarea></div><div class="field"><label>조치기한</label><input type="date" data-item-id="${escapeAttr(item.item_id)}" data-detail="due_date" value="${escapeAttr(details.due_date || "")}"></div><div class="field"><label>조치담당자</label><input data-item-id="${escapeAttr(item.item_id)}" data-detail="responsible_person" value="${escapeAttr(details.responsible_person || "")}"></div></div>` : ""}</div>`;
      }
      function openLawModal(lawId) {
        const law = state.rules?.lawMap?.[lawId];
        if (!law) {
          showToast("법규 상세정보를 찾을 수 없습니다: " + lawId);
          return;
        }
        $("lawModalName").textContent = law.law_name || lawId;
        $("lawModalArticle").textContent = [law.article, law.clause]
          .filter(Boolean)
          .join(" · ");
        $("lawModalClause").textContent = law.clause || "-";
        $("lawModalSummary").textContent = law.law_summary || "내용이 없습니다.";
        $("lawModalPenalty").textContent = law.penalty || "명시된 벌칙 없음";
        const noteBox = $("lawModalNoteBox");
        if (law.note) {
          $("lawModalNote").textContent = law.note;
          noteBox.style.display = "";
        } else {
          noteBox.style.display = "none";
        }
        const query = encodeURIComponent(
          [law.law_name, law.article].filter(Boolean).join(" "),
        );
        $("lawModalExternalLink").href =
          "https://www.law.go.kr/LSW/lsSc.do?menuId=1&query=" + query;
        $("lawModal").classList.remove("hidden");
      }
      function closeLawModal() {
        $("lawModal").classList.add("hidden");
      }
      function getActiveItemsForTrigger(triggerId) {
        const allItems = state.rules.itemMap?.[triggerId] || [];
        const answers = state.baseAnswers[triggerId] || {};
        const contractType = state.siteContext.contract_type_confirm || "";
        return allItems.filter((item) => {
          // 원청 전용 항목은 원청 현장에서만 노출한다.
          if (item.apply_type === "원청" && contractType !== "원청")
            return false;
          // 정기점검 주기(check_cycle)가 이번 ISO 주차에 해당하지 않으면 제외한다.
          if (!isItemDueThisWeek(item)) return false;
          return isItemActive(item, answers);
        });
      }
      // check_cycle(매주/격주/월간/분기/반기/연간)을 ISO 주차 번호로 판정한다.
      // ISO 주차는 백엔드 getCurrentIsoWeekInfo_()가 계산해서 getAppConfig의
      // currentWeek.week로 내려주는 값을 그대로 쓴다 (1~52/53).
      function isItemDueThisWeek(item) {
        const cycle = item.check_cycle || "매주";
        if (cycle === "매주") return true;

        const week = Number(state.appConfig?.currentWeek?.week || 1);

        if (cycle === "격주") return (week - 1) % 2 === 0;
        if (cycle === "월간") return (week - 1) % 4 === 0;
        if (cycle === "분기") return (week - 1) % 13 === 0;
        if (cycle === "반기") return (week - 1) % 26 === 0;
        if (cycle === "연간") return week === 1;

        return true;
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
        getVisibleTriggers().forEach((t) => {
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
        getVisibleTriggers().forEach((t) => {
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
          avg_workers: state.siteContext.avg_workers || "",
          new_workers: state.siteContext.new_workers || "",
          contract_type_confirm: state.siteContext.contract_type_confirm || "",
          has_foreign_workers: state.siteContext.has_foreign_workers
            ? "Y"
            : "N",
          trigger_notes: getVisibleTriggers()
            .filter(
              (t) =>
                state.triggerResults[t.trigger_id] === "Y" &&
                (state.triggerNotes[t.trigger_id] || "").trim(),
            )
            .map((t) => ({
              trigger_id: t.trigger_id,
              trigger_title: t.short_title || t.trigger_title,
              note: state.triggerNotes[t.trigger_id].trim(),
            })),
          submitter_name: $("submitterName").value.trim(),
          submitter_email: $("submitterEmail").value.trim(),
          rule_version: state.rules.ruleVersion,
          total_triggers: getVisibleTriggers().length,
          completed_triggers: Object.values(state.triggerResults).filter(
            (v) => v,
          ).length,
          items,
        };
      }
      function validateSubmitterFields() {
        const nameOk = !!$("submitterName").value.trim();
        const emailOk = !!$("submitterEmail").value.trim();
        $("submitterName").classList.toggle("field-error", !nameOk);
        $("submitterEmail").classList.toggle("field-error", !emailOk);
        if (!nameOk && !emailOk) return "점검자와 제출자 이메일을 입력하십시오.";
        if (!nameOk) return "점검자를 입력하십시오.";
        if (!emailOk) return "제출자 이메일을 입력하십시오.";
        return "";
      }
      function validateBeforeSubmit(payload) {
        const submitterMsg = validateSubmitterFields();
        if (submitterMsg) return submitterMsg;
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
      function driveDirectDownloadUrl(fileId) {
        return fileId
          ? "https://drive.google.com/uc?export=download&id=" + fileId
          : "";
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
          const pdfUrl = res.data.pdf_url || "";
          const pdfFileId = res.data.pdf_file_id || "";
          const downloadUrl = driveDirectDownloadUrl(pdfFileId) || pdfUrl;

          if (pdfUrl) {
            $("saveStatus").innerHTML =
              '제출 완료: ' +
              escapeHtml(res.data.submission_id) +
              ' / <a href="' +
              escapeAttr(pdfUrl) +
              '" target="_blank" rel="noopener">PDF 열기</a>' +
              ' / <a id="pdfDownloadLink" href="' +
              escapeAttr(downloadUrl) +
              '" target="_blank" rel="noopener">PDF 다운로드</a>' +
              ' <span id="autoDownloadNotice" class="muted">(3초 후 자동 다운로드됩니다)</span>';

            showToast("제출 완료. PDF가 생성되었습니다.");

            setTimeout(() => {
              const notice = $("autoDownloadNotice");
              if (notice) notice.remove();
              const a = document.createElement("a");
              a.href = downloadUrl;
              a.target = "_blank";
              a.rel = "noopener";
              document.body.appendChild(a);
              a.click();
              a.remove();
            }, 3000);
          } else {
            $("saveStatus").textContent =
              "제출 완료: " + res.data.submission_id;
            showToast("제출 완료. PDF URL은 생성되지 않았습니다.");
          }
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
        const triggers = getVisibleTriggers();
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
      function extractDriveFileId(url) {
        const m = String(url || "").match(/\/d\/([^/]+)/);
        return m ? m[1] : "";
      }

      // ---------------- 현장 인력 현황 (트리거 전 사전 입력) ----------------
      function wireWorkforceBox() {
        $("avgWorkers").addEventListener("input", () => {
          state.siteContext.avg_workers = $("avgWorkers").value;
        });
        $("newWorkers").addEventListener("input", () => {
          state.siteContext.new_workers = $("newWorkers").value;
          if (!state.baseAnswers["T1"]) state.baseAnswers["T1"] = {};
          state.baseAnswers["T1"].n_workers = $("newWorkers").value;
          if (state.currentTriggerId === "T1") {
            renderTriggerPanel();
            updateSummary();
          }
        });
      }

      // ---------------- 로그인 ----------------
      // 비밀번호는 서버(Auth.gs verifyLogin)에서만 검증한다. 클라이언트는
      // 결과(ok/fail)만 받는다 — 페이지 소스에 비밀번호가 노출되지 않는다.
      async function attemptLogin() {
        const role =
          document.querySelector('input[name="loginRole"]:checked')?.value ||
          "site";
        const pw = $("loginPassword").value;
        const btn = $("loginSubmitBtn");
        btn.disabled = true;
        $("loginError").textContent = "";
        try {
          const res = await apiPost("login", { role, password: pw });
          if (!res.ok) {
            $("loginError").textContent =
              res.error?.message || "비밀번호가 올바르지 않습니다.";
            return;
          }
          sessionStorage.setItem("authRole", res.data.role);
          showApp(res.data.role);
        } catch (err) {
          $("loginError").textContent =
            "로그인 확인 중 오류: " + err.message;
        } finally {
          btn.disabled = false;
        }
      }
      function showApp(role) {
        $("loginOverlay").classList.add("hidden");
        if (role === "admin") {
          $("adminRoot").classList.remove("hidden");
          initAdmin();
        } else {
          $("appRoot").classList.remove("hidden");
          init();
        }
      }
      function logout() {
        sessionStorage.removeItem("authRole");
        location.reload();
      }

      // ---------------- 관리자 ----------------
      async function initAdmin() {
        try {
          $("adminApiBadge").textContent = "API 확인 중";
          const health = await apiGet("healthCheck");
          if (!health.ok) throw new Error("healthCheck 실패");
          $("adminApiBadge").textContent = "API 정상";
          $("adminApiBadge").className = "api-badge ok";
          const configRes = await apiGet("getAppConfig");
          const week = configRes.data?.currentWeek;
          if (week) {
            $("adminYear").value = week.year;
            $("adminWeek").value = week.week;
          }
          await loadAdminWeek();
          await loadAdminSiteList();
          await loadAdminRuleItems();
        } catch (err) {
          $("adminApiBadge").textContent = "API 오류";
          $("adminApiBadge").className = "api-badge fail";
          showToast("관리자 초기화 오류: " + err.message);
        }
      }
      async function loadAdminSiteList() {
        try {
          const res = await apiGet("getSiteList", { includeInactive: "1" });
          if (!res.ok) throw new Error(res.error?.message || "현장목록 조회 실패");
          state.adminSites = res.data || [];
          renderAdminAllSites(state.adminSites);
        } catch (err) {
          showToast("현장목록 조회 오류: " + err.message);
        }
      }
      function renderAdminAllSites(sites) {
        const body = $("adminAllSiteTableBody");
        if (!sites.length) {
          body.innerHTML =
            '<tr><td colspan="7" class="muted">등록된 현장이 없습니다.</td></tr>';
          return;
        }
        body.innerHTML = sites
          .map((s) => {
            const isActive = String(s.active || "Y").toUpperCase() !== "N";
            const actionLabel = isActive ? "삭제" : "복구";
            const actionClass = isActive ? "req" : "new";
            return `<tr>
              <td>${escapeHtml(s.site_id)}</td>
              <td>${escapeHtml(s.site_name)}</td>
              <td>${escapeHtml(s.division || "")}</td>
              <td><span class="pill ${s.contract_type === "원청" ? "law" : ""}">${escapeHtml(s.contract_type || "")}</span></td>
              <td>${escapeHtml(s.site_manager || "")}</td>
              <td><span class="pill ${isActive ? "new" : "req"}">${isActive ? "활성" : "비활성"}</span></td>
              <td><button class="btn" style="padding:6px 10px;" data-site-action="${escapeAttr(s.site_id)}">
                <span class="pill ${actionClass}" style="pointer-events:none;">${actionLabel}</span>
              </button></td>
            </tr>`;
          })
          .join("");
        body.querySelectorAll("[data-site-action]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const siteId = btn.dataset.siteAction;
            const site = sites.find((s) => s.site_id === siteId);
            if (site) openDeleteSiteModal(site);
          });
        });
      }
      function openAddSiteModal() {
        $("addSiteError").textContent = "";
        $("addSiteModal").classList.remove("hidden");
      }
      function closeAddSiteModal() {
        $("addSiteModal").classList.add("hidden");
      }
      async function submitAddSite() {
        const siteName = $("newSiteName").value.trim();
        const contractType =
          document.querySelector('input[name="newSiteContractType"]:checked')
            ?.value || "";
        const adminPassword = $("newSiteAdminPassword").value;

        if (!siteName) {
          $("addSiteError").textContent = "현장명을 입력하십시오.";
          return;
        }
        if (!contractType) {
          $("addSiteError").textContent = "계약구분을 선택하십시오.";
          return;
        }
        if (!adminPassword) {
          $("addSiteError").textContent = "관리자 비밀번호를 입력하십시오.";
          return;
        }

        $("addSiteSubmitBtn").disabled = true;
        $("addSiteError").textContent = "";
        try {
          const res = await apiPost("addSite", {
            admin_password: adminPassword,
            site_name: siteName,
            division: $("newSiteDivision").value.trim(),
            contract_type: contractType,
            contract_amount: $("newSiteContractAmount").value,
            site_manager: $("newSiteManager").value.trim(),
          });
          if (!res.ok) throw new Error(res.error?.message || "현장 추가 실패");

          showToast(
            "현장이 추가되었습니다: " +
              res.data.site_id +
              " / " +
              res.data.site_name,
          );
          $("newSiteName").value = "";
          $("newSiteDivision").value = "하이테크본부";
          $("newSiteContractAmount").value = "";
          $("newSiteManager").value = "";
          $("newSiteAdminPassword").value = "";
          closeAddSiteModal();
          await loadAdminSiteList();
        } catch (err) {
          $("addSiteError").textContent = err.message;
        } finally {
          $("addSiteSubmitBtn").disabled = false;
        }
      }

      // ---------------- 현장 삭제/복구 ----------------
      function openDeleteSiteModal(site) {
        const isActive = String(site.active || "Y").toUpperCase() !== "N";
        state.deleteSiteTarget = { site_id: site.site_id, activate: !isActive };
        $("deleteSiteModalTitle").textContent = isActive
          ? "현장 삭제"
          : "현장 복구";
        $("deleteSiteModalDesc").textContent = isActive
          ? `"${site.site_name}"(${site.site_id})을(를) 비활성화합니다. 현장 선택 목록에서 사라지며, 언제든 다시 복구할 수 있습니다.`
          : `"${site.site_name}"(${site.site_id})을(를) 다시 활성화합니다.`;
        $("deleteSiteSubmitBtn").textContent = isActive ? "삭제" : "복구";
        $("deleteSiteError").textContent = "";
        $("deleteSiteAdminPassword").value = "";
        $("deleteSiteModal").classList.remove("hidden");
      }
      function closeDeleteSiteModal() {
        $("deleteSiteModal").classList.add("hidden");
        state.deleteSiteTarget = null;
      }
      async function submitDeleteSite() {
        const target = state.deleteSiteTarget;
        if (!target) return;
        const adminPassword = $("deleteSiteAdminPassword").value;
        if (!adminPassword) {
          $("deleteSiteError").textContent = "관리자 비밀번호를 입력하십시오.";
          return;
        }
        $("deleteSiteSubmitBtn").disabled = true;
        $("deleteSiteError").textContent = "";
        try {
          const action = target.activate ? "reactivateSite" : "deleteSite";
          const res = await apiPost(action, {
            site_id: target.site_id,
            admin_password: adminPassword,
          });
          if (!res.ok) throw new Error(res.error?.message || "처리 실패");
          showToast(
            (target.activate ? "복구되었습니다: " : "삭제되었습니다: ") +
              target.site_id,
          );
          closeDeleteSiteModal();
          await loadAdminSiteList();
        } catch (err) {
          $("deleteSiteError").textContent = err.message;
        } finally {
          $("deleteSiteSubmitBtn").disabled = false;
        }
      }

      // ---------------- 비밀번호 변경 ----------------
      function openChangePasswordModal(role) {
        const radios = document.getElementsByName("changePasswordRole");
        radios.forEach((r) => {
          r.checked = r.value === role;
        });
        $("changePasswordModalTitle").textContent = "비밀번호 변경";
        $("changePasswordCurrent").value = "";
        $("changePasswordNew").value = "";
        $("changePasswordConfirm").value = "";
        $("changePasswordError").textContent = "";
        $("changePasswordModal").classList.remove("hidden");
      }
      function closeChangePasswordModal() {
        $("changePasswordModal").classList.add("hidden");
      }
      async function submitChangePassword() {
        const roleRadio = document.querySelector(
          'input[name="changePasswordRole"]:checked',
        );
        const role = roleRadio ? roleRadio.value : "site";
        const current = $("changePasswordCurrent").value;
        const next = $("changePasswordNew").value;
        const confirm = $("changePasswordConfirm").value;
        if (!current || !next) {
          $("changePasswordError").textContent =
            "현재 비밀번호와 새 비밀번호를 입력하십시오.";
          return;
        }
        if (next.length < 4) {
          $("changePasswordError").textContent =
            "새 비밀번호는 4자 이상이어야 합니다.";
          return;
        }
        if (next !== confirm) {
          $("changePasswordError").textContent =
            "새 비밀번호 확인이 일치하지 않습니다.";
          return;
        }
        $("changePasswordSubmitBtn").disabled = true;
        $("changePasswordError").textContent = "";
        try {
          const res = await apiPost("changePassword", {
            role,
            current_password: current,
            new_password: next,
          });
          if (!res.ok) throw new Error(res.error?.message || "변경 실패");
          showToast("비밀번호가 변경되었습니다.");
          closeChangePasswordModal();
        } catch (err) {
          $("changePasswordError").textContent = err.message;
        } finally {
          $("changePasswordSubmitBtn").disabled = false;
        }
      }

      // ---------------- 법규 항목(Rule Master) 관리 ----------------
      async function loadAdminRuleItems() {
        try {
          const res = await apiGet("getPublishedRules");
          if (!res.ok) throw new Error(res.error?.message || "법규 조회 실패");
          state.adminRules = res.data;
          renderRuleItemTriggerFilter();
          renderRuleItemTable();
        } catch (err) {
          showToast("법규 항목 조회 오류: " + err.message);
        }
      }
      function renderRuleItemTriggerFilter() {
        const sel = $("ruleItemTriggerFilter");
        const triggers = state.adminRules?.triggers || [];
        sel.innerHTML =
          '<option value="">전체 트리거</option>' +
          triggers
            .map(
              (t) =>
                `<option value="${escapeAttr(t.trigger_id)}">${escapeHtml(t.trigger_id)}. ${escapeHtml(t.short_title || t.trigger_title)}</option>`,
            )
            .join("");
      }
      function renderRuleItemTable() {
        const body = $("ruleItemTableBody");
        const filterId = $("ruleItemTriggerFilter").value;
        const items = (state.adminRules?.items || []).filter(
          (i) => !filterId || i.trigger_id === filterId,
        );
        if (!items.length) {
          body.innerHTML =
            '<tr><td colspan="8" class="muted">항목이 없습니다.</td></tr>';
          return;
        }
        body.innerHTML = items
          .map((i) => {
            const isActive = String(i.active || "Y").toUpperCase() !== "N";
            return `<tr>
              <td>${escapeHtml(i.item_id)}</td>
              <td>${escapeHtml(i.item_title || "")}</td>
              <td class="wrap-cell">${escapeHtml(i.item_text || "")}</td>
              <td>${escapeHtml(String(i.required || "Y"))}</td>
              <td>${escapeHtml(i.non_compliance_level || "")}</td>
              <td>${escapeHtml(i.check_cycle || "매주")}</td>
              <td><span class="pill ${isActive ? "new" : "req"}">${isActive ? "Y" : "N"}</span></td>
              <td><button class="btn" style="padding:6px 10px;" data-edit-item="${escapeAttr(i.item_id)}">수정</button></td>
            </tr>`;
          })
          .join("");
        body.querySelectorAll("[data-edit-item]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const item = items.find((i) => i.item_id === btn.dataset.editItem);
            if (item) openRuleItemEditModal(item);
          });
        });
      }
      function openRuleItemEditModal(item) {
        state.editRuleItemTarget = item.item_id;
        $("ruleItemEditModalTitle").textContent =
          item.item_id + " 수정";
        $("editItemTitle").value = item.item_title || "";
        $("editItemText").value = item.item_text || "";
        $("editItemRequired").value = String(item.required || "Y").toUpperCase() === "N" ? "N" : "Y";
        $("editItemLevel").value = item.non_compliance_level || "중요";
        $("editItemCycle").value = item.check_cycle || "매주";
        $("editItemEvidence").value = String(item.evidence_required || "N").toUpperCase() === "Y" ? "Y" : "N";
        $("editItemActive").value = String(item.active || "Y").toUpperCase() === "N" ? "N" : "Y";
        $("editItemAdminPassword").value = "";
        $("ruleItemEditError").textContent = "";
        $("ruleItemEditModal").classList.remove("hidden");
      }
      function closeRuleItemEditModal() {
        $("ruleItemEditModal").classList.add("hidden");
        state.editRuleItemTarget = null;
      }
      async function submitRuleItemEdit() {
        const itemId = state.editRuleItemTarget;
        if (!itemId) return;
        const adminPassword = $("editItemAdminPassword").value;
        if (!adminPassword) {
          $("ruleItemEditError").textContent = "관리자 비밀번호를 입력하십시오.";
          return;
        }
        $("ruleItemEditSubmitBtn").disabled = true;
        $("ruleItemEditError").textContent = "";
        try {
          const res = await apiPost("updateRuleItem", {
            admin_password: adminPassword,
            item_id: itemId,
            item_title: $("editItemTitle").value.trim(),
            item_text: $("editItemText").value.trim(),
            required: $("editItemRequired").value,
            non_compliance_level: $("editItemLevel").value,
            check_cycle: $("editItemCycle").value,
            evidence_required: $("editItemEvidence").value,
            active: $("editItemActive").value,
          });
          if (!res.ok) throw new Error(res.error?.message || "수정 실패");
          showToast("항목이 수정되었습니다: " + itemId);
          closeRuleItemEditModal();
          await loadAdminRuleItems();
        } catch (err) {
          $("ruleItemEditError").textContent = err.message;
        } finally {
          $("ruleItemEditSubmitBtn").disabled = false;
        }
      }

      async function loadAdminWeek() {
        const year = $("adminYear").value;
        const week = $("adminWeek").value;
        if (!year || !week) {
          showToast("연도/주차를 입력하십시오.");
          return;
        }
        $("adminSummaryBox").textContent = "조회 중입니다...";
        $("adminSiteTableBody").innerHTML = "";
        $("adminHqPdfLink").style.display = "none";
        try {
          const res = await apiGet("getWeeklyMonitoringSummary", {
            inspectionYear: year,
            inspectionWeek: week,
          });
          if (!res.ok) throw new Error(res.error?.message || "조회 실패");
          renderAdminSummary(res.data);
          renderAdminSites(res.data.sites || []);
        } catch (err) {
          $("adminSummaryBox").textContent = "조회 오류: " + err.message;
          showToast("조회 오류: " + err.message);
        }
      }
      function renderAdminSummary(data) {
        $("adminSummaryBox").innerHTML = `
          <div class="summary-line"><span>대상 현장</span><span>${data.expected_site_count}</span></div>
          <div class="summary-line"><span>제출 현장</span><span>${data.submitted_site_count}</span></div>
          <div class="summary-line bad"><span>미제출 현장</span><span>${data.missing_site_count}</span></div>
          <div class="summary-line"><span>제출률</span><span>${data.submit_rate}%</span></div>
          <div class="summary-line bad"><span>중대 미이행</span><span>${data.critical_count}</span></div>
        `;
      }
      function renderAdminSites(sites) {
        const body = $("adminSiteTableBody");
        if (!sites.length) {
          body.innerHTML =
            '<tr><td colspan="8" class="muted">데이터가 없습니다.</td></tr>';
          return;
        }
        body.innerHTML = sites
          .map((s) => {
            const fileId = extractDriveFileId(s.pdf_url);
            const pdfCell = s.pdf_url
              ? `<a href="${escapeAttr(s.pdf_url)}" target="_blank" rel="noopener">열기</a>` +
                (fileId
                  ? ` / <a href="${escapeAttr(driveDirectDownloadUrl(fileId))}" target="_blank" rel="noopener">다운로드</a>`
                  : "")
              : "-";
            const pillClass = s.submit_status === "미제출" ? "req" : "new";
            return `<tr>
              <td>${escapeHtml(s.site_name)}</td>
              <td>${escapeHtml(s.division || "")}</td>
              <td>${escapeHtml(s.contract_type || "")}</td>
              <td><span class="pill ${pillClass}">${escapeHtml(s.submit_status)}</span></td>
              <td>${escapeHtml(s.submitted_at || "-")}</td>
              <td>${escapeHtml(s.overall_status || "-")}</td>
              <td>${escapeHtml(String(s.non_compliant_count ?? 0))}</td>
              <td>${pdfCell}</td>
            </tr>`;
          })
          .join("");
      }
      async function generateHqPdf() {
        const year = $("adminYear").value;
        const week = $("adminWeek").value;
        if (!year || !week) {
          showToast("연도/주차를 입력하십시오.");
          return;
        }
        $("adminGenerateHqPdfBtn").disabled = true;
        try {
          const res = await apiGet("generateWeeklyMonitoringPdf", {
            inspectionYear: year,
            inspectionWeek: week,
          });
          if (!res.ok) throw new Error(res.error?.message || "생성 실패");
          const link = $("adminHqPdfLink");
          link.href = res.data.pdf_url;
          link.style.display = "";
          showToast("본사 마스터 PDF 생성 완료");
        } catch (err) {
          showToast("본사 PDF 생성 오류: " + err.message);
        } finally {
          $("adminGenerateHqPdfBtn").disabled = false;
        }
      }

      $("reloadBtn").addEventListener("click", () => location.reload());
      $("nextBtn").addEventListener("click", goNextTrigger);
      $("submitBtn").addEventListener("click", submitInspection);
      $("submitterName").addEventListener("input", () =>
        $("submitterName").classList.remove("field-error"),
      );
      $("submitterEmail").addEventListener("input", () =>
        $("submitterEmail").classList.remove("field-error"),
      );
      $("lawModalClose").addEventListener("click", closeLawModal);
      $("lawModalCloseBtn").addEventListener("click", closeLawModal);
      $("lawModal").addEventListener("click", (e) => {
        if (e.target === $("lawModal")) closeLawModal();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !$("lawModal").classList.contains("hidden"))
          closeLawModal();
      });
      $("logoutBtn").addEventListener("click", logout);
      $("adminLogoutBtn").addEventListener("click", logout);
      $("loginSubmitBtn").addEventListener("click", attemptLogin);
      $("loginPassword").addEventListener("keydown", (e) => {
        if (e.key === "Enter") attemptLogin();
      });
      $("adminLoadBtn").addEventListener("click", loadAdminWeek);
      $("adminGenerateHqPdfBtn").addEventListener("click", generateHqPdf);
      $("adminAddSiteBtn").addEventListener("click", openAddSiteModal);
      $("addSiteModalClose").addEventListener("click", closeAddSiteModal);
      $("addSiteSubmitBtn").addEventListener("click", submitAddSite);
      $("addSiteModal").addEventListener("click", (e) => {
        if (e.target === $("addSiteModal")) closeAddSiteModal();
      });
      document.addEventListener("keydown", (e) => {
        if (
          e.key === "Escape" &&
          !$("addSiteModal").classList.contains("hidden")
        )
          closeAddSiteModal();
      });
      $("deleteSiteModalClose").addEventListener("click", closeDeleteSiteModal);
      $("deleteSiteSubmitBtn").addEventListener("click", submitDeleteSite);
      $("deleteSiteModal").addEventListener("click", (e) => {
        if (e.target === $("deleteSiteModal")) closeDeleteSiteModal();
      });
      $("changePasswordBtn").addEventListener("click", () =>
        openChangePasswordModal("site"),
      );
      $("adminChangePasswordBtn").addEventListener("click", () =>
        openChangePasswordModal("admin"),
      );
      $("changePasswordModalClose").addEventListener(
        "click",
        closeChangePasswordModal,
      );
      $("changePasswordSubmitBtn").addEventListener(
        "click",
        submitChangePassword,
      );
      $("changePasswordModal").addEventListener("click", (e) => {
        if (e.target === $("changePasswordModal")) closeChangePasswordModal();
      });
      $("ruleItemTriggerFilter").addEventListener("change", renderRuleItemTable);
      $("ruleItemEditModalClose").addEventListener(
        "click",
        closeRuleItemEditModal,
      );
      $("ruleItemEditSubmitBtn").addEventListener("click", submitRuleItemEdit);
      $("ruleItemEditModal").addEventListener("click", (e) => {
        if (e.target === $("ruleItemEditModal")) closeRuleItemEditModal();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (!$("deleteSiteModal").classList.contains("hidden"))
          closeDeleteSiteModal();
        if (!$("changePasswordModal").classList.contains("hidden"))
          closeChangePasswordModal();
        if (!$("ruleItemEditModal").classList.contains("hidden"))
          closeRuleItemEditModal();
      });
      wireWorkforceBox();
      wireSiteConfirmBox();

      const savedRole = sessionStorage.getItem("authRole");
      if (savedRole === "site" || savedRole === "admin") {
        showApp(savedRole);
      }
