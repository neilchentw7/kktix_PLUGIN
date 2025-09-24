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

function setTicketQuantity(container, rawCount) {
    const count = Number(rawCount) || 0;
    if (count <= 0) {
        return false;
    }

    const plusButton = findPlusButton(container);
    if (plusButton) {
        for (let i = 0; i < count; i += 1) {
            setTimeout(() => {
                plusButton.removeAttribute("disabled");
                simulateClick(plusButton);
            }, i * 80);
        }
        return true;
    }

    const select = container.querySelector('select');
    if (select) {
        const option = Array.from(select.options).find(opt => {
            const optionValue = opt.value.trim();
            const optionText = (opt.textContent || "").trim();
            return Number(optionValue) === count || Number(optionText) === count;
        });

        if (option) {
            select.value = option.value;
            select.dispatchEvent(new Event('input', { bubbles: true }));
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
    }

    const numberInput = Array.from(container.querySelectorAll('input[type="number"], input[role="spinbutton"]'))
        .find(input => !input.disabled);

    if (numberInput) {
        numberInput.removeAttribute("disabled");
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
