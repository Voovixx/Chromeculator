document.addEventListener('DOMContentLoaded', async function () {
    if (typeof math === 'undefined' || typeof i18n === 'undefined') {
        document.body.innerHTML = "Critical Error: Core libraries not found.";
        return;
    }

    const expressionInput = document.getElementById('expression');
    const historyDiv = document.getElementById('history');
    const clearButton = document.getElementById('clearHistory');
    const exportButton = document.getElementById('exportHistory');
    const copyButton = document.getElementById('copyButton');
    const keypadContainer = document.getElementById('keypad-container');
    const dynamicButtonsContainer = document.getElementById('dynamic-buttons');
    const buttonGrid = document.getElementById('button-grid');

    const parser = math.parser();
    let lastValidResult = null;
    let settings = {};
    let commandHistory = [];
    let historyIndex = -1;
    let storage = chrome.storage.local;
    let currentLang = 'en';
    let translations = i18n[currentLang];

    function applyTranslations() {
        translations = i18n[currentLang] || i18n['en'];
        document.querySelectorAll('[data-i18n-key]').forEach(el => {
            const key = el.getAttribute('data-i18n-key');
            if (translations[key]) el.textContent = translations[key];
        });
        document.querySelectorAll('[data-i18n-title-key]').forEach(el => {
            const key = el.getAttribute('data-i18n-title-key');
            if (translations[key]) el.title = translations[key];
        });
    }

    async function initialize() {
        const syncCheck = await chrome.storage.sync.get('settings');
        if (syncCheck.settings && syncCheck.settings.syncEnabled) {
            storage = chrome.storage.sync;
        }
        const data = await storage.get(['calculatorHistory', 'settings', 'userScope']);
        settings = data.settings || {};
        currentLang = settings.language || 'en';
        if (settings.showKeypad) {
            keypadContainer.classList.remove('hidden');
        }
        if (data.userScope) {
            parser.scope = data.userScope;
        }
        applyTranslations();
        renderDynamicButtons();
        loadCustomCode(settings.customConstants);
        loadCustomCode(settings.customFunctions);
        loadHistory(data.calculatorHistory || []);
    }

    function insertText(text, offset = 0) {
        const start = expressionInput.selectionStart;
        const end = expressionInput.selectionEnd;
        expressionInput.value = expressionInput.value.substring(0, start) + text + expressionInput.value.substring(end);
        expressionInput.selectionStart = expressionInput.selectionEnd = start + text.length - offset;
        expressionInput.focus();
    }

    function renderDynamicButtons() {
        dynamicButtonsContainer.innerHTML = '';
        const functions = ['sin', 'cos', 'tan', 'log', 'sqrt', '^', 'pi', 'e'];
        functions.forEach(fn => {
            const btn = document.createElement('button');
            btn.textContent = fn === 'sqrt' ? '√' : fn;
            btn.dataset.func = fn;
            dynamicButtonsContainer.appendChild(btn);
        });
        Object.keys(parser.scope).forEach(key => {
            if (typeof parser.scope[key] !== 'function' && !functions.includes(key)) {
                const btn = document.createElement('button');
                btn.textContent = key;
                btn.dataset.value = key;
                dynamicButtonsContainer.appendChild(btn);
            }
        });
    }

    dynamicButtonsContainer.addEventListener('click', (event) => {
        const target = event.target;
        if (target.tagName !== 'BUTTON') return;
        const value = target.dataset.value;
        const func = target.dataset.func;
        if (value) {
            insertText(value);
        } else if (func) {
            if (['pi', 'e'].includes(func)) {
                insertText(func);
            } else if (func === 'sqrt') {
                insertText('sqrt()', 1);
            } else {
                insertText(`${func}()`, 1);
            }
        }
    });
    
    function loadCustomCode(codeBlock) {
        if (codeBlock) {
            codeBlock.split('\n').forEach(line => {
                if (line.trim()) {
                    try { parser.evaluate(line); } catch (e) {
                         console.error(`Error loading custom code: ${line}`, e);
                         addToHistory(line, `${translations.customCodeError}: ${e.message}`, true);
                    }
                }
            });
        }
    }

    copyButton.addEventListener('click', () => {
        const textToCopy = expressionInput.value;
        if (textToCopy) {
            navigator.clipboard.writeText(textToCopy).then(() => {
                copyButton.textContent = translations.copied;
                copyButton.classList.add('copied-feedback');
                setTimeout(() => {
                    copyButton.textContent = translations.copy;
                    copyButton.classList.remove('copied-feedback');
                }, 1200);
            }).catch(err => console.error('Failed to copy text: ', err));
        }
    });

    buttonGrid.addEventListener('click', (event) => {
        const target = event.target;
        if (target.tagName !== 'BUTTON') return;
        const value = target.dataset.value;
        const action = target.dataset.action;
        if (value) {
            insertText(value);
        } else if (action) {
            switch (action) {
                case 'clear':
                    expressionInput.value = '';
                    break;
                case 'backspace':
                    expressionInput.value = expressionInput.value.slice(0, -1);
                    break;
                case 'equals':
                    handleExpression();
                    break;
            }
        }
        expressionInput.focus();
    });

    expressionInput.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (historyIndex < commandHistory.length - 1) {
                historyIndex++;
                expressionInput.value = commandHistory[historyIndex];
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (historyIndex > 0) {
                historyIndex--;
                expressionInput.value = commandHistory[historyIndex];
            } else {
                historyIndex = -1;
                expressionInput.value = '';
            }
        } else if (e.key === 'Enter') {
            handleExpression();
        }
    });

    async function handleExpression() {
        let expression = expressionInput.value.trim();
        if (!expression) return;
        commandHistory.unshift(expression);
        historyIndex = -1;
        expressionInput.value = '';
        
        const expressionWithoutComments = expression.replace(/\/\/.*?\/\//g, '');
        const directConversionRegex = /^\s*(\d+(\.\d+)?)\s+([A-Z]{3})\s+(in|to)\s+([A-Z]{3})\s*$/i;
        const currencyInMathRegex = /\b[A-Z]{3}\b/;

        if (expressionWithoutComments.toLowerCase().startsWith('plot(')) {
            handlePlotting(expression);
        } else if (directConversionRegex.test(expressionWithoutComments)) {
            await handleDirectCurrencyConversion(expression);
        } else if (currencyInMathRegex.test(expressionWithoutComments)) {
            await handleMixedCurrencyCalculation(expression);
        } else {
            handleStandardCalculation(expression);
        }
    }

    async function handleDirectCurrencyConversion(originalExpression) {
        const expression = originalExpression.replace(/\/\/.*?\/\//g, '').trim();
        const parts = expression.split(/\s+/);
        const amount = parseFloat(parts[0]);
        const from = parts[1].toUpperCase();
        const to = parts[3].toUpperCase();

        addToHistory(originalExpression, `${translations.converting}...`, false);
        const loadingEntry = historyDiv.lastChild.querySelector('.result');
        try {
            const rates = await getCurrencyRates(from);
            if (!rates[to]) {
                throw new Error(translations.currencyNotFound.replace('%s', to));
            }
            const rate = rates[to];
            const result = amount * rate;
            const precision = typeof settings.decimalPlaces !== 'undefined' ? settings.decimalPlaces : 2;
            const resultText = `${Number(result.toFixed(precision))} ${to}`;

            loadingEntry.textContent = resultText;
            lastValidResult = String(Number(result.toFixed(precision)));
            parser.set('ans', result);

            if (settings.saveHistoryEnabled) {
                saveToStorage(originalExpression, resultText);
            }
        } catch (error) {
            loadingEntry.textContent = `${translations.error}: ${error.message}`;
            loadingEntry.classList.add('error');
        }
    }

    async function handleMixedCurrencyCalculation(originalExpression) {
        const expressionWithoutComments = originalExpression.replace(/\/\/.*?\/\//g, '');
        const currencyTermRegex = /(\d+(\.\d+)?)\s*([A-Z]{3})/gi;
        const matches = [...expressionWithoutComments.matchAll(currencyTermRegex)];
        if (matches.length === 0) {
            handleStandardCalculation(originalExpression);
            return;
        }
        const baseCurrency = matches[0][3].toUpperCase();
        addToHistory(originalExpression, `${translations.converting} (Base: ${baseCurrency})`, false);
        const loadingEntry = historyDiv.lastChild.querySelector('.result');
        try {
            const rates = await getCurrencyRates(baseCurrency);
            let expressionForEngine = expressionWithoutComments;
            for (const match of matches) {
                const amount = parseFloat(match[1]);
                const currency = match[3].toUpperCase();
                let valueInBase;
                if (currency === baseCurrency) {
                    valueInBase = amount;
                } else {
                    if (!rates[currency]) throw new Error(translations.currencyNotFound.replace('%s', currency));
                    valueInBase = amount / rates[currency];
                }
                expressionForEngine = expressionForEngine.replace(match[0], `(${valueInBase})`);
            }
            const result = parser.evaluate(expressionForEngine);
            const precision = typeof settings.decimalPlaces !== 'undefined' ? settings.decimalPlaces : 2;
            const resultText = `${Number(result.toFixed(precision))} ${baseCurrency}`;
            loadingEntry.textContent = resultText;
            lastValidResult = String(Number(result.toFixed(precision)));
            parser.set('ans', result);
            if (settings.saveHistoryEnabled) {
                saveToStorage(originalExpression, resultText);
            }
        } catch (error) {
            loadingEntry.textContent = `${translations.error}: ${error.message}`;
            loadingEntry.classList.add('error');
        }
    }

    function handleStandardCalculation(originalExpression) {
        let expressionForEngine = originalExpression.replace(/\/\/.*?\/\//g, '');
        expressionForEngine = expressionForEngine.replace(/\bmph\b/gi, 'mi/h');
        
        const additivePercentRegex = /([\d\.]+(\e[+\-]?\d+)?)\s*([+\-])\s*([\d\.]+(\e[+\-]?\d+)?)%/g;
        expressionForEngine = expressionForEngine.replace(additivePercentRegex, (match, base, _, op, pVal) => {
            return `${base} ${op} (${pVal}/100 * ${base})`;
        });
        expressionForEngine = expressionForEngine.replace(/([\d\.]+(\e[+\-]?\d+)?)%/g, '($1/100)');
        let finalExpression = expressionForEngine;
        const continuationOperators = ['+', '-', '*', '/', '^', 'mod'];
        if (lastValidResult !== null && continuationOperators.some(op => expressionForEngine.trim().startsWith(op))) {
            finalExpression = lastValidResult + " " + expressionForEngine;
        }
        try {
            const result = parser.evaluate(finalExpression);
            const precision = typeof settings.decimalPlaces !== 'undefined' ? settings.decimalPlaces : 14;
            const resultText = math.format(result, { notation: 'fixed', precision: precision });
            
            const numericResult = parseFloat(resultText);
            const finalDisplayResult = String(numericResult);

            parser.set('ans', result);
            lastValidResult = finalDisplayResult;

            addToHistory(originalExpression, finalDisplayResult, false);
            if (originalExpression.includes('=')) {
                storage.set({ userScope: parser.scope });
                renderDynamicButtons();
            }
            if (settings.saveHistoryEnabled) {
                 saveToStorage(originalExpression, finalDisplayResult);
            }
        } catch (error) {
            addToHistory(originalExpression, `${translations.error}: ${error.message}`, true);
        }
    }

    let currencyCache = {};
    async function getCurrencyRates(base) {
        const now = Date.now();
        if (currencyCache[base] && (now - currencyCache[base].timestamp < 4 * 60 * 60 * 1000)) {
            return currencyCache[base].rates;
        }
        const response = await fetch(`https://open.er-api.com/v6/latest/${base}`);
        if (!response.ok) throw new Error(translations.apiRequestFailed);
        const data = await response.json();
        if (data.result === 'error') throw new Error(translations.apiError.replace('%s', data['error-type']));
        currencyCache[base] = { rates: data.rates, timestamp: now };
        return data.rates;
    }

    function handlePlotting(expression) {
        if (typeof Chart === 'undefined') {
            addToHistory(expression, `${translations.error}: Chart.js library not loaded.`, true);
            return;
        }
        try {
            const match = expression.match(/plot\((.+?),\s*\[(.+?),(.+?)\]\)/i);
            if (!match) throw new Error(translations.invalidPlotSyntax);
            const funcStr = match[1];
            const min = parser.evaluate(match[2]);
            const max = parser.evaluate(match[3]);
            if (typeof min !== 'number' || typeof max !== 'number' || min >= max) {
                 throw new Error(translations.invalidPlotRange);
            }
            const compiledFunc = math.compile(funcStr);
            const labels = [];
            const data = [];
            const step = (max - min) / 100;
            for (let x = min; x <= max; x += step) {
                labels.push(x.toFixed(2));
                data.push(compiledFunc.evaluate({ x: x }));
            }
            addToHistory(expression, translations.plotOf.replace('%s', funcStr), false);
            const chartId = `chart_${Date.now()}`;
            const chartContainer = document.createElement('div');
            chartContainer.className = 'chart-container';
            chartContainer.innerHTML = `<canvas id="${chartId}"></canvas>`;
            historyDiv.appendChild(chartContainer);
            new Chart(document.getElementById(chartId), {
                type: 'line',
                data: { labels: labels, datasets: [{ label: funcStr, data: data, borderColor: 'rgb(75, 192, 192)', borderWidth: 2, pointRadius: 0, tension: 0.1 }] },
                options: { scales: { y: { beginAtZero: false } } }
            });
            historyDiv.scrollTop = historyDiv.scrollHeight;
        } catch (error) {
            addToHistory(expression, `${translations.plottingError}: ${error.message}`, true);
        }
    }

    clearButton.addEventListener('click', (e) => {
        e.preventDefault();
        historyDiv.innerHTML = '';
        lastValidResult = null;
        parser.clear();
        storage.remove('userScope');
        renderDynamicButtons();
        commandHistory = [];
        historyIndex = -1;
        if (settings.saveHistoryEnabled) {
            storage.set({ calculatorHistory: [] });
        }
    });

    exportButton.addEventListener('click', exportHistoryToFile);

    function addToHistory(query, result, isError) {
        const item = document.createElement('div');
        item.classList.add('history-item');
        const querySpan = document.createElement('div');
        querySpan.classList.add('query');
        const queryText = String(query || '');
        querySpan.textContent = queryText;
        querySpan.addEventListener('click', () => {
            expressionInput.value = queryText;
            expressionInput.focus();
        });
        const resultSpan = document.createElement('div');
        resultSpan.classList.add('result');
        if (isError) {
            resultSpan.classList.add('error');
        }
        const resultText = String(result || '');
        resultSpan.textContent = resultText;
        if (!isError && resultText) {
            resultSpan.addEventListener('click', () => {
                expressionInput.value = resultText.split(' ')[0];
                expressionInput.focus();
            });
        }
        item.appendChild(querySpan);
        item.appendChild(resultSpan);
        historyDiv.appendChild(item);
        historyDiv.scrollTop = historyDiv.scrollHeight;
    }
  
    async function saveToStorage(query, result) {
        const { calculatorHistory } = await storage.get('calculatorHistory');
        const history = calculatorHistory || [];
        history.push({ query: query, result: result, timestamp: Date.now() });
        storage.set({ calculatorHistory: history });
    }

    function loadHistory(history) {
        const historyDays = settings.historyDays || 7;
        const expirationTime = Date.now() - (historyDays * 24 * 60 * 60 * 1000);
        const errorString = (translations && translations.error) ? translations.error.toLowerCase() : 'error';
        const wellFormedHistory = history.filter(item => 
            item &&
            typeof item.timestamp === 'number' &&
            item.timestamp > expirationTime &&
            typeof item.query === 'string'
        );
        const validHistory = settings.saveHistoryEnabled ? wellFormedHistory : [];
        validHistory.forEach(item => {
            const resultText = String(item.result || '');
            const isError = resultText.toLowerCase().includes(errorString);
            addToHistory(item.query, resultText, isError);
            commandHistory.push(item.query);
            if (resultText && !isError) {
                lastValidResult = resultText.split(' ')[0];
                try {
                    parser.set('ans', math.evaluate(resultText));
                } catch (e) {
                }
            }
        });
        commandHistory.reverse();
        if (history.length !== validHistory.length && settings.saveHistoryEnabled) {
            storage.set({ calculatorHistory: validHistory });
        }
    }

    async function exportHistoryToFile() {
      const { calculatorHistory } = await storage.get('calculatorHistory');
      if (!calculatorHistory || calculatorHistory.length === 0) {
          alert(translations.historyEmpty);
          return;
      }
      const fileContent = calculatorHistory.map(item => `> ${item.query}\n  = ${item.result}\n`).join('\n');
      const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `calculator-history-${date}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    initialize();
});