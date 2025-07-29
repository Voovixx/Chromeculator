(async () => {
    try {
        const syncData = await chrome.storage.sync.get('settings');
        if (syncData.settings && syncData.settings.syncEnabled) {
            if (syncData.settings.theme === 'dark') {
                document.body.classList.add('dark-theme');
            }
        } else {
            const localData = await chrome.storage.local.get('settings');
            if (localData.settings && localData.settings.theme === 'dark') {
                document.body.classList.add('dark-theme');
            }
        }
    } catch (e) {
        console.warn("Could not pre-apply theme:", e);
    }
})();