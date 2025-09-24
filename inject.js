// inject.js
(function() {
    const originalAlert = window.alert;
    window.alert = function(message) {
        console.log("🔥 攔截到 alert:", message);
        const text = String(message || "");
        const shouldReload = /票券已全部售出|目前沒有可以購買的票券|快你一步|售完|無法購買|沒有可購買的票券/i.test(text);
        if (shouldReload) {
            location.reload();
        } else {
            originalAlert(message);
        }
    };
})();