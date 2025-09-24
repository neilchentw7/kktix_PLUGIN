function updateBadge(isEnabled) {
    chrome.action.setBadgeText({ text: isEnabled ? "ON" : "OFF" });
    chrome.action.setBadgeBackgroundColor({
        color: isEnabled ? "#5cb85c" : "#d9534f",
    });
}

function reloadActiveTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length > 0 && typeof tabs[0].id === "number") {
            chrome.tabs.reload(tabs[0].id);
        }
    });
}

function ensureBadgeState() {
    chrome.storage.local.get("botEnabled", (data) => {
        const currentStatus = Boolean(data.botEnabled);
        updateBadge(currentStatus);
        if (typeof data.botEnabled !== "boolean") {
            chrome.storage.local.set({ botEnabled: false });
        }
    });
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({ botEnabled: false });
    chrome.storage.local.remove("kktix_settings");
});

chrome.runtime.onStartup.addListener(() => {
    ensureBadgeState();
});

ensureBadgeState();

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !Object.prototype.hasOwnProperty.call(changes, "botEnabled")) {
        return;
    }

    const { newValue } = changes.botEnabled;
    const normalized = Boolean(newValue);
    updateBadge(normalized);

    if (normalized) {
        reloadActiveTab();
    }
});

chrome.commands.onCommand.addListener((command) => {
    if (command !== "toggle-bot") {
        return;
    }

    chrome.storage.local.get("botEnabled", (data) => {
        const newStatus = !Boolean(data.botEnabled);
        chrome.storage.local.set({ botEnabled: newStatus });
    });
});
