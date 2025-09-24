function simulateClick(element) {
    const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
    });
    element.dispatchEvent(event);
}

function getNormalizedText(node) {
    return (node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();
}

function generateKeywordList(raw) {
    return (raw || "")
        .split(/\s+/)
        .map(keyword => keyword.trim())
        .filter(Boolean);
}

function normalizeForPriceComparison(text) {
    return text.replace(/[\s,，]/g, "").toLowerCase();
}

function findTicketContainer(element) {
    const selector = [
        '[class*="ticket"]',
        '[class*="Ticket"]',
        '[class*="fare"]',
        '[class*="Fare"]',
        '[class*="plan"]',
        '[class*="Plan"]',
        '[class*="row"]',
        '[class*="Row"]',
        '[class*="item"]',
        '[class*="Item"]',
        '[class*="card"]',
        '[class*="Card"]',
        'li',
        'tr',
        'section',
        'article',
    ].join(', ');

    let container = element.closest(selector) || element.parentElement;

    while (container && container !== document.body) {
        const text = getNormalizedText(container);
        if (text && text.length <= 1600 && /\d/.test(text)) {
            return container;
        }
        container = container.parentElement;
    }

    return null;
}

function isPotentialTicketContainer(text) {
    if (!text) {
        return false;
    }
    const lower = text.toLowerCase();
    const hasPrice = /\d/.test(text) && (lower.includes("nt") || text.includes("$") || lower.includes("元"));
    const hasTicketKeyword = /票|seat|區|席|zone|張/i.test(lower);
    return hasPrice || hasTicketKeyword;
}

function collectTicketContainers() {
    const interactiveSelectors = [
        'button',
        'select',
        'input[type="number"]',
        'input[role="spinbutton"]',
        '[role="button"]',
    ].join(', ');

    const interactiveElements = Array.from(document.querySelectorAll(interactiveSelectors));
    const containers = [];
    const seen = new Set();

    for (const element of interactiveElements) {
        const container = findTicketContainer(element);
        if (!container || seen.has(container)) {
            continue;
        }

        const text = getNormalizedText(container);
        if (!isPotentialTicketContainer(text)) {
            continue;
        }

        seen.add(container);
        containers.push(container);
    }

    return containers;
}

function reorderTicketContainers(containers, order) {
    const cloned = [...containers];
    switch (order) {
        case "bottom-up":
            return cloned.reverse();
        case "middle":
            const mid = Math.floor(cloned.length / 2);
            return [...cloned.slice(mid), ...cloned.slice(0, mid)];
        case "top-down":
        default:
            return cloned;
    }
}

function shouldSkipTicket(text) {
    const lower = text.toLowerCase();
    const soldOutKeywords = [
        "已售完",
        "售罄",
        "sold out",
        "暫無",
        "無法購買",
        "完售",
        "額滿",
        "未開賣",
        "敬請期待",
        "not available",
    ];

    const excludeKeywords = [
        "輪椅",
        "身心",
        "無障礙",
        "wheelchair",
        "disabled",
        "愛心",
    ];

    if (soldOutKeywords.some(keyword => lower.includes(keyword))) {
        return true;
    }

    return excludeKeywords.some(keyword => lower.includes(keyword));
}

function buttonHasPlusIntent(button) {
    const text = (button.textContent || "").trim();
    const aria = (button.getAttribute("aria-label") || button.title || "").trim();
    const datasetValues = Object.values(button.dataset || {}).join(" ");
    const classNames = Array.from(button.classList || []).join(" ");

    const combined = `${text} ${aria} ${datasetValues} ${classNames}`.toLowerCase();
    const keywords = ["+", "＋", "add", "increase", "plus", "加", "增加", "加購"];

    if (keywords.some(keyword => combined.includes(keyword))) {
        return true;
    }

    const svgTitle = button.querySelector('svg title');
    if (svgTitle) {
        const svgText = svgTitle.textContent.toLowerCase();
        if (keywords.some(keyword => svgText.includes(keyword))) {
            return true;
        }
    }

    return false;
}

function findPlusButton(container) {
    const buttons = Array.from(container.querySelectorAll('button, [role="button"]'));
    return buttons.find(buttonHasPlusIntent) || null;
}

function buttonHasMinusIntent(button) {
    const text = (button.textContent || "").trim();
    const aria = (button.getAttribute("aria-label") || button.title || "").trim();
    const datasetValues = Object.values(button.dataset || {}).join(" ");
    const classNames = Array.from(button.classList || []).join(" ");

    const trimmedText = text.replace(/\s+/g, "");
    if (trimmedText === "-" || trimmedText === "－") {
        return true;
    }

    const combined = `${text} ${aria} ${datasetValues} ${classNames}`.toLowerCase();
    const keywords = [
        "minus",
        "decrease",
        "reduce",
        "less",
        "lower",
        "subtract",
        "減",
        "減少",
        "扣",
    ];

    if (keywords.some(keyword => combined.includes(keyword))) {
        return true;
    }

    const svgTitle = button.querySelector('svg title');
    if (svgTitle) {
        const svgText = svgTitle.textContent.toLowerCase();
        if (keywords.some(keyword => svgText.includes(keyword))) {
            return true;
        }
    }

    return false;
}

function findMinusButton(container) {
    const buttons = Array.from(container.querySelectorAll('button, [role="button"]'));
    return buttons.find(buttonHasMinusIntent) || null;
}

const MAX_REASONABLE_TICKET_COUNT = 100;
const BUTTON_CLICK_INTERVAL = 140;
const MAX_QUANTITY_RETRY = 3;

function parseQuantityValue(raw) {
    if (raw === null || raw === undefined) {
        return NaN;
    }

    if (typeof raw === "number") {
        return Number.isFinite(raw) ? raw : NaN;
    }

    const sanitized = String(raw).replace(/[，,]/g, "").trim();
    const match = sanitized.match(/-?\d+/);
    if (!match) {
        return NaN;
    }

    return Number(match[0]);
}

function isValidQuantityValue(value) {
    return Number.isFinite(value) && value >= 0 && value <= MAX_REASONABLE_TICKET_COUNT;
}

function extractCountFromElement(element) {
    if (!element) {
        return NaN;
    }

    const candidates = [];

    if (typeof element.value === "number" || typeof element.value === "string") {
        candidates.push(element.value);
    }

    if (typeof element.getAttribute === "function") {
        const attrNames = ["value", "data-value", "aria-valuenow", "aria-valuetext"];
        for (const name of attrNames) {
            const attrValue = element.getAttribute(name);
            if (attrValue !== null && attrValue !== undefined) {
                candidates.push(attrValue);
            }
        }
    }

    if (typeof element.textContent === "string") {
        candidates.push(element.textContent);
    }

    for (const candidate of candidates) {
        const parsed = parseQuantityValue(candidate);
        if (isValidQuantityValue(parsed)) {
            return parsed;
        }
    }

    return NaN;
}

function isValidQuantityElement(element) {
    if (!element || element === document.body) {
        return false;
    }

    const tagName = element.tagName ? element.tagName.toLowerCase() : "";
    if (tagName === "select") {
        return false;
    }

    if (tagName === "input") {
        const type = (element.getAttribute("type") || "").toLowerCase();
        if (type && type !== "number" && type !== "text") {
            return false;
        }
        return true;
    }

    const value = extractCountFromElement(element);
    if (isValidQuantityValue(value)) {
        return true;
    }

    const text = (element.textContent || "").trim();
    return /^\d+$/.test(text);
}

function findQuantityElement(container, plusButton) {
    if (!container || typeof container.querySelector !== "function") {
        return null;
    }

    const selectors = [
        'input[type="number"]',
        'input[role="spinbutton"]',
        'input[name*="quantity" i]',
        'input[name*="count" i]',
        '[role="spinbutton"]',
        '[aria-valuenow]',
        '[data-quantity]',
        '[data-qty]',
        '[data-count]'
    ];

    for (const selector of selectors) {
        const candidate = container.querySelector(selector);
        if (candidate && candidate !== plusButton && isValidQuantityElement(candidate)) {
            return candidate;
        }
    }

    if (plusButton) {
        const neighborCandidates = new Set();
        neighborCandidates.add(plusButton.previousElementSibling);
        neighborCandidates.add(plusButton.nextElementSibling);

        if (plusButton.parentElement) {
            neighborCandidates.add(plusButton.parentElement);
            neighborCandidates.add(plusButton.parentElement.previousElementSibling);
            neighborCandidates.add(plusButton.parentElement.querySelector('input[type="number"]'));
            neighborCandidates.add(plusButton.parentElement.querySelector('[role="spinbutton"]'));
        }

        for (const neighbor of neighborCandidates) {
            if (!neighbor || neighbor === plusButton) {
                continue;
            }

            if (neighbor.querySelector) {
                const nested = neighbor.querySelector('input[type="number"], input[role="spinbutton"], [role="spinbutton"], [aria-valuenow]');
                if (nested && nested !== plusButton && isValidQuantityElement(nested)) {
                    return nested;
                }
            }

            if (isValidQuantityElement(neighbor)) {
                return neighbor;
            }
        }
    }

    return null;
}

function scrollIntoViewIfPossible(element) {
    if (!element || typeof element.scrollIntoView !== "function") {
        return;
    }

    try {
        element.scrollIntoView({ behavior: "instant", block: "center" });
    } catch (error) {
        try {
            element.scrollIntoView({ behavior: "auto", block: "center" });
        } catch (fallbackError) {
            element.scrollIntoView();
        }
    }
}

function enableElement(element) {
    if (!element) {
        return;
    }

    if (typeof element.removeAttribute === "function") {
        if (element.hasAttribute && element.hasAttribute("disabled")) {
            element.removeAttribute("disabled");
        }

        if (element.getAttribute && element.getAttribute("aria-disabled") === "true") {
            element.setAttribute("aria-disabled", "false");
        }

        if (element.hasAttribute && element.hasAttribute("readonly")) {
            element.removeAttribute("readonly");
        }
    }
}

function scheduleButtonClicks(button, times, initialDelay = 0) {
    if (!button) {
        return;
    }

    const sanitizedTimes = Math.max(0, Math.floor(times));
    if (sanitizedTimes <= 0) {
        return;
    }

    for (let i = 0; i < sanitizedTimes; i += 1) {
        setTimeout(() => {
            enableElement(button);
            scrollIntoViewIfPossible(button);
            simulateClick(button);
        }, initialDelay + (i * BUTTON_CLICK_INTERVAL));
    }
}

function setQuantityElementValue(element, target) {
    if (!element) {
        return false;
    }

    scrollIntoViewIfPossible(element);
    enableElement(element);

    const newValue = String(target);

    if (typeof element.value === "string" || typeof element.value === "number") {
        element.value = newValue;
    }

    if (typeof element.setAttribute === "function") {
        element.setAttribute("value", newValue);

        if (element.getAttribute("aria-valuenow") !== null) {
            element.setAttribute("aria-valuenow", newValue);
        }

        if (element.getAttribute("aria-valuetext") !== null) {
            element.setAttribute("aria-valuetext", newValue);
        }
    }

    if (!("value" in element) && typeof element.textContent === "string") {
        element.textContent = newValue;
    }

    if (typeof element.dispatchEvent === "function") {
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
    }

    return true;
}

function tryExpandTicketContainer(container) {
    if (!container || typeof container.querySelectorAll !== "function") {
        return false;
    }

    const elements = Array.from(container.querySelectorAll('button, [role="button"], [aria-expanded], [data-state]'));

    for (const element of elements) {
        if (!element || element === container) {
            continue;
        }

        if (buttonHasPlusIntent(element) || buttonHasMinusIntent(element)) {
            continue;
        }

        const tagName = element.tagName ? element.tagName.toLowerCase() : "";
        if (tagName === "a" && element.hasAttribute && element.hasAttribute("href")) {
            const href = element.getAttribute("href");
            if (href && href !== "#") {
                continue;
            }
        }

        const ariaExpanded = element.getAttribute ? element.getAttribute("aria-expanded") : null;
        const dataState = element.getAttribute ? element.getAttribute("data-state") : null;
        const ariaPressed = element.getAttribute ? element.getAttribute("aria-pressed") : null;

        const text = (element.innerText || element.textContent || "").trim().toLowerCase();
        const aria = (element.getAttribute ? (element.getAttribute("aria-label") || element.title || "") : "").trim().toLowerCase();
        const datasetValues = Object.values(element.dataset || {}).join(" ").toLowerCase();
        const combined = `${text} ${aria} ${datasetValues}`;

        const keywords = ["展開", "選擇", "開啟", "顯示", "更多", "詳情", "select", "choose", "open", "detail", "expand"];
        const shouldToggle = (
            (ariaExpanded && ariaExpanded.toLowerCase() === "false") ||
            (dataState && /closed|collapse/i.test(dataState)) ||
            (ariaPressed && ariaPressed.toLowerCase() === "false") ||
            keywords.some(keyword => combined.includes(keyword))
        );

        if (!shouldToggle) {
            continue;
        }

        scrollIntoViewIfPossible(element);
        enableElement(element);
        simulateClick(element);
        return true;
    }

    const containerAriaExpanded = container.getAttribute ? container.getAttribute("aria-expanded") : null;
    if (containerAriaExpanded && containerAriaExpanded.toLowerCase() === "false") {
        scrollIntoViewIfPossible(container);
        simulateClick(container);
        return true;
    }

    return false;
}

function setTicketQuantity(container, rawCount, attempt = 0) {
    const count = parseInt(rawCount, 10);
    if (!Number.isFinite(count) || count <= 0) {
        return false;
    }

    if (!container || typeof container.querySelector !== "function") {
        return false;
    }

    scrollIntoViewIfPossible(container);

    let plusButton = findPlusButton(container);

    if (!plusButton && attempt < MAX_QUANTITY_RETRY) {
        const expanded = tryExpandTicketContainer(container);
        if (expanded) {
            console.log("📂 展開票券區塊，等待張數控制顯示");
            setTimeout(() => {
                setTicketQuantity(container, count, attempt + 1);
            }, BUTTON_CLICK_INTERVAL * 2);
            return true;
        }
    }

    if (!plusButton) {
        plusButton = findPlusButton(container);
    }

    const minusButton = findMinusButton(container);
    const quantityElement = findQuantityElement(container, plusButton);
    const currentQuantity = extractCountFromElement(quantityElement);

    if (Number.isFinite(currentQuantity)) {
        console.log(`🎯 票券張數：目前 ${currentQuantity}，目標 ${count}`);
        const difference = count - currentQuantity;

        if (difference === 0) {
            return true;
        }

        if (difference > 0 && plusButton) {
            console.log(`➕ 點擊加號 ${difference} 次`);
            scheduleButtonClicks(plusButton, difference);
            return true;
        }

        if (difference < 0 && minusButton) {
            console.log(`➖ 點擊減號 ${Math.abs(difference)} 次`);
            scheduleButtonClicks(minusButton, Math.abs(difference));
            return true;
        }

        if (quantityElement && setQuantityElementValue(quantityElement, count)) {
            console.log("✏️ 直接設定票券張數");
            return true;
        }
    }

    if (quantityElement && setQuantityElementValue(quantityElement, count)) {
        console.log("✏️ 直接設定票券張數");
        return true;
    }

    if (plusButton) {
        console.log(`➕ 無法讀取目前張數，預設點擊加號 ${count} 次`);
        scheduleButtonClicks(plusButton, count);
        return true;
    }

    const select = container.querySelector('select');
    if (select) {
        const matchedOption = Array.from(select.options).find(opt => {
            const optionValue = parseQuantityValue(opt.value);
            const optionText = parseQuantityValue(opt.textContent || "");
            return optionValue === count || optionText === count;
        });

        if (matchedOption) {
            select.value = matchedOption.value;
            select.dispatchEvent(new Event('input', { bubbles: true }));
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
    }

    const numberInput = Array.from(container.querySelectorAll('input[type="number"], input[role="spinbutton"]'))
        .find(input => !input.disabled);

    if (numberInput) {
        enableElement(numberInput);
        numberInput.value = count;
        numberInput.dispatchEvent(new Event('input', { bubbles: true }));
        numberInput.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    return false;
}

function escapeCssIdentifier(value) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(value);
    }
    return value.replace(/([\.\#\[\]:])/g, "\\$1");
}

function getAssociatedLabelText(input) {
    if (!input) {
        return "";
    }

    const id = input.id;
    if (id) {
        const escaped = escapeCssIdentifier(id);
        const label = document.querySelector(`label[for="${escaped}"]`);
        if (label) {
            return label.innerText || label.textContent || "";
        }
    }

    const closestLabel = input.closest('label');
    if (closestLabel) {
        return closestLabel.innerText || closestLabel.textContent || "";
    }

    const parentText = input.parentElement ? (input.parentElement.innerText || input.parentElement.textContent || "") : "";
    return parentText;
}

function agreeToTerms() {
    const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    const target = checkboxes.find((checkbox) => {
        const labelText = getAssociatedLabelText(checkbox).toLowerCase();
        if (!labelText) {
            return false;
        }
        return labelText.includes("同意") || labelText.includes("已閱讀") || labelText.includes("terms");
    });

    if (target && !target.checked) {
        simulateClick(target);
        console.log("☑️ 已勾選同意條款");
        return true;
    }

    return false;
}

function clickNextStepButton() {
    const keywords = [
        "下一步",
        "下一頁",
        "下一步驟",
        "填寫資料",
        "前往付款",
        "立即結帳",
        "確認訂單",
        "Proceed",
        "Next",
    ];

    const elements = Array.from(document.querySelectorAll('button, [role="button"], a[href]'));
    const target = elements.find((element) => {
        if (element.disabled || element.getAttribute('aria-disabled') === 'true') {
            return false;
        }

        const text = (element.innerText || element.textContent || "").trim();
        const aria = (element.getAttribute('aria-label') || element.title || "").trim();
        const datasetValues = Object.values(element.dataset || {}).join(" ");
        const combined = `${text} ${aria} ${datasetValues}`.toLowerCase();

        if (combined.includes("上一步")) {
            return false;
        }

        return keywords.some(keyword => combined.includes(keyword.toLowerCase()));
    });

    if (target) {
        simulateClick(target);
        console.log("🎯 點擊下一步按鈕");
        return true;
    }

    console.warn("⚠️ 找不到下一步按鈕");
    return false;
}

function trySelectTicket(setting) {
    const nameKeywords = generateKeywordList(setting.name).map(keyword => keyword.toLowerCase());
    const priceKeywords = generateKeywordList(setting.price).map(keyword => keyword.toLowerCase());
    const count = Number(setting.count) || 1;

    let ticketContainers = collectTicketContainers();
    if (ticketContainers.length === 0) {
        return false;
    }

    ticketContainers = reorderTicketContainers(ticketContainers, setting.priceOrder);

    for (const container of ticketContainers) {
        const text = getNormalizedText(container);
        if (!text) {
            continue;
        }

        if (shouldSkipTicket(text)) {
            continue;
        }

        const textLower = text.toLowerCase();
        const priceComparable = normalizeForPriceComparison(text);

        const matchName = nameKeywords.length === 0 || nameKeywords.some(keyword => textLower.includes(keyword));
        const matchPrice = priceKeywords.length === 0 || priceKeywords.some(keyword => priceComparable.includes(keyword.replace(/[\s,，]/g, "")));

        if (!matchName && !matchPrice) {
            continue;
        }

        const success = setTicketQuantity(container, count);
        if (success) {
            console.log("✅ 已選擇票種", text);
            const delay = Math.max(600, count * 120);
            setTimeout(() => {
                agreeToTerms();
                clickNextStepButton();
            }, delay);
            return true;
        }
    }

    return false;
}

function startTicketScript() {
    chrome.storage.local.get(["ticketplus_settings", "botEnabled"], (data) => {
        const setting = data.ticketplus_settings;
        const botEnabled = data.botEnabled;

        if (!botEnabled) {
            console.log("⏸️ 機器人目前關閉中，跳過搶票流程");
            return;
        }

        if (!setting) {
            console.log("⚠️ 尚未設定搶票條件");
            return;
        }

        const success = trySelectTicket(setting);
        if (!success) {
            if (setting.autoReload) {
                console.log("沒有符合條件的票券，準備自動重新整理...");
                setTimeout(() => {
                    location.reload();
                }, 1000);
            } else {
                console.warn("找不到符合條件的票券");
            }
        }
    });
}

function injectScript(filePath) {
    const script = document.createElement("script");
    script.setAttribute("type", "text/javascript");
    script.src = chrome.runtime.getURL(filePath);
    document.documentElement.appendChild(script);
    script.remove();
}

function waitForTicketData() {
    let attempts = 0;
    const MAX_ATTEMPTS = 20;

    const interval = setInterval(() => {
        attempts += 1;
        const containers = collectTicketContainers();
        if (containers.length > 0) {
            console.log("✅ 票券資訊載入完成");
            clearInterval(interval);
            startTicketScript();
            return;
        }

        if (attempts >= MAX_ATTEMPTS) {
            clearInterval(interval);
            console.warn("⚠️ 未偵測到票券資訊，仍嘗試執行腳本");
            startTicketScript();
            return;
        }

        console.log("⌛ 等待票券載入中...");
    }, 500);
}

(function init() {
    const path = window.location.pathname;
    if (!/(activity|event)/i.test(path) || !/\/order/i.test(path)) {
        return;
    }

    injectScript("inject.js");
    waitForTicketData();
})();
