chrome.action.onClicked.addListener(async (tab) => {
    if (!tab.id || !tab.url?.startsWith("http")) {
        return;
    }

    try {
        await chrome.tabs.sendMessage(tab.id, { type: "speed-reader:toggle" });
    } catch (error) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ["content.js"],
            });
        } catch (injectionError) {
            console.error("Speed Reader could not open on this page.", injectionError, error);
        }
    }
});
