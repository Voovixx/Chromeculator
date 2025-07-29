document.addEventListener('DOMContentLoaded', async () => {
    if (typeof i18n === 'undefined') {
        document.body.innerHTML = "Critical Error: i18n library not found.";
        return;
    }
    
    const saveButton = document.getElementById('save');
    const languageSelect = document.getElementById('languageSelect');
    const themeSelect = document.getElementById('theme');
    const decimalPlacesInput = document.getElementById('decimalPlaces');
    const enableSyncInput = document.getElementById('enableSync');
    const showKeypadInput = document.getElementById('showKeypad');
    const saveHistoryInput = document.getElementById('saveHistory');
    const historyDaysInput = document.getElementById('historyDays');
    const customConstantsInput = document.getElementById('customConstants');
    const customFunctionsInput = document.getElementById('customFunctions');
    const statusDiv = document.getElementById('status');
    let storage = chrome.storage.local;
    let currentLang = 'en';

    function applyTranslations() {
        const translations = i18n[currentLang] || i18n['en'];
        document.querySelectorAll('[data-i18n-key]').forEach(el => {
            const key = el.getAttribute('data-i18n-key');
            if (translations[key]) el.textContent = translations[key];
        });
        document.querySelectorAll('[data-i18n-title-key]').forEach(el => {
            const key = el.getAttribute('data-i18n-title-key');
            if (translations[key]) el.title = translations[key];
        });
        document.title = translations.optionsTitle || 'Calculator Options';
    }
    
    async function loadOptions() {
        const syncCheck = await chrome.storage.sync.get('settings');
        const syncEnabled = syncCheck.settings && syncCheck.settings.syncEnabled;
        storage = syncEnabled ? chrome.storage.sync : chrome.storage.local;
        const data = await storage.get('settings');
        const settings = data.settings || {};

        currentLang = settings.language || 'en';
        languageSelect.value = currentLang;
        themeSelect.value = settings.theme || 'light';
        decimalPlacesInput.value = typeof settings.decimalPlaces !== 'undefined' ? settings.decimalPlaces : 2;
        enableSyncInput.checked = syncEnabled;
        showKeypadInput.checked = typeof settings.showKeypad !== 'undefined' ? settings.showKeypad : true;
        saveHistoryInput.checked = typeof settings.saveHistoryEnabled !== 'undefined' ? settings.saveHistoryEnabled : true;
        historyDaysInput.value = settings.historyDays || 7;
        customConstantsInput.value = settings.customConstants || '';
        customFunctionsInput.value = settings.customFunctions || '';

        document.body.classList.toggle('dark-theme', settings.theme === 'dark');
        applyTranslations();
    }

    async function saveOptions() {
        const syncEnabled = enableSyncInput.checked;
        const targetLang = languageSelect.value;
        const settingsToSave = {
            language: targetLang,
            theme: themeSelect.value,
            decimalPlaces: parseInt(decimalPlacesInput.value, 10),
            syncEnabled: syncEnabled,
            showKeypad: showKeypadInput.checked,
            saveHistoryEnabled: saveHistoryInput.checked,
            historyDays: parseInt(historyDaysInput.value, 10),
            customConstants: customConstantsInput.value,
            customFunctions: customFunctionsInput.value
        };

        if (syncEnabled) {
            await chrome.storage.sync.set({ settings: settingsToSave });
            await chrome.storage.local.remove(['settings', 'calculatorHistory', 'userScope']);
        } else {
            await chrome.storage.local.set({ settings: settingsToSave });
            await chrome.storage.sync.set({ settings: { syncEnabled: false, language: targetLang } });
        }
        
        currentLang = targetLang;
        applyTranslations();
        
        statusDiv.textContent = i18n[currentLang].saveStatus;
        setTimeout(() => { statusDiv.textContent = ''; }, 1500);
    }
    
    await loadOptions();
    saveButton.addEventListener('click', saveOptions);
    languageSelect.addEventListener('change', applyTranslations);
    themeSelect.addEventListener('change', () => {
        document.body.classList.toggle('dark-theme', themeSelect.value === 'dark');
    });
});