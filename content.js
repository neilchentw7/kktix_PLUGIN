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

function generateDateVariants(rawDate) {
    if (!rawDate) {
        return [];
    }

    const trimmed = rawDate.trim();
    if (!trimmed) {
        return [];
    }

    const variants = new Set([trimmed]);

    const normalized = trimmed.replace(/[.\-]/g, "/");
    variants.add(normalized);

    const parts = normalized.split("/").filter(Boolean);
    if (parts.length === 3) {
        const [, month, day] = parts;
        if (month && day) {
            variants.add(`${month.padStart(2, "0")}/${day.padStart(2, "0")}`);
            variants.add(`${parseInt(month, 10)}/${parseInt(day, 10)}`);
        }
    } else if (parts.length === 2) {
        const [month, day] = parts;
        if (month && day) {
            variants.add(`${parseInt(month, 10)}/${parseInt(day, 10)}`);
        }
    }

    return Array.from(variants)
        .map(text => text.replace(/\s+/g, " ").trim())
        .filter(Boolean);
}

function isActionTrigger(element) {
    const aria = (element.getAttribute("aria-label") || element.getAttribute("title") || "").trim();
    const text = (element.textContent || "").trim();
    const keywords = [
        "購票",
        "立即購票",
        "搶票",
        "搶購",
        "買票",
        "訂購",
        "立即訂購",
        "前往購票",
        "前往購買",
        "buy",
        "tickets",
        "立即",
        "選購",
        "立刻購買",
    ];

    const combined = `${text} ${aria}`.toLowerCase();
    return keywords.some(keyword => combined.includes(keyword.toLowerCase()));
}

function findContextContainer(element) {
    const preferredSelector = [
        '[class*="session"]',
        '[class*="Session"]',
        '[class*="list"]',
        '[class*="List"]',
        '[class*="item"]',
        '[class*="Item"]',
        '[class*="card"]',
        '[class*="Card"]',
        'article',
        'section',
        'li',
    ].join(', ');

    let container = element.closest(preferredSelector) || element.parentElement;

    while (container && container !== document.body) {
        const text = getNormalizedText(container);
        if (text && text.length <= 1500) {
            return container;
        }
        container = container.parentElement;
    }

    return element;
}

function collectCandidateSessions() {
    const triggers = Array.from(document.querySelectorAll('a[href], button, [role="button"]'))
        .filter(element => isActionTrigger(element));

    const uniqueContainers = new Set();
    const candidates = [];

    for (const trigger of triggers) {
        const container = findContextContainer(trigger);
        if (!container || uniqueContainers.has(container)) {
            continue;
        }

        const contextText = getNormalizedText(container);
        if (!contextText) {
            continue;
        }

        uniqueContainers.add(container);
        candidates.push({ trigger, container, contextText, normalizedText: contextText.toLowerCase() });
    }

    return candidates;
}

function reorderItems(items, orderType) {
    const cloned = [...items];
    switch (orderType) {
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

function attemptAutoNavigate(settings, attempt = 1) {
    const MAX_ATTEMPTS = 10;
    const { date, session, dateOrder } = settings;
    const sessionKeywords = (session || "").split(/\s+/).filter(Boolean).map(keyword => keyword.toLowerCase());
    const dateVariants = generateDateVariants(date).map(variant => variant.toLowerCase());

    const rawItems = collectCandidateSessions();
    if (rawItems.length === 0) {
        if (attempt < MAX_ATTEMPTS) {
            setTimeout(() => attemptAutoNavigate(settings, attempt + 1), 500);
        } else {
            console.warn("找不到任何可購票的場次按鈕");
        }
        return;
    }

    const items = reorderItems(rawItems, dateOrder);

    const matchesSession = (text) => (
        sessionKeywords.length === 0 || sessionKeywords.some(keyword => text.includes(keyword))
    );

    const matchesDate = (text) => (
        dateVariants.length === 0 || dateVariants.some(variant => text.includes(variant))
    );

    for (const { trigger, normalizedText } of items) {
        if (!matchesDate(normalizedText) || !matchesSession(normalizedText)) {
            continue;
        }

        if (trigger.tagName === "A" && trigger.href) {
            console.log("✅ 導向符合條件的場次", trigger.href);
            window.location.href = trigger.href;
        } else {
            console.log("✅ 點擊符合條件的場次按鈕");
            simulateClick(trigger);
        }
        return;
    }

    if (sessionKeywords.length === 0 && dateVariants.length === 0) {
        const { trigger } = items[0];
        if (trigger.tagName === "A" && trigger.href) {
            console.log("未設定過濾條件，預設導向第一個場次", trigger.href);
            window.location.href = trigger.href;
        } else {
            console.log("未設定過濾條件，預設點擊第一個場次按鈕");
            simulateClick(trigger);
        }
        return;
    }

    if (attempt < MAX_ATTEMPTS) {
        console.log("尚未找到符合條件的場次，稍後再試...");
        setTimeout(() => attemptAutoNavigate(settings, attempt + 1), 500);
    } else {
        console.warn("多次嘗試後仍未找到符合條件的場次");
    }
}

(function runContentScript() {
    const path = window.location.pathname;
    if (!/(activity|event)/i.test(path) || /\/order/i.test(path)) {
        return;
    }

    chrome.storage.local.get(["ticketplus_settings", "botEnabled"], (data) => {
        const settings = data.ticketplus_settings;
        const botEnabled = data.botEnabled;

        if (!botEnabled) {
            console.log("⏸️ 機器人目前關閉中，跳過自動導向");
            return;
        }

        if (!settings) {
            console.log("⚠️ 尚未設定搶票條件");
            return;
        }

        attemptAutoNavigate(settings);
    });
})();
